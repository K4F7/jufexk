#!/usr/bin/env python3
"""Apply one-shot CTA sync artifacts to the local miniflare D1 sqlite file.

Usage:
  pnpm db:local
  pnpm cta-sync
  python3 scripts/cta-sync/apply-local.py
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARTIFACT = ROOT / ".local-data" / "cta-sync"
DB_DIR = ROOT / ".wrangler" / "state" / "v3" / "d1" / "miniflare-D1DatabaseObject"


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
    return max(candidates, key=lambda p: p.stat().st_size if p.exists() else 0)


def content_type_for(blob: bytes, declared: str | None) -> str:
    if declared in {"image/png", "image/jpeg", "image/webp"}:
        return declared
    if blob.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if blob.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def main() -> int:
    bindings_path = ARTIFACT / "bindings.json"
    if not bindings_path.is_file():
        raise SystemExit(f"Missing {bindings_path}\nRun: pnpm cta-sync")
    rows = json.loads(bindings_path.read_text())
    db_path = find_db()
    print(f"apply -> {db_path}")
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    updated = 0
    avatars = 0
    skipped_missing = 0
    try:
        for row in rows:
            teacher_id = int(row["teacherId"])
            exists = conn.execute(
                "SELECT homepage_locked, image_locked FROM teachers WHERE id=?",
                (teacher_id,),
            ).fetchone()
            if exists is None:
                skipped_missing += 1
                continue
            homepage_locked, image_locked = exists
            if homepage_locked:
                continue
            if row["match"] == "unique" and row.get("homepageUrl") and row.get("ctaUid"):
                conn.execute(
                    """UPDATE teachers
                          SET cta_fid=?, cta_uid=?, homepage_url=?, homepage_match='unique',
                              avatar_sha256=?, cta_synced_at=CURRENT_TIMESTAMP
                        WHERE id=?""",
                    (
                        109051,
                        int(row["ctaUid"]),
                        row["homepageUrl"],
                        row.get("avatarSha256"),
                        teacher_id,
                    ),
                )
            else:
                conn.execute(
                    """UPDATE teachers
                          SET homepage_match=?, cta_synced_at=CURRENT_TIMESTAMP
                        WHERE id=? AND IFNULL(homepage_match,'none') NOT IN ('unique','manual')""",
                    (row["match"], teacher_id),
                )
            updated += 1
            blob_path = ARTIFACT / "avatars" / f"{teacher_id}.bin"
            if image_locked or not blob_path.is_file() or not row.get("avatarSha256"):
                continue
            blob = blob_path.read_bytes()
            conn.execute(
                """INSERT INTO teacher_avatars(teacher_id,content_type,sha256,bytes,source_url,fetched_at)
                   VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
                   ON CONFLICT(teacher_id) DO UPDATE SET
                     content_type=excluded.content_type,
                     sha256=excluded.sha256,
                     bytes=excluded.bytes,
                     source_url=excluded.source_url,
                     fetched_at=excluded.fetched_at""",
                (
                    teacher_id,
                    content_type_for(blob, row.get("contentType")),
                    row["avatarSha256"],
                    blob,
                    row.get("homepageUrl") or "cta-sync",
                ),
            )
            avatars += 1
        conn.commit()
    finally:
        conn.close()
    print(
        json.dumps(
            {
                "updatedTeachers": updated,
                "avatarsStored": avatars,
                "missingTeachers": skipped_missing,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
