#!/usr/bin/env bash
# Create the isolated preview D1 and write its id into wrangler.jsonc.
# Operator-only — needs CLOUDFLARE_API_TOKEN. Do not run in CI.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

placeholder="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

parse_d1_id() {
  python3 -c '
import json, re, sys
text = sys.stdin.read()
for match in re.finditer(r"\{[^{}]*\}", text, re.S):
    try:
        obj = json.loads(match.group())
    except json.JSONDecodeError:
        continue
    for key in ("database_id", "uuid"):
        value = obj.get(key)
        if isinstance(value, str) and value:
            print(value)
            raise SystemExit(0)
match = re.search(
    r"(?:database_id|uuid)\s*[:=]\s*\"?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\"?",
    text,
)
if match:
    print(match.group(1))
'
}

output=$(pnpm exec wrangler d1 create jufexk-preview 2>&1) || true
printf '%s\n' "$output"
id=$(printf '%s\n' "$output" | parse_d1_id)
if [ -z "$id" ]; then
  output=$(pnpm exec wrangler d1 info jufexk-preview --json)
  printf '%s\n' "$output"
  id=$(printf '%s\n' "$output" | parse_d1_id)
fi
if [ -z "$id" ]; then
  echo "Could not parse database_id for jufexk-preview" >&2
  exit 1
fi
python3 - "$placeholder" "$id" <<'PY'
import sys
from pathlib import Path
placeholder, database_id = sys.argv[1], sys.argv[2]
path = Path("wrangler.jsonc")
text = path.read_text()
if placeholder not in text and database_id in text:
    print(f"wrangler.jsonc already has {database_id}")
    raise SystemExit(0)
if placeholder not in text:
    raise SystemExit("wrangler.jsonc preview database_id placeholder not found")
path.write_text(text.replace(placeholder, database_id, 1))
print(f"Wrote preview database_id {database_id}")
PY
