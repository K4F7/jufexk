#!/usr/bin/env python3
"""Turn wrangler d1 execute --json sqlite_master rows into DROP SQL.

Used only by clone-preview.sh so a migrated preview DB can accept a full dump.
Keeps the same database_id; does not talk to production.
"""
from __future__ import annotations

import json
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: preview-drop-sql.py OBJECTS.json DROP.sql", file=sys.stderr)
        return 2
    src, dest = sys.argv[1], sys.argv[2]
    raw = open(src, encoding="utf-8").read()
    starts = [i for i in (raw.find("["), raw.find("{")) if i >= 0]
    if not starts:
        print("Could not parse wrangler d1 execute JSON for preview sqlite_master", file=sys.stderr)
        return 1
    data = json.loads(raw[min(starts) :])
    if isinstance(data, dict):
        if data.get("error"):
            print("wrangler d1 execute error:", data.get("error"), file=sys.stderr)
            return 1
        blocks = [data]
    else:
        blocks = data
    rows: list[dict] = []
    for block in blocks:
        if isinstance(block, dict):
            rows.extend(block.get("results") or [])

    rank = {"view": 0, "trigger": 1, "index": 2, "table": 3}
    rows.sort(key=lambda r: rank.get(str(r.get("type") or ""), 9))

    lines = ["PRAGMA foreign_keys=OFF;"]
    seen: set[tuple[str, str]] = set()
    for row in rows:
        kind = str(row.get("type") or "")
        name = str(row.get("name") or "")
        if not kind or not name or name.startswith("sqlite_") or (kind, name) in seen:
            continue
        seen.add((kind, name))
        quoted = name.replace(chr(34), chr(34)*2)
        if kind == "table":
            stmt = f"DROP TABLE IF EXISTS {chr(34)}{quoted}{chr(34)};"
        elif kind == "view":
            stmt = f"DROP VIEW IF EXISTS {chr(34)}{quoted}{chr(34)};"
        elif kind == "index":
            stmt = f"DROP INDEX IF EXISTS {chr(34)}{quoted}{chr(34)};"
        elif kind == "trigger":
            stmt = f"DROP TRIGGER IF EXISTS {chr(34)}{quoted}{chr(34)};"
        else:
            continue
        lines.append(stmt)

    open(dest, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
