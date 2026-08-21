import json
from pathlib import Path

catalog = Path(r"D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2\catalog-baseline.jsonl")
courses = []
teachers = []
relations = []
for line in catalog.read_text(encoding="utf-8").splitlines():
    rec = json.loads(line)
    value = rec.get("value") or {}
    kind = rec.get("recordType")
    if kind == "course":
        courses.append(value)
    elif kind == "teacher":
        teachers.append(value)
    elif kind == "relation":
        relations.append(value)

code = {c["courseCode"]: c for c in courses}

def dump(label):
    print(f"\n=== teacher {label!r} ===")
    hits = [t for t in teachers if label.lower() in (t.get("sourceTeacherLabel") or "").lower()]
    for t in hits:
        print(" ", t.get("sourceTeacherLabel"))
    rels = [r for r in relations if label.lower() in (r.get("sourceTeacherLabel") or "").lower()]
    for r in rels:
        c = code.get(r["courseCode"], {})
        print(f"  {r['courseCode']} {c.get('currentName')!r} teacher={r.get('sourceTeacherLabel')!r}")

dump("carl")
dump("Christine")
dump("樊凤龙")
dump("李珺")
dump("王云")
dump("马艳")
dump("樊")
