#!/usr/bin/env bash
set -euo pipefail

: "${D1_BENCH_CONFIG:?set D1_BENCH_CONFIG to the guarded preview Wrangler config}"
: "${D1_BENCH_BINDING:=PREVIEW}"
: "${D1_BENCH_DATABASE_ID:?set D1_BENCH_DATABASE_ID to the resolved preview UUID}"

production_database_id="7bd119f3-b8a2-4c9d-9e70-2809396ee26c"
configured_name=$(jq -r --arg binding "$D1_BENCH_BINDING" '.d1_databases[] | select(.binding == $binding) | .database_name' "$D1_BENCH_CONFIG")
configured_id=$(jq -r --arg binding "$D1_BENCH_BINDING" '.d1_databases[] | select(.binding == $binding) | .database_id' "$D1_BENCH_CONFIG")
[[ "$D1_BENCH_BINDING" == "PREVIEW" ]]
[[ "$configured_name" == "jufexk-preview" ]]
[[ "$configured_id" == "$D1_BENCH_DATABASE_ID" ]]
[[ "$configured_id" != "$production_database_id" ]]
[[ "$configured_id" != "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" ]]

prefix="catalog_fts_bench_${GITHUB_RUN_ID:-local}"
if [[ ! "$prefix" =~ ^[a-z0-9_]+$ ]]; then
  echo "unsafe benchmark table prefix" >&2
  exit 1
fi

execute_json() {
  local output="$1"
  local sql="$2"
  local raw="${output}.raw"
  pnpm exec wrangler d1 execute "$D1_BENCH_BINDING" \
    --config "$D1_BENCH_CONFIG" --remote --json --command "$sql" > "$raw"
  sed -n '/^\[/,$p' "$raw" > "$output"
}

cleanup() {
  local status=$?
  if ! pnpm exec wrangler d1 execute "$D1_BENCH_BINDING" \
    --config "$D1_BENCH_CONFIG" --remote --command "
      DROP TABLE IF EXISTS ${prefix}_course_fts;
      DROP TABLE IF EXISTS ${prefix}_teacher_fts;
      DROP TABLE IF EXISTS ${prefix}_relations;
      DROP TABLE IF EXISTS ${prefix}_courses;
      DROP TABLE IF EXISTS ${prefix}_teachers;
    " >/dev/null; then
    echo "failed to clean benchmark tables from guarded preview D1" >&2
    [[ "$status" -eq 0 ]] && status=1
  fi
  exit "$status"
}
trap cleanup EXIT

setup_sql=$(mktemp)
cat > "$setup_sql" <<SQL
CREATE TABLE ${prefix}_courses(
  id INTEGER PRIMARY KEY,
  match_text TEXT NOT NULL,
  pinyin_text TEXT NOT NULL,
  teacher_variant_text TEXT NOT NULL
);
CREATE TABLE ${prefix}_teachers(
  id INTEGER PRIMARY KEY,
  match_text TEXT NOT NULL,
  pinyin_text TEXT NOT NULL
);
CREATE TABLE ${prefix}_relations(
  course_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  PRIMARY KEY(course_id,teacher_id)
);
CREATE VIRTUAL TABLE ${prefix}_course_fts USING fts5(
  match_text,pinyin_text,teacher_variant_text,
  content='${prefix}_courses',content_rowid='id',tokenize='trigram'
);
CREATE VIRTUAL TABLE ${prefix}_teacher_fts USING fts5(
  match_text,pinyin_text,
  content='${prefix}_teachers',content_rowid='id',tokenize='trigram'
);
WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<5000)
INSERT INTO ${prefix}_courses(id,match_text,pinyin_text,teacher_variant_text)
SELECT n,
  CASE WHEN n%137=0 THEN '分布式系统课程 CODETARGET 搜索教师' ELSE '普通课程 ' || printf('%05d',n) END,
  CASE WHEN n%137=0 THEN 'fenbushixitongkecheng fbsxtkc sousuojiaoshi ssjs' ELSE 'putongkecheng ptck ' || n END,
  CASE WHEN n%137=0 THEN char(31) || '搜索教师' || char(31) ELSE '' END
FROM seq;
WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<1000)
INSERT INTO ${prefix}_teachers(id,match_text,pinyin_text)
SELECT n,
  CASE WHEN n%113=0 THEN '搜索教师 性能学院' ELSE '普通教师 ' || printf('%05d',n) END,
  CASE WHEN n%113=0 THEN 'sousuojiaoshi ssjs' ELSE 'putongjiaoshi ptjs ' || n END
FROM seq;
WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<5000)
INSERT INTO ${prefix}_relations(course_id,teacher_id)
SELECT n,((n-1)%1000)+1 FROM seq
UNION ALL
SELECT n,(n%1000)+1 FROM seq;
INSERT INTO ${prefix}_course_fts(${prefix}_course_fts) VALUES('rebuild');
INSERT INTO ${prefix}_teacher_fts(${prefix}_teacher_fts) VALUES('rebuild');
SQL
setup_raw=/tmp/catalog-fts-bench-setup.raw
pnpm exec wrangler d1 execute "$D1_BENCH_BINDING" \
  --config "$D1_BENCH_CONFIG" --remote --json --file "$setup_sql" > "$setup_raw"
sed -n '/^\[/,$p' "$setup_raw" > /tmp/catalog-fts-bench-setup.json

