/// <reference types="vite/client" />

import "./style.css";

// Three variants of the course-teacher review workspace, switchable via ?variant=.

type VariantKey = "A" | "B" | "C";
type SortKey = "catalog" | "rating" | "count";
type ReviewSort = "recent" | "high" | "low";

type Review = {
  id: string;
  term: string;
  published: string;
  score: number;
  body: string;
  metrics: Array<[string, string]>;
};

type Relation = {
  id: string;
  teacher: string;
  course: string;
  code: string;
  department: string;
  category: "general" | "required" | "elective" | "sports" | "";
  rating: number | null;
  count: number;
  distribution: number[];
  metrics: Array<[string, number]>;
  reviews: Review[];
  legacy: string[];
  pinned?: boolean;
};

const detailedReviews: Review[] = [
  {
    id: "rv-1",
    term: "2026 春",
    published: "2026-07-18",
    score: 5,
    body: "讲解节奏很稳，推导过程不会跳步。作业量不算少，但每次作业都和考试题型有直接关系。考前会用一节课梳理常见错误，适合基础一般但愿意跟着练的人。",
    metrics: [
      ["知识收获", "5/5"],
      ["通过率/捞人", "5/5"],
      ["考勤严格度", "3/5"],
      ["考核公平", "5/5"],
      ["考核", "闭卷 + 平时作业"],
    ],
  },
  {
    id: "rv-2",
    term: "2025 秋",
    published: "2026-01-12",
    score: 4,
    body: "课堂信息量比较大，最好提前看一遍教材。老师答疑很认真，板书也清楚。期末难度比平时作业高一点，但没有偏题。",
    metrics: [
      ["知识收获", "5/5"],
      ["通过率/捞人", "4/5"],
      ["考勤严格度", "4/5"],
      ["考核公平", "4/5"],
      ["课堂", "板书为主"],
    ],
  },
  {
    id: "rv-3",
    term: "2025 春",
    published: "2025-07-08",
    score: 3,
    body: "概念讲得细，但例题偏少。点名不固定，平时分主要看作业。适合自学能力比较强的同学。",
    metrics: [
      ["知识收获", "3/5"],
      ["通过率/捞人", "3/5"],
      ["考勤严格度", "2/5"],
      ["考核公平", "4/5"],
    ],
  },
];

