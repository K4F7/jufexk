import fs from "fs";
import path from "path";

const dir =
  "D:/19016/Documents/Workload/jufexk/scripts/legacy_evidence/output/human-queue-20260820-v3";
const q = JSON.parse(fs.readFileSync(path.join(dir, "human-queue.json"), "utf8"));

const cells = [
  { key: "大英和视听说|10|L", decision: "通过", note: "公式栏与L10可见评语一致，课程页为「大英和视听说」，可作张晓花评价。" },
  { key: "大英和视听说|10|M", decision: "通过", note: "公式栏与M10可见评语一致，内容可作该行教师评价。" },
  { key: "大英和视听说|10|N", decision: "驳回", note: "评语写的是「实用英语口语」，与申报课程「大英和视听说」不符。" },
  { key: "大英和视听说|10|O", decision: "驳回", note: "选中的O10为空，公式栏文本无法作为该格评价正文。" },
  { key: "大英和视听说|11|J", decision: "通过", note: "公式栏与J11可见评语一致，可作张生萍评价。" },
  { key: "大英和视听说|11|L", decision: "通过", note: "公式栏与L11可见评语一致，可作该行教师评价。" },
  { key: "大英和视听说|11|M", decision: "驳回", note: "选中的M11为空，公式栏「老师很负责，平时分多」无法对应。" },
  { key: "大英和视听说|14|L", decision: "驳回", note: "选中的L14为空，公式栏长评无法作为该格评价正文。" },
  { key: "大英和视听说|14|O", decision: "通过", note: "编辑栏「特水，上课学不到什么」是可入库短评，教师按载荷为张萍萍。" },
  { key: "大英和视听说|19|I", decision: "通过", note: "编辑栏「上大英4,事很多」是可入库评价，教师按载荷为余丽文。" },
  { key: "大英和视听说|22|K", decision: "通过", note: "编辑栏「快跑！」是可入库短评，教师按载荷为徐惠莲。" },
  { key: "大英和视听说|22|L", decision: "通过", note: "编辑栏「快跑」是可入库短评，映射仍为徐惠莲/大英和视听说。" },
  { key: "大英和视听说|27|H", decision: "通过", note: "可见正文与编辑栏一致，教师按载荷为吴春英。" },
  { key: "大英和视听说|35|L", decision: "通过", note: "编辑栏「刷u校园会给很低分或者挂科」是可入库评价，教师按载荷为饶纪红。" },
  { key: "大英和视听说|43|H", decision: "通过", note: "可见截断正文与编辑栏一致，教师按载荷为刘雯祺。" },
  { key: "大英和视听说|43|I", decision: "通过", note: "可见截断正文与编辑栏一致，映射仍为刘雯祺/大英和视听说。" },
  { key: "大英和视听说|43|J", decision: "通过", note: "公式栏完整评语，表为大英和视听说且第43行教师为刘雯祺。" },
  { key: "大英和视听说|43|K", decision: "通过", note: "选中格可见前缀与公式栏一致，课程与第43行刘雯祺对应。" },
  { key: "大英和视听说|43|L", decision: "通过", note: "公式栏评语可入库，课程与刘雯祺对应。" },
  { key: "大英和视听说|43|O", decision: "通过", note: "公式栏可作评语，映射为刘雯祺/大英和视听说。" },
  { key: "大英和视听说|44|N", decision: "驳回", note: "选中格可见另一条评语，与公式栏刘老师口语课长评不是同一条。" },
  { key: "大英和视听说|45|K", decision: "通过", note: "公式栏「平时分给满了 老师巨好」可入库，该行教师为刘峰。" },
  { key: "大英和视听说|47|I", decision: "通过", note: "公式栏「会提问，提问有加分。」可入库，教师按表为李洁宏。" },
  { key: "大英和视听说|49|M", decision: "驳回", note: "邻格可读而选中的M49为空，公式栏正文并未出现在该格。" },
  { key: "大英和视听说|49|O", decision: "驳回", note: "O49选中格为空，公式栏「老师有要求」不是该格可见正文。" },
  { key: "大英和视听说|51|K", decision: "通过", note: "K51可见正文与公式栏一致，对应黄燕红/大英和视听说。" },
  { key: "大英和视听说|51|L", decision: "通过", note: "第51行冻结名为黄燕红，可见截断与公式栏一致。" },
  { key: "大英和视听说|52|J", decision: "通过", note: "J52可见正文与公式栏一致，对应黄荃（大英）。" },
  { key: "大英和视听说|53|J", decision: "通过", note: "J53可见正文与公式栏一致，对应黄俐。" },
  { key: "大英和视听说|54|I", decision: "通过", note: "I54可见截断与公式栏一致，对应胡蓉。" },
  { key: "大英和视听说|54|K", decision: "通过", note: "公式栏可作评价入库，对应胡蓉。" },
  { key: "大英和视听说|56|J", decision: "驳回", note: "J56选中格为空，公式栏「同2」是指向性备注而非可入库评价正文。" },
  { key: "大英和视听说|59|J", decision: "通过", note: "公式栏为完整评语，第59行冻结教师是邓琼。" },
  { key: "大英和视听说|65|H", decision: "通过", note: "公式栏为完整评语，载荷对应大英和视听说/曾传玉。" },
  { key: "美育|12|E", decision: "通过", note: "公式栏为完整评语，载荷对应中国茶文化和茶艺/艾晓玉。" },
  { key: "思政课|12|G", decision: "通过", note: "可见评语是公式栏截断，冻结区为马原、教师李德满。" },
  { key: "思政课|12|H", decision: "通过", note: "可见正文与公式栏一致，冻结区为马原、李德满。" },
  { key: "思政课|15|K", decision: "通过", note: "可见文本与公式栏一致，第15行教师黄三生且同属马原。" },
  { key: "思政课|16|H", decision: "通过", note: "可见文本与公式栏一致，第16行教师陈仕伟且同属马原。" },
  { key: "思政课|19|G", decision: "通过", note: "可见评语是公式栏截断，第19行教师李立娥，载荷课程为毛概。" },
  { key: "思政课|27|G", decision: "通过", note: "冻结列为毛概，公式栏与G27可见截断及康立芳行评语一致。" },
  { key: "思政课|27|H", decision: "通过", note: "公式栏与康立芳行H列可见评语一致，课程为毛概。" },
  { key: "思政课|27|I", decision: "通过", note: "可见文本是公式栏截断，映射为毛概康立芳。" },
  { key: "思政课|27|J", decision: "通过", note: "可见正文与公式栏一致且被截断，教师为康立芳。" },
  { key: "思政课|27|K", decision: "通过", note: "公式栏与康立芳行K列可见评语一致，课程为毛概。" },
  { key: "思政课|27|L", decision: "通过", note: "可见文本是公式栏截断，冻结课程为毛概。" },
  { key: "思政课|27|M", decision: "通过", note: "公式栏「真的恶心人🤮」可作为评语，格面空白，映射仍为毛概康立芳。" },
  { key: "思政课|28|G", decision: "通过", note: "选中格全文与公式栏一致，冻结列为毛概、教师为李德满。" },
  { key: "思政课|28|H", decision: "通过", note: "公式栏是对李德满的完整评价，冻结行可见该教师，毛概映射成立。" },
  { key: "思政课|28|I", decision: "通过", note: "公式栏与单元格可见文本一致，教师为李德满。" },
  { key: "思政课|29|G", decision: "通过", note: "公式栏与可见单元格同文，教师廖中武。" },
  { key: "思政课|29|H", decision: "通过", note: "公式栏与可见截断吻合，冻结行教师为廖中武，毛概映射成立。" },
  { key: "思政课|29|I", decision: "通过", note: "公式栏以「毛概」起句且可见部分截断吻合，教师廖中武。" },
  { key: "思政课|34|K", decision: "通过", note: "冻结区可见近代史，公式栏与单元格可见评价一致，可作陈安丽评价正文。" },
  { key: "思政课|34|L", decision: "通过", note: "冻结区为近代史，公式栏完整、可见部分截断。" },
  { key: "思政课|34|M", decision: "通过", note: "冻结区为近代史，公式栏与单元格可见文本一致。" },
  { key: "思政课|35|H", decision: "通过", note: "H35可见文本与公式栏一致，李德满/近代史。" },
  { key: "思政课|35|I", decision: "通过", note: "I35「选他」可入库，李德满/近代史。" },
  { key: "思政课|37|G", decision: "通过", note: "G37截断格与公式栏一致，熊小欣。" },
  { key: "思政课|37|H", decision: "通过", note: "H37截断格与公式栏一致，熊小欣。" },
  { key: "思政课|37|I", decision: "通过", note: "I37截断格与公式栏一致，熊小欣。" },
  { key: "思政课|46|K", decision: "通过", note: "K46截断格与公式栏一致，赵建超/思修。" },
  { key: "思政课|47|G", decision: "跳过", note: "截图只到第46行，未见朱清华的G47。" },
  { key: "思政课|47|H", decision: "跳过", note: "截图只到第46行，未见朱清华的H47。" },
  { key: "思政课|47|I", decision: "通过", note: "公式栏「人巨温柔！！！」与I47格一致，可作评价正文。" },
  { key: "思政课|48|G", decision: "通过", note: "公式栏是完整教师评价，载荷映射思修/张新吾。" },
  { key: "思政课|48|H", decision: "通过", note: "公式栏「选就完事了！超级好的老师」可作评价正文，思修/张新吾。" },
  { key: "体育课|21|G", decision: "通过", note: "选中格与公式栏羽毛球评价一致，该行无教师名与载荷一致。" },
  { key: "体育课|27|G", decision: "通过", note: "冻结栏为跆拳道，选中格与公式栏全文一致。" },
  { key: "体育课|28|G", decision: "通过", note: "选中格长评与公式栏一致，武术/刘春来未见矛盾。" },
  { key: "体育课|30|F", decision: "通过", note: "选中格可见正文与公式栏一致，武术/彭澄升。" },
  { key: "体育课|30|G", decision: "通过", note: "选中格与公式栏全文一致，武术/彭澄升。" },
  { key: "体育课|34|K", decision: "通过", note: "冻结栏为体育舞蹈，行34教师付艳，公式栏与可见截断一致。" },
  { key: "体育课|36|D", decision: "通过", note: "冻结栏为乒乓球、教师赵建强，公式栏与可见评语一致。" },
  { key: "体育课|37|J", decision: "通过", note: "冻结栏为乒乓球、教师彭永善，公式栏与可见截断一致。" },
  { key: "体育课|39|D", decision: "通过", note: "行39教师张晓英、课程篮球，公式栏与可见评语一致。" },
  { key: "体育课|40|D", decision: "通过", note: "行40属篮球/熊三平，公式栏与可见截断相符。" },
  { key: "体育课|40|E", decision: "通过", note: "同行映射为篮球/熊三平，公式栏是可入库完整评语。" },
  { key: "体育课|40|F", decision: "通过", note: "同行映射为篮球/熊三平，公式栏与可见截断一致。" },
  { key: "体育课|40|G", decision: "通过", note: "同行映射为篮球/熊三平，公式栏短评可入库。" },
  { key: "体育课|6|D", decision: "通过", note: "公式栏评语完整可入库，冻结区教师为李强。" },
  { key: "体育课|6|E", decision: "通过", note: "可见正文与公式栏一致，同行冻结教师李强。" },
  { key: "体育课|6|F", decision: "通过", note: "可见评语与公式栏一致，可入库。" },
  { key: "体育课|6|G", decision: "通过", note: "可见文本是公式栏截断，映射与同行冻结一致。" },
  { key: "主要课程|101|G", decision: "跳过", note: "证据图只到第100行，未见第101行单元格及周美华。" },
  { key: "主要课程|173|F", decision: "驳回", note: "公式栏可用且课程为货币银行学，但该行教师为空，映射不成立。" },
  { key: "主要课程|180|F", decision: "驳回", note: "可见评语与公式栏一致，但教师格为空，映射不成立。" },
  { key: "主要课程|180|G", decision: "驳回", note: "可见评语与公式栏一致，但该行教师为空，无法对应课程教师。" },
  { key: "主要课程|421|H", decision: "通过", note: "公式栏可作评价正文，冻结区教师为张驰。" },
  { key: "主要课程|56|H", decision: "通过", note: "公式栏可存，第56行教师列空白与载荷一致。" },
  { key: "主要课程|56|I", decision: "通过", note: "公式栏可作正文，映射为音乐鉴赏且教师为空。" },
  { key: "主要课程|56|J", decision: "通过", note: "公式栏可存，同一行课程为音乐鉴赏且无教师。" },
  { key: "主要课程|56|K", decision: "通过", note: "公式栏可存，映射为音乐鉴赏且教师为空。" },
  { key: "主要课程|56|L", decision: "通过", note: "公式栏可存，映射成立。" },
  { key: "主要课程|56|M", decision: "通过", note: "公式栏可作评价正文，同行为音乐鉴赏且教师为空。" },
];