run_case() {
  local label="$1"
  local before_sql="$2"
  local after_sql="$3"
  local require_reduction="${4:-true}"
  local before_file="/tmp/${prefix}-${label}-before.json"
  local after_file="/tmp/${prefix}-${label}-after.json"
  execute_json "$before_file" "$before_sql"
  execute_json "$after_file" "$after_sql"
  local before_result after_result
  before_result=$(jq -c '.[0] | {total:.results[0].total,identities:.results[0].identities,rows_read:.meta.rows_read,duration:.meta.duration}' "$before_file")
  after_result=$(jq -c '.[0] | {total:.results[0].total,identities:.results[0].identities,rows_read:.meta.rows_read,duration:.meta.duration}' "$after_file")
  jq -e --argjson before "$before_result" --argjson after "$after_result" \
    '$before.total == $after.total and $before.identities == $after.identities' <<< '{}'>/dev/null
  if [[ "$require_reduction" == "true" ]]; then
    jq -e --argjson before "$before_result" --argjson after "$after_result" \
      '$after.rows_read < $before.rows_read' <<< '{}'>/dev/null
  fi
  jq -cn --arg case "$label" --argjson before "$before_result" --argjson after "$after_result" \
    '{case:$case,before:$before,after:$after}'
}

course_result() {
  local where="$1"
  printf "SELECT COUNT(*) total,COALESCE((SELECT GROUP_CONCAT(id) FROM (SELECT id FROM ${prefix}_courses WHERE %s ORDER BY id LIMIT 5)),'') identities FROM ${prefix}_courses WHERE %s" "$where" "$where"
}
teacher_result() {
  local where="$1"
  printf "SELECT COUNT(*) total,COALESCE((SELECT GROUP_CONCAT(id) FROM (SELECT id FROM ${prefix}_teachers WHERE %s ORDER BY id LIMIT 5)),'') identities FROM ${prefix}_teachers WHERE %s" "$where" "$where"
}
relation_result() {
  local where="$1"
  printf "SELECT COUNT(*) total,COALESCE((SELECT GROUP_CONCAT(course_id || ':' || teacher_id) FROM (SELECT r.course_id,r.teacher_id FROM ${prefix}_relations r JOIN ${prefix}_courses c ON c.id=r.course_id WHERE %s ORDER BY r.course_id,r.teacher_id LIMIT 5)),'') identities FROM ${prefix}_relations r JOIN ${prefix}_courses c ON c.id=r.course_id WHERE %s" "$where" "$where"
}

course_like="match_text LIKE '%分布式系统%'"
course_fts="id IN (SELECT rowid FROM ${prefix}_course_fts WHERE ${prefix}_course_fts MATCH '\"分布式系统\"')"
run_case courses_zh "$(course_result "$course_like")" "$(course_result "$course_fts")"
run_case courses_code "$(course_result "match_text LIKE '%CODETARGET%'")" "$(course_result "id IN (SELECT rowid FROM ${prefix}_course_fts WHERE ${prefix}_course_fts MATCH '\"CODETARGET\"')")"
run_case courses_pinyin "$(course_result "pinyin_text LIKE '%fenbushi%'")" "$(course_result "id IN (SELECT rowid FROM ${prefix}_course_fts WHERE ${prefix}_course_fts MATCH '\"fenbushi\"')")"
run_case courses_initials "$(course_result "pinyin_text LIKE '%fbsxtkc%'")" "$(course_result "id IN (SELECT rowid FROM ${prefix}_course_fts WHERE ${prefix}_course_fts MATCH '\"fbsxtkc\"')")"
run_case courses_multi "$(course_result "match_text LIKE '%分布式%' AND pinyin_text LIKE '%xitong%'")" "$(course_result "id IN (SELECT rowid FROM ${prefix}_course_fts WHERE ${prefix}_course_fts MATCH '\"分布式\"') AND id IN (SELECT rowid FROM ${prefix}_course_fts WHERE ${prefix}_course_fts MATCH '\"xitong\"')")"
run_case courses_short "$(course_result "match_text LIKE '%课程%'")" "$(course_result "match_text LIKE '%课程%'")" false
run_case courses_miss "$(course_result "match_text LIKE '%不存在课程%'")" "$(course_result "id IN (SELECT rowid FROM ${prefix}_course_fts WHERE ${prefix}_course_fts MATCH '\"不存在课程\"')")"
run_case options "$(course_result "$course_like")" "$(course_result "$course_fts")"
run_case teachers "$(teacher_result "match_text LIKE '%搜索教师%'")" "$(teacher_result "id IN (SELECT rowid FROM ${prefix}_teacher_fts WHERE ${prefix}_teacher_fts MATCH '\"搜索教师\"')")"
run_case relations "$(relation_result "c.match_text LIKE '%分布式系统%'")" "$(relation_result "c.id IN (SELECT rowid FROM ${prefix}_course_fts WHERE ${prefix}_course_fts MATCH '\"分布式系统\"')")"

execute_json /tmp/catalog-fts-bench-eqp.json \
  "EXPLAIN QUERY PLAN SELECT id FROM ${prefix}_courses WHERE id IN (SELECT rowid FROM ${prefix}_course_fts WHERE ${prefix}_course_fts MATCH '\"分布式系统\"')"
jq -e 'any(.[] | .results[]?; (.detail // "" | ascii_upcase | contains("VIRTUAL TABLE")))' /tmp/catalog-fts-bench-eqp.json >/dev/null
jq -c '{query_plan:[.[0].results[].detail]}' /tmp/catalog-fts-bench-eqp.json