const relations: Relation[] = [
  {
    id: "rel-1",
    teacher: "陈嘉宁",
    course: "高等数学 A（上）",
    code: "MAT1001",
    department: "统计与数据科学学院",
    category: "required",
    rating: 4.3,
    count: 18,
    distribution: [10, 5, 2, 1, 0],
    metrics: [
      ["知识收获", 4.5],
      ["通过率/捞人", 4.1],
      ["考勤严格度", 3.2],
      ["考核公平", 4.4],
    ],
    reviews: detailedReviews,
    legacy: [
      "老师讲课细致，板书清楚，考试范围与课堂内容一致。",
      "作业需要认真完成，跟住课堂节奏后期压力会小很多。",
    ],
  },
  {
    id: "rel-2",
    teacher: "李文博",
    course: "高等数学 A（上）",
    code: "MAT1001",
    department: "统计与数据科学学院",
    category: "required",
    rating: 3.8,
    count: 27,
    distribution: [7, 10, 6, 3, 1],
    metrics: [
      ["知识收获", 4.1],
      ["通过率/捞人", 4.5],
      ["考勤严格度", 4.8],
      ["考核公平", 3.7],
    ],
    reviews: detailedReviews.map((review, index) => ({
      ...review,
      id: `li-${index}`,
      score: [4, 3, 4][index],
    })),
    legacy: [],
  },
  {
    id: "rel-3",
    teacher: "周子涵",
    course: "线性代数",
    code: "MAT1004",
    department: "统计与数据科学学院",
    category: "required",
    rating: 4.7,
    count: 42,
    distribution: [28, 10, 3, 1, 0],
    metrics: [
      ["知识收获", 4.7],
      ["通过率/捞人", 4.2],
      ["考勤严格度", 4.0],
      ["考核公平", 4.6],
    ],
    reviews: detailedReviews.map((review, index) => ({
      ...review,
      id: `zhou-${index}`,
      score: [5, 5, 4][index],
    })),
    legacy: ["逻辑很清楚，复习资料对考试帮助大。"],
  },
  {
    id: "rel-4",
    teacher: "胡海峰",
    course: "金融计量学",
    code: "FIN3302",
    department: "金融学院",
    category: "elective",
    rating: 5,
    count: 2,
    distribution: [2, 0, 0, 0, 0],
    metrics: [
      ["知识收获", 4.5],
      ["通过率/捞人", 5.0],
      ["考勤严格度", 2.0],
      ["考核公平", 5],
    ],
    reviews: detailedReviews.slice(0, 2).map((review, index) => ({
      ...review,
      id: `hu-${index}`,
      score: 5,
    })),
    legacy: [],
  },
  {
    id: "rel-5",
    teacher: "罗静怡",
    course: "财政学",
    code: "PUB2101",
    department: "财税与公共管理学院",
    category: "required",
    rating: null,
    count: 0,
    distribution: [0, 0, 0, 0, 0],
    metrics: [],
    reviews: [],
    legacy: [],
  },
  ...[
    ["王少杰", "微观经济学", "ECO2001", "经济学院", 4.1, 31, "required"],
    ["刘思远", "宏观经济学", "ECO2002", "经济学院", 3.9, 24, "required"],
    ["黄清", "会计学原理", "ACC1001", "会计学院", 4.5, 56, "required"],
    ["曾雨桐", "中级财务会计", "ACC2203", "会计学院", 4.2, 38, "required"],
    ["徐鹏", "Python 程序设计", "CST1102", "信息管理学院", 4.6, 45, "general"],
    ["万若曦", "数据库原理", "CST2301", "信息管理学院", 3.7, 19, "required"],
    ["熊凯", "大学英语 II", "ENG1002", "外国语学院", 4.0, 22, "general"],
    ["吴芳", "管理学原理", "MGT1001", "工商管理学院", 4.4, 34, "elective"],
    ["谢晨", "市场营销学", "MKT2101", "工商管理学院", 3.6, 12, "elective"],
    ["郑宇", "羽毛球", "PHE1021", "体育学院", 4.8, 63, "sports"],
    ["邓佳", "经济法", "LAW2104", "法学院", 4.1, 17, "general"],
    ["陶然", "概率论与数理统计", "MAT2003", "统计与数据科学学院", 4.3, 29, "required"],
    ["姚璐", "国际金融", "FIN2204", "金融学院", 3.8, 16, "elective"],
  ].map(([teacher, course, code, department, rating, count, category], index): Relation => ({
    id: `rel-${index + 6}`,
    teacher: String(teacher),
    course: String(course),
    code: String(code),
    department: String(department),
    category: category as Relation["category"],
    rating: Number(rating),
    count: Number(count),
    distribution: [10, 7, 3, 1, 0],
    metrics: [
      ["知识收获", Math.max(1, Number(rating) - 0.1)],
      ["通过率/捞人", Math.max(1, Number(rating) - 0.3)],
      ["考勤严格度", 3.8],
      ["考核公平", Math.max(1, Number(rating) - 0.2)],
    ],
    reviews: detailedReviews.slice(0, 2).map((review, reviewIndex) => ({
      ...review,
      id: `generated-${index}-${reviewIndex}`,
      score: reviewIndex ? Math.max(1, Math.round(Number(rating))) : 5,
    })),
    legacy: [],
  })),
];

const variants: Record<VariantKey, string> = {
  A: "目录阅读器",
  B: "证据工作台",
  C: "课程发现矩阵",
};

const url = new URL(window.location.href);
const initialVariant = url.searchParams.get("variant");
const state = {
  variant: (["A", "B", "C"].includes(initialVariant || "")
    ? initialVariant
    : "A") as VariantKey,
  relationId: url.searchParams.get("relation") || "",
  query: url.searchParams.get("q") || "",
  department: url.searchParams.get("department") || "",
  category: url.searchParams.get("category") || "",
  reviewedOnly: url.searchParams.get("reviewed") === "1",
  teacher: url.searchParams.get("teacher") || "",
  sort: (url.searchParams.get("sort") || "catalog") as SortKey,
  reviewSort: (url.searchParams.get("reviewSort") || "recent") as ReviewSort,
};

const app = document.querySelector<HTMLDivElement>("#app")!;

const esc = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function syncUrl() {
  const next = new URL(window.location.href);
  next.searchParams.set("variant", state.variant);
  const pairs: Array<[string, string]> = [
    ["relation", state.relationId],
    ["q", state.query],
    ["department", state.department],
    ["reviewed", state.reviewedOnly ? "1" : ""],
    ["teacher", state.teacher],
    ["sort", state.sort === "catalog" ? "" : state.sort],
    ["reviewSort", state.reviewSort === "recent" ? "" : state.reviewSort],
  ];
  for (const [key, value] of pairs) {
    if (value) next.searchParams.set(key, value);
    else next.searchParams.delete(key);
  }
  window.history.replaceState(null, "", next);
}

