import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, r"D:\19016\Documents\Workload\jufexk\scripts\legacy_ocr")
from map_catalog_identities import catalog_indexes, normalize_source_label, verified_catalog

catalog_root = Path(r"D:\19016\Documents\Workload\jufexk\scripts\catalog-baseline\captures\full-approved-v2")
_manifest, _sha, rows = verified_catalog(catalog_root)
courses, teachers, relations, course_names, teacher_names = catalog_indexes(rows)

needles = [
    "毛概",
    "毛泽东",
    "马原",
    "马克思主义基本原理",
    "近代史",
    "中国近现代史",
    "思修",
    "思想道德",
    "习概",
    "习近平",
    "形势与政策",
    "羽毛球",
    "武术",
    "体育舞蹈",
    "足球",
    "跆拳道",
    "乒乓球",
    "篮球",
    "健美操",
    "轮滑",
    "散打",
    "大学英语",
    "视听说",
    "英语口语",
    "高级口语",
    "学术英语",
    "宏观经济学",
    "货币银行学",
    "大学语文",
    "音乐鉴赏",
    "中国民歌",
    "常见急救",
    "写作与沟通",
    "C语言",
    "程序设计",
]


def names_for(course: dict) -> set[str]:
    values = {course.get("currentName"), *(item.get("rawName") for item in course.get("nameVariants", []) if isinstance(item, dict))}
    return {name for name in values if isinstance(name, str) and name}


for needle in needles:
    hits = []
    for code, course in courses.items():
        for name in names_for(course):
            if needle in name:
                hits.append((code, course.get("currentName"), course.get("category"), name))
                break
    print(f"\n=== {needle} ({len(hits)}) ===")
    for item in hits[:12]:
        print(" ", item)
    if len(hits) > 12:
        print("  ...")

print("\n=== teacher 乒乓球 unique? ===")
# sports families
family = defaultdict(list)
for code, course in courses.items():
    if course.get("category") != "sports":
        continue
    name = course.get("currentName") or ""
    stripped = name.rstrip("0123456789ⅠⅡⅢⅣⅤⅥ一二三四（）()留")
    family[stripped or name].append((code, name))
print("sports families", len(family))
for key, items in sorted(family.items(), key=lambda pair: -len(pair[1]))[:30]:
    print(f"  {key!r}: {len(items)} {items[:4]}")
