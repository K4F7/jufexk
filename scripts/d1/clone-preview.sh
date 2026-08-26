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
echo "Importing into jufexk-preview..."
pnpm exec wrangler d1 execute jufexk-preview --remote --file="$tmpdir/export.sql" -y
echo "Done. Preview writes stay on jufexk-preview and do not return to production."
