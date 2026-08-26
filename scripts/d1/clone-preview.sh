#!/usr/bin/env bash
# Copy production D1 into jufexk-preview. Operator-only.
# Never run from CI: the dump contains student submissions and must not become
# a GitHub Artifact.
#
# Full wrangler d1 export includes schema+data. A previously migrated preview
# DB would reject that dump. Drop preview objects first (foreign_keys off), then
# import, keeping the same database_id. Never execute this reset against production.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

prod_db="jufexk"
preview_db="jufexk-preview"
if [ "$preview_db" = "$prod_db" ]; then
  echo "Refusing to reset or import into production D1" >&2
  exit 1
fi

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

echo "Exporting production D1 (may be large; retry if the import times out)..."
pnpm exec wrangler d1 export "$prod_db" --remote --output="$tmpdir/export.sql" -y

echo "Resetting $preview_db schema (keeping database_id)..."
pnpm exec wrangler d1 execute "$preview_db" --env preview --remote --json -y --command="SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%';" > "$tmpdir/objects.json"
python3 scripts/d1/preview-drop-sql.py "$tmpdir/objects.json" "$tmpdir/drop.sql"
pnpm exec wrangler d1 execute "$preview_db" --env preview --remote --file="$tmpdir/drop.sql" -y

echo "Importing into $preview_db..."
pnpm exec wrangler d1 execute "$preview_db" --env preview --remote --file="$tmpdir/export.sql" -y
echo "Done. Preview writes stay on $preview_db and do not return to production."