function filteredRelations() {
  const query = state.query.trim().toLocaleLowerCase("zh-CN");
  const result = relations.filter((relation) => {
    const matchesQuery =
      !query ||
      [relation.teacher, relation.course, relation.code]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(query);
    return (
      matchesQuery &&
      (!state.department || relation.department === state.department) &&
      (!state.category || relation.category === state.category) &&
      (!state.reviewedOnly || relation.count > 0) &&
      (!state.teacher || relation.teacher === state.teacher)
    );
  });
  return result.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (state.sort === "rating") {
      const aEligible = a.count >= 5;
      const bEligible = b.count >= 5;
      if (aEligible !== bEligible) return aEligible ? -1 : 1;
      return (b.rating || 0) - (a.rating || 0);
    }
    if (state.sort === "count") return b.count - a.count;
    return `${a.code}-${a.teacher}`.localeCompare(`${b.code}-${b.teacher}`, "zh-CN");
  });
}

function selectedRelation() {
  return relations.find((relation) => relation.id === state.relationId) || null;
}

function sortedReviews(relation: Relation) {
  const rows = [...relation.reviews];
  if (state.reviewSort === "high") return rows.sort((a, b) => b.score - a.score);
  if (state.reviewSort === "low") return rows.sort((a, b) => a.score - b.score);
  return rows.sort((a, b) => b.term.localeCompare(a.term, "zh-CN"));
}

function Header(active = "课评") {
  return `<header class="flex h-12 shrink-0 items-center justify-between border-b border-line bg-panel px-4 lg:px-6">
    <div class="flex h-full items-center gap-7">
      <strong class="text-[15px] text-ink">选课志</strong>
      <nav class="flex h-full items-center gap-1" aria-label="公开导航">
        ${["课评", "课程目录", "写评价"].map((item) => `<button class="h-full border-b-2 px-2 text-[13px] font-medium ${item === active ? "border-accent text-accent-strong" : "border-transparent text-muted hover:text-ink"}">${item}</button>`).join("")}
      </nav>
    </div>
    <span class="hidden text-[11px] font-semibold text-muted sm:inline">THROWAWAY UI PROTOTYPE</span>
  </header>`;
}

function FilterControls(compact = false) {
  const departments = [...new Set(relations.map((relation) => relation.department))];
  const categories = [
    { value: "general", label: "通识课" },
    { value: "required", label: "必修课" },
    { value: "elective", label: "选修课" },
    { value: "sports", label: "体育课" }
  ];
  return `<div class="${compact ? "grid grid-cols-2 gap-2" : "flex flex-wrap items-center gap-2"}">
    <label class="${compact ? "col-span-2" : "min-w-52 flex-1"}">
      <span class="sr-only">搜索教师、课程或课号</span>
      <input id="relation-search" value="${esc(state.query)}" placeholder="教师、课程或课号" class="h-9 w-full rounded-[5px] border border-line bg-white px-3 text-[13px] outline-none placeholder:text-slate-400 focus:border-accent" />
    </label>
    <select id="category-filter" aria-label="课程类型" class="h-9 min-w-0 rounded-[5px] border border-line bg-white px-2 text-[12px] text-slate-700 focus:border-accent">
      <option value="">全部类型</option>
      ${categories.map((cat) => `<option value="${cat.value}" ${state.category === cat.value ? "selected" : ""}>${cat.label}</option>`).join("")}
    </select>
    <select id="department-filter" aria-label="院系" class="h-9 min-w-0 rounded-[5px] border border-line bg-white px-2 text-[12px] text-slate-700 focus:border-accent">
      <option value="">全部院系</option>
      ${departments.map((department) => `<option value="${esc(department)}" ${state.department === department ? "selected" : ""}>${esc(department)}</option>`).join("")}
    </select>
    <select id="sort-filter" aria-label="排序" class="h-9 min-w-0 rounded-[5px] border border-line bg-white px-2 text-[12px] text-slate-700 focus:border-accent">
      <option value="catalog" ${state.sort === "catalog" ? "selected" : ""}>目录顺序</option>
      <option value="rating" ${state.sort === "rating" ? "selected" : ""}>推荐度</option>
      <option value="count" ${state.sort === "count" ? "selected" : ""}>评价数量</option>
    </select>
    <label class="flex h-9 items-center gap-2 whitespace-nowrap rounded-[5px] border border-line bg-white px-2 text-[12px] text-slate-700">
      <input id="reviewed-filter" type="checkbox" ${state.reviewedOnly ? "checked" : ""} class="size-3.5 accent-accent" />有评价
    </label>
  </div>`;
}

