import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const v3DecisionsPath =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/human-queue-20260820-v3/decisions.json";
const recaptureDecisionsPath =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/human-queue-20260820-v3-live-recapture/review/decisions.json";
const capturesPath =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/human-queue-20260820-v3-live-recapture/captures.json";
const mergedPath =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/human-queue-20260820-v3-live-recapture/review/merged-decisions.json";
const outDir =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/review-approved-20260820-v4";

const alias = {
  通过: "pass",
  驳回: "reject",
  跳过: "skip",
  pass: "pass",
  reject: "reject",
  skip: "skip",
};

const v3 = JSON.parse(fs.readFileSync(v3DecisionsPath, "utf8"));
const recapture = JSON.parse(fs.readFileSync(recaptureDecisionsPath, "utf8"));
const captures = JSON.parse(fs.readFileSync(capturesPath, "utf8"));

const overlay = new Map(
  recapture.items.map((item) => [
    item.key,
    {
      key: item.key,
      decision: item.decision,
      note: item.note,
      source: "live-recapture",
    },
  ]),
);
const captureImage = new Map(captures.items.map((item) => [item.key, item.image]));

const missingOverlay = recapture.items
  .filter((item) => !v3.items.some((cell) => cell.key === item.key))
  .map((item) => item.key);
if (missingOverlay.length) {
  throw new Error(`recapture keys not in v3: ${missingOverlay.join(",")}`);
}

const mergedItems = v3.items.map((item) => {
  const hit = overlay.get(item.key);
  if (!hit) return { key: item.key, decision: item.decision, note: item.note, source: "v3" };
  return {
    key: item.key,
    decision: hit.decision,
    note: hit.note,
    source: "live-recapture",
  };
});

const counts = { 通过: 0, 驳回: 0, 跳过: 0 };
const flipped = [];
for (const item of mergedItems) {
  const prev = v3.items.find((cell) => cell.key === item.key);
  counts[item.decision] += 1;
  if (prev.decision !== item.decision) {
    flipped.push({ key: item.key, from: prev.decision, to: item.decision });
  }
}

const merged = {
  contract_version: "legacy-human-queue-decisions-v1",
  status: "decided",
  source: {
    v3: v3DecisionsPath,
    live_recapture: recaptureDecisionsPath,
  },
  cells: mergedItems.length,
  overlay_cells: overlay.size,
  counts,
  flipped,
  items: mergedItems,
};
fs.writeFileSync(mergedPath, `${JSON.stringify(merged, null, 2)}\n`);

if (process.argv[2] !== "patch-images") {
  console.log(JSON.stringify({
    phase: "merged-decisions",
    mergedPath,
    cells: mergedItems.length,
    overlay: overlay.size,
    counts,
    flipped,
  }, null, 2));
  process.exit(0);
}

const evalPath = path.join(outDir, "evaluations.jsonl");
const excludedPath = path.join(outDir, "excluded.jsonl");
const manifestPath = path.join(outDir, "manifest.json");
if (!fs.existsSync(evalPath)) throw new Error(`missing ${evalPath}`);

const passKeys = new Set(
  recapture.items
    .filter((item) => alias[item.decision] === "pass")
    .map((item) => item.key),
);
const evaluations = fs.readFileSync(evalPath, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
let patched = 0;
let missingImage = [];
for (const row of evaluations) {
  if (!passKeys.has(row.key)) continue;
  const image = captureImage.get(row.key);
  if (!image) {
    missingImage.push(row.key);
    continue;
  }
  if (row.cell_image !== image) {
    row.cell_image = image;
    patched += 1;
  }
}
if (missingImage.length) throw new Error(`missing recapture image: ${missingImage.join(",")}`);

function jsonl(rows) {
  return rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
}
function sha256Text(body) {
  return createHash("sha256").update(body).digest("hex");
}

const evalBody = jsonl(evaluations);
fs.writeFileSync(evalPath, evalBody);

const files = ["evaluations.jsonl", "courses.jsonl", "teachers.jsonl", "course_teachers.jsonl", "excluded.jsonl"];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
for (const name of files) {
  const body = fs.readFileSync(path.join(outDir, name));
  const text = body.toString("utf8");
  manifest.files[name] = {
    sha256: sha256Text(text),
    rows: text.trim() === "" ? 0 : text.trimEnd().split("\n").length,
  };
}
manifest.live_recapture_images_patched = patched;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const excluded = fs.existsSync(excludedPath) && fs.readFileSync(excludedPath, "utf8").trim()
  ? fs.readFileSync(excludedPath, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line))
  : [];

console.log(JSON.stringify({
  phase: "patch-images",
  outDir,
  patched,
  evaluations: evaluations.length,
  human_pass: evaluations.filter((row) => row.approval_source === "human_pass").length,
  auto: evaluations.filter((row) => row.approval_source === "auto_verify").length,
  excluded: excluded.map((row) => ({ key: row.key, decision: row.decision })),
  newly_from_recapture: flipped.filter((item) => item.to === "通过").map((item) => item.key),
}, null, 2));
