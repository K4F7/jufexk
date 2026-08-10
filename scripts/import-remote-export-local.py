#!/usr/bin/env python3
"""Import a wrangler D1 remote export into the local miniflare D1 sqlite file.

Usage:
  pnpm db:export-remote          # writes .local-data/remote-export.sql
  pnpm db:import-remote-local    # replaces local D1 catalog tables

Keeps public catalog tables only (drops huge staging/provenance inserts).
Skips admin session / rate-limit operational rows.
Maps remote category 'sports' -> 'pe' when the local CHECK allows; otherwise keeps as-is.

Never commit .local-data/ (gitignored).
"""

from __future__ import annotations

import re
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / ".local-data" / "remote-export.sql"
DB_DIR = ROOT / ".wrangler" / "state" / "v3" / "d1" / "miniflare-D1DatabaseObject"

KEEP = {
    "d1_migrations",
    "teachers",
    "courses",
    "course_teachers",
    "offerings",
    "offering_teachers",
    "reviews",
    "legacy_reviews",
    "course_name_variants",
    "sqlite_sequence",
}


def find_db() -> Path:
    if not DB_DIR.is_dir():
        raise SystemExit(
            f"Local D1 dir missing: {DB_DIR}\nRun `pnpm db:local` then `pnpm dev` once first."
        )
    candidates = sorted(
        p for p in DB_DIR.glob("*.sqlite") if p.name != "metadata.sqlite"
    )
    if not candidates:
        raise SystemExit(f"No local D1 sqlite under {DB_DIR}")
    # Prefer the largest non-metadata file if multiple
    return max(candidates, key=lambda p: p.stat().st_size if p.exists() else 0)


def table_of(stmt: str) -> str | None:
    m = re.match(r'\s*CREATE TABLE(?: IF NOT EXISTS)? "?([A-Za-z0-9_]+)"?', stmt)
    if m:
        return m.group(1)
    m = re.match(r'\s*INSERT INTO "?([A-Za-z0-9_]+)"?', stmt)
    if m:
        return m.group(1)
    m = re.match(
        r'\s*CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? "?[A-Za-z0-9_]+"? ON "?([A-Za-z0-9_]+)"?',
        stmt,
    )
    if m:
        return m.group(1)
    return None


def main() -> int:
    if not EXPORT.is_file():
        raise SystemExit(
            f"Missing {EXPORT}\nRun: pnpm db:export-remote"
        )

    db_path = find_db()
    print(f"import -> {db_path}")

    for p in DB_DIR.glob("*.sqlite-shm"):
        p.unlink(missing_ok=True)
    for p in DB_DIR.glob("*.sqlite-wal"):
        p.unlink(missing_ok=True)

    if db_path.exists():
        db_path.unlink()

    con = sqlite3.connect(str(db_path))
    con.execute("PRAGMA foreign_keys=OFF")
    con.execute("PRAGMA journal_mode=OFF")
    con.execute("PRAGMA synchronous=OFF")
    con.execute("PRAGMA temp_store=MEMORY")

    t0 = time.time()
    kept = dropped = errors = 0
    buf: list[str] = []
    batch: list[str] = []

    def flush() -> None:
        nonlocal batch
        if not batch:
            return
        for s in batch:
            con.execute(s)
        con.commit()
        batch = []

    with EXPORT.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith(("PRAGMA", "BEGIN", "COMMIT")):
                continue
            buf.append(line)
            if not line.rstrip().endswith(";"):
                continue
            stmt = "".join(buf).strip()
            buf.clear()
            if not stmt:
                continue
            table = table_of(stmt)
            if table is None or table not in KEEP:
                dropped += 1
                continue
            # Prefer pe for UI filters when CHECK is major/pe/general; remote uses sports.
            if "INSERT INTO" in stmt[:20] and "courses" in stmt[:40]:
                # Only rewrite if target allows pe; try sports->pe, keep original on failure via row retry.
                stmt_try = stmt.replace(",'sports',", ",'pe',")
            else:
                stmt_try = stmt
            batch.append(stmt_try)
            kept += 1
            if len(batch) >= 2000:
                try:
                    flush()
                except sqlite3.Error:
                    for s in batch:
                        try:
                            con.execute(s)
                        except sqlite3.Error:
                            # fall back original sports if pe rejected
                            if ",'pe'," in s and "courses" in s[:40]:
                                try:
                                    con.execute(s.replace(",'pe',", ",'sports',"))
                                    continue
                                except sqlite3.Error:
                                    pass
                            errors += 1
                    con.commit()
                    batch = []
            if kept % 10000 == 0:
                print(
                    f"kept={kept} dropped={dropped} errors={errors} "
                    f"{time.time() - t0:.1f}s"
                )

    try:
        flush()
    except sqlite3.Error:
        for s in batch:
            try:
                con.execute(s)
            except sqlite3.Error:
                errors += 1
        con.commit()

    cur = con.cursor()
    for t in [
        "courses",
        "teachers",
        "reviews",
        "course_teachers",
        "offerings",
        "legacy_reviews",
    ]:
        try:
            n = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"{t}: {n}")
        except sqlite3.Error as e:
            print(f"{t}: missing ({e})")
    try:
        print(
            "categories:",
            cur.execute(
                "SELECT category, COUNT(*) FROM courses GROUP BY category"
            ).fetchall(),
        )
    except sqlite3.Error:
        pass
    print(
        f"done kept={kept} dropped={dropped} errors={errors} "
        f"sec={time.time() - t0:.1f} sizeMB={db_path.stat().st_size / 1e6:.1f}"
    )
    con.close()
    return 0 if errors < kept else 1


if __name__ == "__main__":
    sys.exit(main())