function RelationRow(relation: Relation, mode: "dense" | "reader" | "matrix") {
  const selected = state.relationId === relation.id;
  const selectedClass = selected
    ? "border-l-accent bg-accent-soft"
    : "border-l-transparent bg-white hover:bg-slate-50";
  const pinBadge = relation.pinned ? `<span class="inline-block shrink-0 rounded bg-accent-soft px-1 text-[9px] font-bold text-accent-strong">已钉</span>` : "";

  if (mode === "reader") {
    return `<button data-relation="${relation.id}" class="grid min-h-[58px] w-full grid-cols-[1fr_auto] gap-x-3 border-b border-l-[3px] border-line px-3 py-2 text-left ${selectedClass}">
      <span class="min-w-0 flex items-center gap-1"><span class="block truncate text-[13px] font-semibold">${esc(relation.teacher)}</span>${pinBadge}<span class="block truncate text-[13px] text-slate-700">${esc(relation.course)}</span></span>
      <span class="text-right"><b class="tabular block text-[16px] text-accent-strong">${relation.rating?.toFixed(1) || "—"}</b><small class="tabular text-[11px] text-muted">${relation.count} 条</small></span>
      <span class="col-span-2 mt-1 flex min-w-0 justify-between text-[11px] text-muted"><span class="truncate">${esc(relation.code)}</span><span class="truncate">${esc(relation.department)}</span></span>
    </button>`;
  }
  if (mode === "matrix") {
    return `<button data-relation="${relation.id}" class="grid min-h-12 w-full grid-cols-[90px_1fr_42px_40px] items-center gap-2 border-b border-l-[3px] border-line px-2 text-left text-[12px] ${selectedClass}">
      <b class="truncate text-[13px] flex items-center gap-1">${esc(relation.teacher)}${pinBadge}</b><span class="truncate text-slate-700">${esc(relation.course)}</span><span class="tabular text-right font-semibold text-accent-strong">${relation.rating?.toFixed(1) || "—"}</span><span class="tabular text-right text-muted">${relation.count}</span>
    </button>`;
  }
  return `<button data-relation="${relation.id}" class="grid min-h-12 w-full grid-cols-[1fr_48px] items-center gap-3 border-b border-l-[3px] border-line px-3 text-left ${selectedClass}">
    <span class="min-w-0"><span class="block truncate text-[13px] font-semibold flex items-center gap-1">${esc(relation.teacher)} <span class="font-normal text-slate-400">×</span> ${esc(relation.course)}${pinBadge}</span><span class="mt-0.5 flex justify-between gap-2 text-[11px] text-muted"><span>${esc(relation.code)}</span><span class="truncate">${esc(relation.department)}</span></span></span>
    <span class="text-right"><b class="tabular block text-[15px] text-accent-strong">${relation.rating?.toFixed(1) || "—"}</b><small class="tabular text-[10px] text-muted">${relation.count} 条</small></span>
  </button>`;
}

function EmptyDetail() {
  return `<div class="flex h-full min-h-72 items-center justify-center bg-white p-8 text-center">
    <div class="max-w-xs"><div class="mx-auto mb-4 flex size-10 items-center justify-center rounded-[6px] border border-line bg-canvas text-lg text-accent">↗</div><h2 class="text-[16px] font-semibold">尚未选择课评</h2><p class="mt-1 text-[13px] leading-6 text-muted">从左侧选择一条“教师 × 课程”任课关系。</p></div>
  </div>`;
}

function BackButton() {
  return `<button data-back class="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent lg:hidden">← 返回课评列表</button>`;
}

function Distribution(relation: Relation, vertical = false) {
  const total = Math.max(1, relation.distribution.reduce((sum, count) => sum + count, 0));
  return `<div class="${vertical ? "space-y-1.5" : "grid grid-cols-5 gap-2"}">
    ${relation.distribution.map((count, index) => {
      const percent = Math.round((count / total) * 100);
      const score = 5 - index;
      return vertical
        ? `<div class="grid grid-cols-[12px_1fr_30px] items-center gap-2 text-[10px] text-muted"><span>${score}</span><span class="h-1.5 overflow-hidden rounded-sm bg-slate-100"><span class="block h-full bg-accent" style="width:${percent}%"></span></span><span class="tabular text-right">${percent}%</span></div>`
        : `<div><div class="mb-1 flex justify-between text-[10px] text-muted"><span>${score}分</span><span class="tabular">${count}</span></div><div class="h-1.5 overflow-hidden rounded-sm bg-slate-100"><span class="block h-full bg-accent" style="width:${percent}%"></span></div></div>`;
    }).join("")}
  </div>`;
}

function Metrics(relation: Relation, columns = 4) {
  if (!relation.metrics.length) return `<p class="text-[12px] text-muted">暂无结构化维度</p>`;
  return `<dl class="grid gap-px overflow-hidden rounded-[5px] border border-line bg-line ${columns === 2 ? "grid-cols-2" : "grid-cols-2 xl:grid-cols-4"}">
    ${relation.metrics.map(([label, value]) => `<div class="bg-white px-3 py-2"><dt class="text-[10px] font-medium text-muted">${esc(label)}</dt><dd class="tabular mt-0.5 text-[15px] font-semibold text-slate-800">${value.toFixed(1)}</dd></div>`).join("")}
  </dl>`;
}

