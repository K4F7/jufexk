import json
from pathlib import Path
from freeze_v5_production_candidate import VISIBLE_COURSE_ALIASES, visible_course_name
from map_catalog_identities import normalize_source_label

alias = VISIBLE_COURSE_ALIASES["中国古典诗词歌曲赏析与演唱MOOC"]
print("alias", repr(alias), [hex(ord(c)) for c in alias[-8:]])

raw = None
for line in Path(r"D:\19016\Documents\Workload\jufexk\scripts\legacy_evidence\output\review-approved-20260820-v5\evaluations.jsonl").read_text(encoding="utf-8").splitlines():
    row = json.loads(line)
    if row.get("key") == "MOOC|18|G":
        raw = row["course"]
        print("eval", repr(raw), [hex(ord(c)) for c in raw[-8:]])
        print("visible", repr(visible_course_name(raw)))
        break

catalog = Path(r"D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2\catalog-baseline.jsonl")
for line in catalog.read_text(encoding="utf-8").splitlines():
    rec = json.loads(line)
    if rec.get("recordType") != "course":
        continue
    name = rec["value"].get("currentName") or ""
    if "古典诗词歌曲" in name or rec["value"].get("courseCode") == "1504808611":
        print("catalog", rec["value"]["courseCode"], repr(name), [hex(ord(c)) for c in name[-8:]])
        print("equal alias", name == alias)
        print("norm equal", normalize_source_label(name) == normalize_source_label(alias))
