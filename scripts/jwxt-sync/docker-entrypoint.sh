#!/bin/sh
set -eu

mode="${JWXT_MODE:-pilot}"
output="/app/.local-data/jwxt-sync/capture.json"
checkpoint="/app/.local-data/jwxt-sync/collector-checkpoint.json"
result="/app/.local-data/jwxt-sync/result.json"
bucket="${JWXT_SYNC_BUCKET:-jufexk-jwxt-sync}"

case "$mode" in
  pilot|incremental|full|resume) ;;
  *) echo '{"status":"failed","reason":"invalid_mode"}' >&2; exit 2 ;;
esac

if [ "$mode" = "resume" ]; then
  pnpm exec wrangler r2 object get "$bucket/checkpoints/collector-latest.json" \
    --file "$checkpoint" --remote >/dev/null
fi

pnpm exec tsx scripts/jwxt-collector/run.ts \
  --mode "$mode" \
  --output "$output" \
  --checkpoint "$checkpoint"

if [ "${JWXT_STAGE_ONLY:-true}" = "true" ]; then
  pnpm exec tsx scripts/jwxt-sync/run.ts \
    --mode "$mode" \
    --capture "$output" \
    --output /app/.local-data/jwxt-sync/out \
    --stage-only > "$result"
else
  pnpm exec tsx scripts/jwxt-sync/run.ts \
    --mode "$mode" \
    --capture "$output" \
    --output /app/.local-data/jwxt-sync/out > "$result"
fi

generation_id="$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).generationId)' "$result")"
pnpm exec wrangler r2 object put "$bucket/generations/$generation_id/manifest.json" \
  --file "/app/.local-data/jwxt-sync/out/$generation_id.manifest.json" --remote >/dev/null
pnpm exec wrangler r2 object put "$bucket/generations/$generation_id/offerings.ndjson.gz" \
  --file "/app/.local-data/jwxt-sync/out/$generation_id.ndjson.gz" --remote >/dev/null
pnpm exec wrangler r2 object put "$bucket/checkpoints/latest.json" \
  --file "$result" --remote >/dev/null
if [ -f "$checkpoint" ]; then
  pnpm exec wrangler r2 object put "$bucket/checkpoints/collector-latest.json" \
    --file "$checkpoint" --remote >/dev/null
fi

cat "$result"