function ReviewSortControls() {
  const options: Array<[ReviewSort, string]> = [
    ["recent", "近期优先"],
    ["high", "推荐度高"],
    ["low", "推荐度低"],
  ];
  return `<div class="inline-flex rounded-[5px] border border-line bg-white p-0.5">
    ${options.map(([value, label]) => `<button data-review-sort="${value}" class="rounded-[3px] px-2.5 py-1 text-[11px] font-medium ${state.reviewSort === value ? "bg-accent-soft text-accent-strong" : "text-muted hover:text-ink"}">${label}</button>`).join("")}
  </div>`;
}

function ReviewMetrics(review: Review) {
  return `<dl class="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-y border-slate-100 py-2">
    ${review.metrics.map(([label, value]) => `<div class="flex gap-1.5 text-[11px]"><dt class="text-muted">${esc(label)}</dt><dd class="font-medium text-slate-700">${esc(value)}</dd></div>`).join("")}
  </dl>`;
}

function ReviewStreamA(relation: Relation) {
  const rows = sortedReviews(relation);
  if (!rows.length) return `<div class="border-y border-line py-14 text-center"><b class="text-[14px]">暂无学生投稿</b><p class="mt-1 text-[12px] text-muted">成为第一位评价这条任课关系的同学。</p></div>`;
  return rows.map((review) => `<article class="grid grid-cols-[44px_1fr] gap-4 border-b border-line py-4">
    <div class="tabular text-center"><b class="text-[22px] text-accent-strong">${review.score}</b><span class="block text-[10px] text-muted">/ 5</span></div>
    <div class="min-w-0"><div class="flex flex-wrap items-center justify-between gap-2"><b class="text-[12px]">匿名投稿 · ${esc(review.term)}</b><time class="text-[10px] text-muted">公开于 ${esc(review.published)}</time></div>${ReviewMetrics(review)}<details class="mt-3"><summary class="list-none"><p class="review-copy text-[13px] leading-6 text-slate-700">${esc(review.body)}</p><span class="mt-1 inline-block text-[11px] font-medium text-accent">展开全文</span></summary></details></div>
  </article>`).join("");
}

function ReviewStreamB(relation: Relation) {
  const rows = sortedReviews(relation);
  if (!rows.length) return `<div class="py-16 text-center text-[13px] text-muted">暂无学生投稿</div>`;
  return rows.map((review) => `<article class="relative border-l border-line pb-7 pl-6 before:absolute before:-left-1.5 before:top-1 before:size-3 before:rounded-full before:border-[3px] before:border-white before:bg-accent">
    <div class="mb-2 flex items-baseline justify-between gap-3"><div><b class="tabular mr-2 text-[18px] text-accent-strong">${review.score}.0</b><span class="text-[12px] font-semibold">${esc(review.term)}</span></div><time class="text-[10px] text-muted">${esc(review.published)}</time></div>
    <div class="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 bg-slate-50 px-3 py-2 sm:grid-cols-3">${review.metrics.map(([label, value]) => `<div class="flex justify-between gap-2 text-[10px]"><span class="text-muted">${esc(label)}</span><b class="font-medium text-slate-700">${esc(value)}</b></div>`).join("")}</div>
    <details><summary class="list-none"><p class="review-copy text-[13px] leading-6 text-slate-700">${esc(review.body)}</p><span class="mt-1 inline-block text-[11px] text-accent">展开全文</span></summary></details>
  </article>`).join("");
}

function ReviewStreamC(relation: Relation) {
  const rows = sortedReviews(relation);
  if (!rows.length) return `<div class="border-t border-line py-14 text-center text-[13px] text-muted">暂无学生投稿</div>`;
  return rows.map((review) => `<article class="grid grid-cols-[74px_1fr] border-t border-line">
    <div class="border-r border-line px-3 py-4 text-right"><b class="tabular block text-[20px] text-accent-strong">${review.score}/5</b><span class="block text-[10px] text-muted">${esc(review.term)}</span></div>
    <div class="px-4 py-4"><div class="flex flex-wrap gap-x-4 gap-y-1">${review.metrics.slice(0, 4).map(([label, value]) => `<span class="text-[10px] text-muted">${esc(label)} <b class="text-slate-700">${esc(value)}</b></span>`).join("")}</div><details class="mt-2"><summary class="list-none"><p class="review-copy text-[13px] leading-6 text-slate-700">${esc(review.body)}</p><span class="mt-1 inline-block text-[11px] text-accent">展开全文</span></summary></details></div>
  </article>`).join("");
}

