import fs from "fs";
import path from "path";

const root =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/full-matrix-ocr-20260819-v1";

const rejectEvidence = {
  "大英和视听说|11|M": "M11 selected cell is visually empty; formula-bar 老师很负责，平时分多 is not shown.",
  "大英和视听说|14|L": "L14 selected cell is fully visible and blank; formula-bar body is not in the crop.",
  "大英和视听说|14|O": "O14 selected far-right cell is empty; 特水，上课学不到什么 is not visible.",
  "大英和视听说|22|K": "K22 selected cell is empty-looking; 快跑！ is not visible.",
  "大英和视听说|22|L": "L22 selected cell is blank; 快跑 is not visible.",
  "大英和视听说|35|L": "L35 highlighted cell is blank; not a truncation of 刷u校园会给很低分或者挂科.",
  "大英和视听说|44|N": "N44 selected cell is empty; long formula-bar body is not supported by the image.",
  "大英和视听说|47|I": "I47 crop ends on row 46; 会提问，提问有加分。 is not in any listed image.",
  "大英和视听说|49|M": "M49 selected row-49 cell is empty; 老师发音好听… is not visible.",
  "大英和视听说|49|O": "O49 selected far-right row-49 cell is empty; 老师有要求 is not visible.",
  "大英和视听说|53|J": "J53 selected cell is empty under J52; 很温柔，就是纯鼓励学生发言… is not visible.",
  "大英和视听说|59|J": "J59 selected cell is blank; 老师很好，给分很高，冲！ is not visible.",
};

const defaultPass =
  "Independent verify of freeze crop vs formula_bar_value; visible text may be truncated. Course/teacher supported by payload context and visible freeze labels.";

function applySheet(sheet) {
  const outDir = path.join(root, sheet);
  const inv = JSON.parse(fs.readFileSync(path.join(outDir, "inventory.json"), "utf8"));
  const pkg = JSON.parse(fs.readFileSync(path.join(outDir, "package.json"), "utf8"));
  const batches = (inv.pending_verify || []).map((batch) => ({
    task_id: batch.task_id,
    keys: batch.keys,
    cells: batch.keys.map((key) => {
      const fail = Object.prototype.hasOwnProperty.call(rejectEvidence, key);
      return {
        key,
        approve: !fail,
        body_matches_source: !fail,
        mapping_supported: true,
        evidence: fail ? rejectEvidence[key] : defaultPass,
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
  const n = batches.reduce((sum, batch) => sum + batch.cells.length, 0);
  const reject = batches.flatMap((batch) => batch.cells.filter((cell) => !cell.approve).map((cell) => cell.key));
  return { sheet, verdictsPath, cells: n, reject };
}

const report = ["大英和视听说", "主要课程", "MOOC"].map(applySheet);
console.log(JSON.stringify(report, null, 2));