const alias = { 通过: "pass", 驳回: "reject", 跳过: "skip", pass: "pass", reject: "reject", skip: "skip" };
const byKey = new Map(cells.map((item) => [item.key, item]));
const missing = q.items.filter((item) => !byKey.has(item.key)).map((item) => item.key);
const extra = cells.filter((item) => !q.items.some((cell) => cell.key === item.key)).map((item) => item.key);
if (missing.length || extra.length) {
  throw new Error(`key mismatch missing=${missing.join(",")} extra=${extra.join(",")}`);
}

for (const item of q.items) {
  const hit = byKey.get(item.key);
  item.decision = alias[hit.decision];
  item.note = hit.note;
}
q.status = "decided";

const counts = { 通过: 0, 驳回: 0, 跳过: 0 };
for (const item of cells) counts[item.decision] += 1;

fs.writeFileSync(path.join(dir, "human-queue.json"), `${JSON.stringify(q, null, 2)}\n`);
fs.writeFileSync(path.join(dir, "decisions.json"), `${JSON.stringify({ items: cells }, null, 2)}\n`);

const mdPath = path.join(dir, "manual-review.md");
let md = fs.readFileSync(mdPath, "utf8");
for (const item of cells) {
  const needle = `- **key**: \`${item.key}\``;
  const start = md.indexOf(needle);
  if (start < 0) throw new Error(`md missing ${item.key}`);
  const blockEnd = md.indexOf("\n---", start);
  const block = md.slice(start, blockEnd);
  const next = block
    .replace(/- \*\*decision\*\*:.*/, `- **decision**: ${item.decision}`)
    .replace(/- \*\*note\*\*:.*/, `- **note**: ${item.note}`);
  md = md.slice(0, start) + next + md.slice(blockEnd);
}
fs.writeFileSync(mdPath, md);

console.log(JSON.stringify({ n: cells.length, counts, missing, extra }, null, 2));