function LegacySection(relation: Relation) {
  if (!relation.legacy.length) return "";
  return `<details class="mt-8 border-t border-line pt-4"><summary class="flex cursor-pointer list-none items-center justify-between text-[12px] font-semibold"><span>历史文字资料 <span class="ml-1 font-normal text-muted">${relation.legacy.length} 条，不参与评分</span></span><span class="text-muted">展开</span></summary><div class="mt-3 space-y-3 border-l-2 border-slate-200 pl-4">${relation.legacy.map((text) => `<p class="text-[12px] leading-5 text-muted">${esc(text)}</p>`).join("")}</div></details>`;
}

function RelationTitle(relation: Relation) {
  return `<div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><button data-teacher="${esc(relation.teacher)}" class="text-[20px] font-bold text-ink hover:text-accent">${esc(relation.teacher)}</button><span class="text-slate-300">×</span><button class="truncate text-[20px] font-bold text-ink hover:text-accent">${esc(relation.course)}</button><button data-pin="${relation.id}" class="ml-2 flex h-6 items-center rounded-[4px] border px-2 text-[11px] font-medium transition-colors ${relation.pinned ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-muted hover:border-slate-300 hover:text-ink"}">${relation.pinned ? "已钉" : "钉在左侧"}</button></div><p class="mt-1 text-[11px] text-muted">${esc(relation.code)} · ${esc(relation.department)}</p></div>`;
}

function VariantA(list: Relation[], relation: Relation | null) {
  const listClass = relation ? "hidden lg:flex" : "flex";
  const detailClass = relation ? "flex" : "hidden lg:flex";
  return `<div class="flex min-h-screen flex-col bg-canvas">${Header()}
    <main class="mx-auto grid h-[calc(100vh-48px)] w-full max-w-[1500px] grid-cols-1 overflow-hidden border-x border-line bg-white lg:grid-cols-[36%_64%]">
      <aside class="${listClass} min-h-0 flex-col border-r border-line bg-white"><div class="border-b border-line p-3">${FilterControls(true)}${state.teacher ? `<button data-clear-teacher class="mt-2 text-[11px] font-medium text-accent">教师：${esc(state.teacher)} ×</button>` : ""}</div><div class="flex items-center justify-between border-b border-line px-3 py-1.5 text-[10px] font-semibold text-muted"><span>${list.length} 条任课关系</span><span>评分 / 评价</span></div><div class="prototype-list-scroll prototype-scrollbar min-h-0 flex-1 overflow-y-auto">${list.map((item) => RelationRow(item, "dense")).join("") || `<div class="p-8 text-center text-[12px] text-muted">没有匹配的任课关系</div>`}</div></aside>
      <section class="${detailClass} prototype-scrollbar min-h-0 flex-col overflow-y-auto bg-white">${relation ? `<div class="mx-auto w-full max-w-4xl px-4 py-5 lg:px-7">${BackButton()}<div class="flex flex-wrap items-start justify-between gap-4">${RelationTitle(relation)}<div class="text-right"><div><b class="tabular text-[28px] leading-none text-accent-strong">${relation.rating?.toFixed(1) || "—"}</b><span class="text-[11px] text-muted"> / 5</span></div><p class="mt-1 text-[10px] text-muted">基于 ${relation.count} 条${relation.count > 0 && relation.count < 5 ? ` · <b class="text-amber-700">样本较少</b>` : ""}</p></div></div><div class="mt-5">${Distribution(relation)}</div><div class="mt-4">${Metrics(relation)}</div><div class="mt-6 flex items-center justify-between border-b border-line pb-2"><h2 class="text-[14px] font-semibold">学生投稿</h2>${ReviewSortControls()}</div>${ReviewStreamA(relation)}${LegacySection(relation)}</div>` : EmptyDetail()}</section>
    </main>
  </div>`;
}

