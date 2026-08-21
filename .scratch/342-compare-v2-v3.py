import hashlib
import json
from collections import Counter
from pathlib import Path

def load(root: Path):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    excluded = [json.loads(l) for l in (root / "excluded.jsonl").read_text(encoding="utf-8").splitlines() if l]
    return manifest, excluded, hashlib.sha256((root / "manifest.json").read_bytes()).hexdigest()

v2 = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v2")
v3 = Path(r"D:\19016\Documents\Workload\jufexk-production-inputs\frozen-historical-v5-candidate-v3")
m2, e2, h2 = load(v2)
m3, e3, h3 = load(v3)
print("v2 counts", m2["counts"], "manifest", h2, "content", m2["contentSha256"])
print("v3 counts", m3["counts"], "manifest", h3, "content", m3["contentSha256"])
print("same content", m2["contentSha256"] == m3["contentSha256"])
print("same files", m2["files"] == m3["files"])
print("v2 missing_teacher", sum(1 for r in e2 if r["reason"] == "missing_teacher"))
print("v3 missing_teacher", sum(1 for r in e3 if r["reason"] == "missing_teacher"))
print("v3 reasons", Counter(r["reason"] for r in e3))
print("v3 safety", m3["safety"])
print("v2 protected overwritten", m3["safety"])
