#!/usr/bin/env bash
# Copy production D1 into jufexk-preview. Operator-only.
# Never run from CI: the dump contains student submissions and must not become
# a GitHub Artifact.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
echo "Exporting production D1 (may be large; retry if the import times out)..."
pnpm exec wrangler d1 export jufexk --remote --output="$tmpdir/export.sql" -y
python3 - "$tmpdir/export.sql" "$tmpdir/wipe.sql" <<'PY'
import re
import sys
from pathlib import Path

export_path, wipe_path = Path(sys.argv[1]), Path(sys.argv[2])
names: list[str] = []
seen: set[str] = set()
for match in re.finditer(
    r'CREATE TABLE(?: IF NOT EXISTS)?\s+"?([A-Za-z0-9_]+)"?',
    export_path.read_text(),
    re.I,
):
    name = match.group(1)
    if name.startswith("sqlite_") or name in seen:
        continue
    seen.add(name)
    names.append(name)
wipe_path.write_text(
    "PRAGMA foreign_keys=OFF;\n"
    + "".join(f"DROP TABLE IF EXISTS {name};\n" for name in names)
)
print(f"Wiping {len(names)} preview tables before import")
PY
echo "Replacing preview schema so a migrated database can take the dump..."
pnpm exec wrangler d1 execute jufexk-preview --env preview --remote --file="$tmpdir/wipe.sql" -y
echo "Importing into jufexk-preview..."
pnpm exec wrangler d1 execute jufexk-preview --env preview --remote --file="$tmpdir/export.sql" -y
echo "Done. Preview writes stay on jufexk-preview and do not return to production."