function VariantB(list: Relation[], relation: Relation | null) {
  const listClass = relation ? "hidden lg:flex" : "flex";
  const detailClass = relation ? "flex" : "hidden lg:flex";
  return `<div class="flex min-h-screen flex-col bg-canvas">${Header()}
    <main class="grid h-[calc(100vh-48px)] grid-cols-1 overflow-hidden lg:grid-cols-[31%_69%]">
      <aside class="${listClass} min-h-0 flex-col border-r border-line bg-white"><div class="border-b border-line px-4 py-3"><div class="mb-2 flex items-center justify-between"><h1 class="text-[13px] font-semibold">任课关系索引</h1><span class="tabular text-[10px] text-muted">${list.length} RESULTS</span></div>${FilterControls(true)}</div><div class="prototype-list-scroll prototype-scrollbar min-h-0 flex-1 overflow-y-auto">${list.map((item) => RelationRow(item, "reader")).join("") || `<div class="p-8 text-center text-muted">没有匹配结果</div>`}</div></aside>
      <section class="${detailClass} prototype-scrollbar min-h-0 overflow-y-auto bg-white">${relation ? `<div class="min-h-full lg:grid lg:grid-cols-[220px_1fr] xl:grid-cols-[250px_1fr]">${BackButton()}<aside class="border-b border-line bg-slate-50/70 p-5 lg:sticky lg:top-0 lg:h-[calc(100vh-48px)] lg:border-b-0 lg:border-r"><p class="mb-4 text-[10px] font-semibold uppercase text-muted">评价证据</p><div><b class="tabular text-[38px] leading-none text-accent-strong">${relation.rating?.toFixed(1) || "—"}</b><span class="text-[11px] text-muted"> / 5</span></div><p class="mt-1 text-[11px] text-muted">${relation.count} 条审核通过投稿</p>${relation.count > 0 && relation.count < 5 ? `<p class="mt-2 inline-block rounded-[4px] bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">样本较少</p>` : ""}<div class="mt-5">${Distribution(relation, true)}</div><div class="mt-6 space-y-3">${relation.metrics.map(([label, value]) => `<div><div class="mb-1 flex justify-between text-[10px]"><span class="text-muted">${esc(label)}</span><b class="tabular">${value.toFixed(1)}</b></div><div class="h-1.5 bg-white"><div class="h-full bg-accent" style="width:${value * 20}%"></div></div></div>`).join("") || `<span class="text-[11px] text-muted">暂无维度数据</span>`}</div></aside><div class="mx-auto w-full max-w-3xl px-5 py-6 lg:px-8"><div class="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-5">${RelationTitle(relation)}<button class="rounded-[5px] bg-accent px-3 py-2 text-[12px] font-semibold text-white">写评价</button></div><div class="my-5 flex items-center justify-between"><div><h2 class="text-[14px] font-semibold">学生投稿</h2><p class="text-[10px] text-muted">结构化指标与正文来自同一份问卷</p></div>${ReviewSortControls()}</div>${ReviewStreamB(relation)}${LegacySection(relation)}</div></div>` : EmptyDetail()}</section>
    </main>
  </div>`;
}

function VariantC(list: Relation[], relation: Relation | null) {
  const grouped = Map.groupBy(list, (item) => `${item.code} · ${item.course}`);
  const listClass = relation ? "hidden lg:flex" : "flex";
  const detailClass = relation ? "flex" : "hidden lg:flex";
  const filterClass = relation ? "hidden lg:block" : "block";
  const mainHeight = relation
    ? "h-[calc(100vh-48px)] lg:h-[calc(100vh-106px)]"
    : "h-[calc(100vh-106px)]";
  return `<div class="flex min-h-screen flex-col bg-white">${Header()}
    <div class="${filterClass} border-b border-line bg-canvas px-3 py-2 lg:px-5"><div class="mx-auto max-w-[1600px]">${FilterControls(false)}${state.teacher ? `<button data-clear-teacher class="mt-2 text-[11px] text-accent">教师筛选：${esc(state.teacher)} ×</button>` : ""}</div></div>
    <main class="${mainHeight} mx-auto grid w-full max-w-[1600px] grid-cols-1 overflow-hidden lg:grid-cols-[43%_57%]">
      <aside class="${listClass} min-h-0 flex-col border-r border-line"><div class="grid grid-cols-[90px_1fr_42px_40px] gap-2 border-b border-line bg-slate-50 px-2 py-1.5 text-[10px] font-semibold text-muted"><span>教师</span><span>课程</span><span class="text-right">评分</span><span class="text-right">评价</span></div><div class="prototype-list-scroll prototype-scrollbar min-h-0 flex-1 overflow-y-auto">${[...grouped.entries()].map(([course, items]) => `<section><div class="sticky top-0 z-10 border-b border-line bg-slate-100/95 px-3 py-1 text-[10px] font-semibold text-slate-600">${esc(course)} · ${items.length} 位教师</div>${items.map((item) => RelationRow(item, "matrix")).join("")}</section>`).join("") || `<div class="p-8 text-center text-muted">没有匹配结果</div>`}</div></aside>
      <section class="${detailClass} prototype-scrollbar min-h-0 flex-col overflow-y-auto">${relation ? `<div>${BackButton()}<div class="border-b border-line px-4 py-4 lg:px-6"><div class="flex flex-wrap items-start justify-between gap-3">${RelationTitle(relation)}<button class="rounded-[5px] border border-accent px-3 py-1.5 text-[11px] font-semibold text-accent">写评价</button></div></div><div class="grid grid-cols-[110px_1fr] border-b border-line"><div class="flex flex-col justify-center border-r border-line px-4 py-3"><b class="tabular text-[28px] text-accent-strong">${relation.rating?.toFixed(1) || "—"}</b><span class="text-[10px] text-muted">${relation.count} 条${relation.count > 0 && relation.count < 5 ? " · 样本较少" : ""}</span></div><div class="min-w-0 px-4 py-3">${Distribution(relation)}</div></div><div class="border-b border-line px-4 py-3">${Metrics(relation)}</div><div class="flex items-center justify-between px-4 py-3"><h2 class="text-[12px] font-semibold">按学期排列的学生投稿</h2>${ReviewSortControls()}</div>${ReviewStreamC(relation)}<div class="px-4 pb-8">${LegacySection(relation)}</div></div>` : EmptyDetail()}</section>
    </main>
  </div>`;
}

