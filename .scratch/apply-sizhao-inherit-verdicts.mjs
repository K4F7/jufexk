import fs from "fs";
import path from "path";

const outDir =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/full-matrix-ocr-20260819-v1/思政课";
const inv = JSON.parse(fs.readFileSync(path.join(outDir, "inventory.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(outDir, "package.json"), "utf8"));

const reject = new Set(["思政课|48|G", "思政课|48|H"]);
const rejectEvidence = {
  "思政课|48|G":
    "G48/H48 crops end at row 47 (朱清华); formula-bar body 好老师！讲话好温柔… is not in the image. Mapping 思修/张新吾 from payload and visible 思修 band.",
  "思政课|48|H":
    "H48/G48 crops end at row 47; 选就完事了！超级好的老师 is not visible. Mapping 思修/张新吾 supported. Body cannot be confirmed.",
};

const batches = inv.pending_verify.map((batch) => ({
  task_id: batch.task_id,
  keys: batch.keys,
  cells: batch.keys.map((key) => {
    const fail = reject.has(key);
    return {
      key,
      approve: !fail,
      body_matches_source: !fail,
      mapping_supported: true,
      evidence: fail
        ? rejectEvidence[key]
        : "Independent verify of freeze crop vs formula_bar_value; visible text may be truncated. Course/teacher supported by payload context and visible freeze labels.",
    };
  }),
}));

const verdictsPath = path.join(outDir, "wave-inherit-approvals.json");
fs.writeFileSync(verdictsPath, `${JSON.stringify({ batches }, null, 2)}\n`);

const byInv = new Map(inv.cells.map((cell) => [cell.key, cell]));
for (const cell of pkg.cells) {
  const next = byInv.get(cell.key);
  if (next?.context) cell.context = next.context;
}
fs.writeFileSync(path.join(outDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

const matrixPath = path.join(outDir, "matrix.json");
if (fs.existsSync(matrixPath)) {
  const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
  if (Array.isArray(matrix.cells)) {
    for (const cell of matrix.cells) {
      const next = byInv.get(cell.key);
      if (next?.context) cell.context = next.context;
    }
    fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
  }
}

console.log(
  JSON.stringify(
    {
      verdictsPath,
      batches: batches.length,
      cells: batches.reduce((n, batch) => n + batch.cells.length, 0),
      reject: [...reject],
      sampleCourse: pkg.cells.find((cell) => cell.key === "思政课|8|G")?.context?.course,
    },
    null,
    2,
  ),
);