function PrototypeSwitcher() {
  if (!import.meta.env.DEV) return "";
  const relation = selectedRelation();
  const visibleState = [
    relation ? `${relation.teacher} × ${relation.course}` : "未选择",
    state.query ? `搜索:${state.query}` : "",
    state.teacher ? `教师:${state.teacher}` : "",
  ].filter(Boolean).join(" · ");
  return `<div class="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-[6px] bg-slate-950 px-2 py-1.5 text-white shadow-lg" role="toolbar" aria-label="原型变体切换器">
    <button data-cycle="-1" class="flex size-8 items-center justify-center rounded-[4px] hover:bg-white/15" title="上一个变体">←</button>
    <div class="min-w-0 px-2 text-center"><b class="block text-[12px]">${state.variant} — ${variants[state.variant]}</b><span class="block max-w-72 truncate text-[9px] text-slate-300">${esc(visibleState)}</span></div>
    <button data-cycle="1" class="flex size-8 items-center justify-center rounded-[4px] hover:bg-white/15" title="下一个变体">→</button>
  </div>`;
}

function render(preserveSearch = false) {
  syncUrl();
  const list = filteredRelations();
  const relation = selectedRelation();
  app.innerHTML =
    (state.variant === "A"
      ? VariantA(list, relation)
      : state.variant === "B"
        ? VariantB(list, relation)
        : VariantC(list, relation)) + PrototypeSwitcher();
  bindInteractions(preserveSearch);
}

function cycleVariant(direction: number) {
  const keys: VariantKey[] = ["A", "B", "C"];
  const index = keys.indexOf(state.variant);
  state.variant = keys[(index + direction + keys.length) % keys.length];
  render();
}

function bindInteractions(preserveSearch: boolean) {
  const search = document.querySelector<HTMLInputElement>("#relation-search");
  if (preserveSearch && search) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
  search?.addEventListener("input", () => {
    state.query = search.value;
    render(true);
  });
  document.querySelector<HTMLSelectElement>("#category-filter")?.addEventListener("change", (event) => {
    state.category = (event.currentTarget as HTMLSelectElement).value as Relation["category"];
    render();
  });
  document.querySelector<HTMLSelectElement>("#department-filter")?.addEventListener("change", (event) => {
    state.department = (event.currentTarget as HTMLSelectElement).value;
    render();
  });
  document.querySelector<HTMLSelectElement>("#sort-filter")?.addEventListener("change", (event) => {
    state.sort = (event.currentTarget as HTMLSelectElement).value as SortKey;
    render();
  });
  document.querySelector<HTMLInputElement>("#reviewed-filter")?.addEventListener("change", (event) => {
    state.reviewedOnly = (event.currentTarget as HTMLInputElement).checked;
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-relation]").forEach((button) => {
    button.addEventListener("click", () => {
      state.relationId = button.dataset.relation || "";
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-review-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewSort = button.dataset.reviewSort as ReviewSort;
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-teacher]").forEach((button) => {
    button.addEventListener("click", () => {
      state.teacher = button.dataset.teacher || "";
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-pin]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.pin;
      const relation = relations.find(r => r.id === id);
      if (relation) {
        relation.pinned = !relation.pinned;
        render();
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-clear-teacher]").forEach((button) => {
    button.addEventListener("click", () => {
      state.teacher = "";
      render();
    });
  });
  document.querySelector<HTMLButtonElement>("[data-back]")?.addEventListener("click", () => {
    state.relationId = "";
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-cycle]").forEach((button) => {
    button.addEventListener("click", () => cycleVariant(Number(button.dataset.cycle)));
  });
}

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea, select, [contenteditable]")) return;
  if (event.key === "ArrowLeft") cycleVariant(-1);
  if (event.key === "ArrowRight") cycleVariant(1);
});

window.addEventListener("popstate", () => window.location.reload());

render();
