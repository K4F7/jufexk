import "./style.css";
import { reviewFieldsMarkup, teacherCourseRowMarkup } from "./templates";
type Course = {
  id: number;
  code: string;
  name: string;
  category: string;
  department: string;
  teachers: string;
  review_count: number;
  rating: number;
};
type Teacher = {
  id: number;
  name: string;
  department: string;
  title: string;
  bio: string;
};
function $<T = any>(s: string): T;
function $(s: string) {
  return document.querySelector(s)!;
}
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>'"]/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        ch
      ]!,
  );
const labels: Record<string, string> = {
  major: "专业课",
  pe: "体育课",
  general: "公共选修",
};
let courses: Course[] = [],
  courseOptions: Course[] = [],
  page = 1,
  pages = 1,
  csrf = "";
$("#app").innerHTML =
  `<header><nav><button data-go="browse">课程</button><button data-go="faculty">教师</button><button data-go="submit">写评价</button><button data-go="admin">后台</button></nav></header><main>
<section id="landing" class="page"><div class="landing"><h1 class="slogan-hero">关于一门课，<br>上过的人最清楚。</h1><form id="landing-search"><input id="landing-q" placeholder="课程、课号或教师" aria-label="查找课程、课号或教师"><button class="primary">查找</button></form><button class="enter-catalog" data-go="browse">进入课程目录 →</button></div></section>
<section id="browse" class="page hidden"><div class="toolbar"><input id="q" placeholder="搜索课程、课号或教师"><select id="category"><option value="">所有课程</option><option value="major">专业课</option><option value="pe">体育课</option><option value="general">公共选修</option></select><input id="department" placeholder="院系"><button class="primary" data-go="submit">写评价</button></div><div class="section-head"><h2>课程目录</h2><span id="count"></span></div><div class="table-scroll"><table class="list"><thead><tr><th>课号</th><th>课程</th><th>类别</th><th>教师</th><th>院系</th><th class="num">评分</th><th class="num">评价</th></tr></thead><tbody id="courses"></tbody></table></div><div id="pager"></div></section>
<section id="faculty" class="page hidden"><div class="section-head"><h2>教师资料</h2></div><div class="table-scroll"><table class="list"><thead><tr><th>姓名</th><th>职称</th><th>院系</th><th class="num">评分</th><th class="num">课程数</th></tr></thead><tbody id="teachers"></tbody></table></div></section>
<section id="detail" class="page hidden"><button class="back" data-go="browse">← 返回</button><div id="course-detail"></div></section>
<section id="teacher-detail" class="page hidden"><button class="back" data-go="faculty">← 返回</button><div id="teacher-profile"></div></section>
<section id="submit" class="page hidden narrow"><h1>写评价</h1><p class="lede">评价必须绑定具体任课教师，投稿经审核后公开。只有课程、任课教师和总体推荐度是必填。</p><ol id="wizard-progress" class="wizard-progress"><li data-step="1">评价对象</li><li data-step="2">总体评价</li><li data-step="3">课堂与考核</li><li data-step="4">确认提交</li></ol><div id="review-turnstile"></div><p id="review-turnstile-status" class="form-note"></p><form id="review-form"><fieldset class="step" data-step="1"><label>课程<select name="courseId" id="course-select" required></select></label><label>开课班（选填）<select id="offering-select"><option value="">不指定</option></select></label><label>任课教师<select name="teacherId" id="teacher-select" required></select></label><p class="form-note">找不到你的课程或教师？<button type="button" class="link" data-go="catalog-request">提交补充申请</button></p></fieldset><fieldset class="step hidden" data-step="2"><label>总体推荐度<select name="overall" required><option value="">请选择</option>${[5, 4, 3, 2, 1].map((x) => `<option>${x}</option>`).join("")}</select></label><div id="dynamic-fields"></div></fieldset><fieldset class="step hidden" data-step="3"><label>学期（选填）<input name="term" placeholder="2025 秋"></label><label>补充说明（选填）<textarea name="comment"></textarea></label></fieldset><fieldset class="step hidden" data-step="4"><p class="form-note">投稿匿名提交，经管理员审核后公开；请确认内容真实、不含人身攻击。</p><input class="trap" name="website"></fieldset><div class="wizard-nav"><button type="button" id="wizard-prev" class="ghost">上一页</button><button type="button" id="wizard-next" class="primary">下一页</button><button type="submit" id="wizard-submit" class="primary hidden">提交审核</button></div><p id="form-msg"></p></form></section>
<section id="catalog-request" class="page hidden narrow"><button class="back" data-go="submit">← 返回</button><h1>补充课程或教师</h1><p class="lede">提交后进入管理员审核队列，通过后才会出现在课程目录中。</p><form id="catalog-request-form"><label>申请类型<select name="kind" id="request-kind"><option value="course">补充课程（可同时补充教师）</option><option value="teacher">仅补充教师</option></select></label><div class="two"><label>课号<input name="courseCode" placeholder="选填"></label><label>课程名称<input name="courseName"></label></div><div class="two"><label>课程类别<select name="category"><option value="">未确定</option><option value="major">专业课</option><option value="pe">体育课</option><option value="general">公共选修</option></select></label><label>院系<input name="department"></label></div><label>教师姓名<input name="teacherName"></label><label>补充说明（选填）<textarea name="note" placeholder="例如你在哪个学期上过这门课"></textarea></label><fieldset class="attached-review"><legend>随附评价（选填）</legend><p class="form-note">若问卷中已有内容会自动带入；目录对象获批后，评价进入待审核队列。</p><div class="two"><label>总体推荐度<select name="reviewOverall"><option value="">不随附评价</option>${[5, 4, 3, 2, 1].map((x) => `<option>${x}</option>`).join("")}</select></label><label>学期<input name="reviewTerm" placeholder="2025 秋"></label></div><label>补充说明<textarea name="reviewComment"></textarea></label></fieldset><input class="trap" name="website"><div id="request-turnstile"></div><p id="request-turnstile-status" class="form-note"></p><button id="request-submit" class="primary">提交补充申请</button><p id="request-msg"></p></form></section>
<section id="admin" class="page hidden"><h1>管理后台</h1><div id="login" class="narrow"><form id="login-form"><label>管理员口令<input type="password" name="password" required></label><button class="primary">登录</button></form></div><div id="dashboard" class="hidden"><div class="tabs"><button data-tab="reviews">评价</button><button data-tab="courses">课程</button><button data-tab="teachers">教师</button><button data-tab="import">导入</button><button data-tab="legacy">历史评价</button></div><div id="admin-content"></div></div></section></main><footer id="footer"></footer>`;
async function api(path: string, o: RequestInit = {}) {
  const h = new Headers(o.headers);
  h.set("Content-Type", "application/json");
  if (csrf && o.method && o.method !== "GET") h.set("X-CSRF-Token", csrf);
  const r = await fetch(path, { ...o, headers: h }),
    d: any = await r.json();
  if (!r.ok) throw Error(d.error || "请求失败");
  return d;
}
function go(id: string) {
  document.querySelectorAll(".page").forEach((x) => x.classList.add("hidden"));
  $(`#${id}`).classList.remove("hidden");
  scrollTo(0, 0);
  if (id === "faculty") loadTeachers();
  if (id === "admin") checkAdmin();
  if (id === "submit") renderTurnstile("review");
  if (id === "catalog-request") renderTurnstile("request");
}

type TurnstileForm = "review" | "request";
type TurnstileWidgetId = string | number;
let turnstileSiteKey = "";
let turnstileScript: Promise<void> | null = null;
const turnstileWidgets: Partial<Record<TurnstileForm, TurnstileWidgetId>> = {};
const turnstileReady: Record<TurnstileForm, boolean> = {
  review: false,
  request: false,
};

function setTurnstileReady(form: TurnstileForm, ready: boolean, message: string) {
  turnstileReady[form] = ready;
  const button = $<HTMLButtonElement>(
    form === "review" ? "#wizard-submit" : "#request-submit",
  );
  button.disabled = Boolean(turnstileSiteKey) && !ready;
  $(`#${form}-turnstile-status`).textContent = message;
}

async function renderTurnstile(form: TurnstileForm) {
  if (!turnstileSiteKey || turnstileWidgets[form] !== undefined) return;
  setTurnstileReady(form, false, "人机验证加载中，请稍候…");
  try {
    await turnstileScript;
    const turnstile = (window as any).turnstile;
    turnstileWidgets[form] = turnstile.render(`#${form}-turnstile`, {
      sitekey: turnstileSiteKey,
      action: "turnstile-spin-v2",
      "refresh-expired": "auto",
      callback: () => setTurnstileReady(form, true, "人机验证已完成。"),
      "expired-callback": () =>
        setTurnstileReady(form, false, "验证已过期，正在自动刷新…"),
      "error-callback": () => {
        setTurnstileReady(form, false, "人机验证失败，请检查网络后重试。");
        return true;
      },
    });
  } catch {
    setTurnstileReady(form, false, "人机验证加载失败，请刷新页面重试。");
  }
}

function turnstileToken(form: TurnstileForm): string {
  if (!turnstileSiteKey) return "";
  const widgetId = turnstileWidgets[form];
  const turnstile = (window as any).turnstile;
  const token =
    widgetId === undefined ? "" : turnstile?.getResponse?.(widgetId) || "";
  if (token && turnstileReady[form]) return token;
  if (widgetId !== undefined) turnstile?.reset?.(widgetId);
  setTurnstileReady(form, false, "验证凭据已失效，正在重新验证…");
  throw Error("请等待人机验证重新完成后再提交");
}
document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-go]");
  if (t) {
    if (t.dataset.go === "catalog-request") prefillAttachedReview();
    go(t.dataset.go!);
  }
});

function prefillAttachedReview() {
  const review = new FormData($<HTMLFormElement>("#review-form"));
  const request = $<HTMLFormElement>("#catalog-request-form");
  const copy = (target: string, source: string) => {
    const field = request.elements.namedItem(target) as HTMLInputElement | null;
    if (field && !field.value) field.value = String(review.get(source) || "");
  };
  copy("reviewOverall", "overall");
  copy("reviewTerm", "term");
  copy("reviewComment", "comment");
}
$("#landing-search").onsubmit = (e) => {
  e.preventDefault();
  $("#q").value = $<HTMLInputElement>("#landing-q").value;
  page = 1;
  go("browse");
  load();
};
async function load() {
  const d = await api(
    `/api/courses?q=${encodeURIComponent($("#q").value)}&category=${$("#category").value}&department=${encodeURIComponent($("#department").value)}&teacherId=${$("#teacher-filter").value}&page=${page}`,
  );
  courses = d.items;
  pages = d.pages || 1;
  $("#count").textContent = `${d.total} 门课程`;
  $("#courses").innerHTML =
    courses
      .map(
        (c) =>
          `<tr data-course="${c.id}"><td class="code">${esc(c.code)}</td><td class="name">${esc(c.name)}</td><td><span class="category-label">${esc(labels[c.category])}</span></td><td class="wrap">${esc(c.teachers || "待补充")}</td><td class="dim">${esc(c.department)}</td><td class="num">${c.rating ? esc(c.rating) : "—"}</td><td class="num">${esc(c.review_count)}</td></tr>`,
      )
      .join("") || '<tr><td colspan="7" class="empty">没有匹配课程</td></tr>';
  document
    .querySelectorAll<HTMLElement>("[data-course]")
    .forEach((x) => (x.onclick = () => detail(Number(x.dataset.course))));
  $("#pager").innerHTML =
    `<button id="prev" ${page <= 1 ? "disabled" : ""}>上一页</button> ${page}/${pages} <button id="next" ${page >= pages ? "disabled" : ""}>下一页</button>`;
  $("#prev").onclick = () => {
    page--;
    load();
  };
  $("#next").onclick = () => {
    page++;
    load();
  };
  if ($("#course-select").dataset.loaded !== "true")
    $("#course-select").innerHTML =
      '<option value="">请选择课程</option>' +
      courses
        .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
        .join("");
}
async function loadCourseOptions() {
  const allCourses = await api("/api/courses/options");
  courseOptions = allCourses;
  $("#course-select").innerHTML =
    '<option value="">请选择课程</option>' +
    allCourses
      .map(
        (course: Course) =>
          `<option value="${course.id}">${esc(course.code)} · ${esc(course.name)} · ${esc(course.teachers || "教师待补充")}</option>`,
      )
      .join("");
  $("#course-select").dataset.loaded = "true";
}
async function loadTeachers() {
  const ts = await api("/api/teachers");
  $("#teacher-filter").innerHTML =
    '<option value="">所有教师</option>' +
    ts
      .map(
        (teacher: Teacher) =>
          `<option value="${teacher.id}">${esc(teacher.name)} · ${esc(teacher.department)}</option>`,
      )
      .join("");
  $("#teachers").innerHTML = ts
    .map(
      (t: any) =>
        `<tr data-teacher="${t.id}"><td class="name">${esc(t.name)}</td><td class="dim">${esc(t.title) || "—"}</td><td class="dim">${esc(t.department)}</td><td class="num">${t.rating ? esc(t.rating) : "—"}</td><td class="num">${esc(t.course_count)}</td></tr>`,
    )
    .join("");
  document
    .querySelectorAll<HTMLElement>("[data-teacher]")
    .forEach(
      (x) => (x.onclick = () => teacherDetail(Number(x.dataset.teacher))),
    );
}
async function teacherDetail(id: number) {
  const d = await api(`/api/teachers/${id}`),
    t = d.teacher;
  $("#teacher-profile").innerHTML =
    `<div class="detail-hero"><h1>${esc(t.name)}</h1><p>${esc(t.title)} · ${esc(t.department)}</p><p>${esc(t.bio)}</p></div><div class="table-scroll"><table class="list"><thead><tr><th>课号</th><th>课程</th><th class="num">评分</th><th class="num">评价数</th></tr></thead><tbody>${d.courses.map(teacherCourseRowMarkup).join("")}</tbody></table></div>${legacyReviewSection(d.legacyReviews, true)}`;
  document
    .querySelectorAll<HTMLElement>("[data-course]")
    .forEach((x) => (x.onclick = () => detail(Number(x.dataset.course))));
  go("teacher-detail");
}
const metric = (n: string, v: unknown) =>
  `<div><dt>${esc(n)}</dt><dd>${esc(v || "未提及")}</dd></div>`;
const reviewMetrics = (r: any) =>
  r.category === "general"
    ? metric("内容吸引力", r.interest && r.interest + "/5") +
      metric("实用与收获", r.practicality && r.practicality + "/5") +
      metric("时间投入", r.workload_score && r.workload_score + "/5") +
      metric("考核公平", r.fairness && r.fairness + "/5") +
      metric("课堂组织", r.organization && r.organization + "/5")
    : metric("点名", r.attendance) +
      metric(
        "给分",
        r.grading_score ? `${r.grading_score}/5 ${r.grading}` : r.grading,
      ) +
      metric("是否捞人", r.rescue) +
      metric("强度", r.workload) +
      metric("考核", r.assessment) +
      metric("课堂质量", r.teaching) +
      metric("清晰度", r.clarity && r.clarity + "/5") +
      metric("知识收获", r.knowledge && r.knowledge + "/5");
const legacyReviewSection = (rows: any[] = [], showCourse = false) =>
  rows.length
    ? `<section class="legacy-section"><h2>历史文字资料</h2><p class="lede">由腾讯表格历史资料迁移，经管理员审核后展示；不包含推算评分，也不计入课程或教师评分。</p><div class="reviews">${rows.map((r) => `<article class="review legacy-review"><div class="legacy-mark">历史</div><div><b>${esc(showCourse ? r.course_name : r.teacher_name || "教师资料")} ${r.term ? `· ${esc(r.term)}` : ""}</b><p>${esc(r.comment)}</p><small>${esc(r.source_label)}</small></div></article>`).join("")}</div></section>`
    : "";
async function detail(id: number) {
  const d = await api(`/api/courses/${id}`),
    c = d.course;
  $("#course-detail").innerHTML =
    `<div class="detail-hero"><span class="category-label">${esc(labels[c.category])}</span><h1>${esc(c.name)}</h1><p>${esc(c.code)} · ${esc(c.department)} · ${c.teachers.map((t: Teacher) => `<button class="link" data-teacher="${t.id}">${esc(t.name)}</button>`).join(" ")}</p></div><h2>学生怎么说</h2><div class="reviews">${d.reviews.map((r: any) => `<article class="review"><div class="score">${esc(r.overall)}<small>/5</small></div><div><b>${esc(r.teacher_name || "未指定教师")} · ${esc(r.term)}</b><p>${esc(r.comment || r.teaching)}</p><dl>${reviewMetrics(r)}</dl></div></article>`).join("") || '<div class="empty">暂无评价</div>'}</div>${legacyReviewSection(d.legacyReviews)}`;
  document
    .querySelectorAll<HTMLElement>("[data-teacher]")
    .forEach(
      (x) => (x.onclick = () => teacherDetail(Number(x.dataset.teacher))),
    );
  go("detail");
}
const adminScore = (name: string, label: string, value: unknown) =>
  `<label>${label}<select name="${name}"><option value="">未评价</option>${[5, 4, 3, 2, 1].map((x) => `<option value="${x}" ${Number(value) === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>`;
function fields() {
  const c = courseOptions.find(
    (x) => x.id === Number($("#course-select").value),
  );
  $("#dynamic-fields").innerHTML = c
    ? reviewFieldsMarkup(c.category)
    : "";
}
$("#course-select").onchange = async () => {
  const id = Number($("#course-select").value);
  if (!id) {
    $("#teacher-select").innerHTML = "";
    fields();
    return;
  }
  const d = await api(`/api/courses/${id}`);
  $("#teacher-select").innerHTML =
    '<option value="">请选择任课教师</option>' +
    d.course.teachers
      .map(
        (t: Teacher) =>
          `<option value="${t.id}">${esc(t.name)} · ${esc(t.department)}</option>`,
      )
      .join("");
  fields();
};
$("#q").oninput = $("#department").oninput = () => {
  page = 1;
  load();
};
$("#category").onchange = () => {
  page = 1;
  load();
};
$("#review-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const f = e.currentTarget as HTMLFormElement,
      b: any = Object.fromEntries(new FormData(f));
    b.turnstileToken = turnstileToken("review");
    const d = await api("/api/reviews", {
      method: "POST",
      body: JSON.stringify(b),
    });
    $("#form-msg").textContent = d.message;
    f.reset();
    fields();
    goToStep(1);
    const widgetId = turnstileWidgets.review;
    if (widgetId !== undefined) {
      (window as any).turnstile?.reset?.(widgetId);
      setTurnstileReady("review", false, "正在准备新的人机验证…");
    }
  } catch (x) {
    $("#form-msg").textContent = (x as Error).message;
  }
};
$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const d = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        password: new FormData(e.currentTarget as HTMLFormElement).get(
          "password",
        ),
      }),
    });
    csrf = d.csrfToken;
    checkAdmin();
  } catch (x) {
    alert((x as Error).message);
  }
};
async function checkAdmin() {
  try {
    const d = await api("/api/admin/session");
    csrf = d.csrfToken;
    $("#login").classList.add("hidden");
    $("#dashboard").classList.remove("hidden");
    reviewsAdmin();
  } catch {
    $("#login").classList.remove("hidden");
    $("#dashboard").classList.add("hidden");
  }
}
async function reviewsAdminLegacy(status = "pending") {
  const d = await api(`/api/admin/reviews?status=${status}`);
  $("#admin-content").innerHTML =
    `<select id="status"><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option><option value="all">全部</option></select>` +
    d.items
      .map(
        (r: any) =>
          `<article class="queue"><b>${esc(r.course_name)} · ${esc(r.teacher_name)} · ${esc(r.overall)}/5</b><p>${esc(r.comment || r.teaching)}</p><small>${esc(r.moderator_note)}</small>${r.status === "pending" ? `<div><button data-review="${r.id}" data-status="approved">通过</button><button class="danger" data-review="${r.id}" data-status="rejected">驳回</button></div>` : ""}</article>`,
      )
      .join("");
  $("#status").value = status;
  $("#status").onchange = () => reviewsAdmin($("#status").value);
  document.querySelectorAll<HTMLElement>("[data-review]").forEach(
    (x) =>
      (x.onclick = async () => {
        const note =
          x.dataset.status === "rejected" ? prompt("驳回理由") || "" : "";
        if (x.dataset.status === "rejected" && !note) return;
        await api(`/api/admin/reviews/${x.dataset.review}`, {
          method: "PATCH",
          body: JSON.stringify({ status: x.dataset.status, note }),
        });
        reviewsAdmin(status);
      }),
  );
}
async function reviewsAdmin(status = "pending", q = "", reviewPage = 1) {
  const d = await api(
    `/api/admin/reviews?status=${status}&q=${encodeURIComponent(q)}&page=${reviewPage}&pageSize=20`,
  );
  $("#admin-content").innerHTML =
    `<div class="toolbar"><select id="status"><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option><option value="all">全部</option></select><input id="review-q" value="${esc(q)}" placeholder="课程、教师、学期或内容"><button id="review-search">搜索</button><span>共 ${d.total} 条</span></div>` +
    d.items
      .map(
        (
          r: any,
        ) => `<article class="queue"><b>${esc(r.course_name)} · ${esc(r.teacher_name || "未指定教师")} · ${esc(r.overall)}/5</b><p>${esc(r.term)} · ${esc(r.comment || r.teaching || "无补充内容")}</p><small>${esc(r.status)} ${r.moderator_note ? "· " + esc(r.moderator_note) : ""}</small>
        <details><summary>编辑评价内容</summary><form data-edit-form="${r.id}"><label>补充说明<textarea name="comment">${esc(r.comment)}</textarea></label><label>课堂质量<textarea name="teaching">${esc(r.teaching)}</textarea></label><div class="two"><label>点名<input name="attendance" value="${esc(r.attendance)}"></label><label>给分<input name="grading" value="${esc(r.grading)}"></label></div><div class="two"><label>强度<input name="workload" value="${esc(r.workload)}"></label><label>是否捞人<input name="rescue" value="${esc(r.rescue)}"></label></div><label>考核方式<input name="assessment" value="${esc(r.assessment)}"></label>${r.category === "general" ? `<div class="two">${adminScore("interest", "内容吸引力", r.interest)}${adminScore("practicality", "实用与收获", r.practicality)}${adminScore("workloadScore", "时间投入", r.workload_score)}${adminScore("fairness", "考核公平", r.fairness)}</div>${adminScore("organization", "课堂组织", r.organization)}` : ""}<label>修改说明<input name="note" required></label><button class="primary">保存修改</button></form></details>
        <button data-events="${r.id}">审核时间线</button><div id="events-${r.id}" class="timeline"></div>
        ${r.status === "pending" ? `<div><button data-review="${r.id}" data-status="approved">通过</button><button class="danger" data-review="${r.id}" data-status="rejected">驳回</button></div>` : ""}</article>`,
      )
      .join("") +
    `<div class="pager"><button id="review-prev" ${d.page <= 1 ? "disabled" : ""}>上一页</button><span>${d.page} / ${Math.max(1, d.pages)}</span><button id="review-next" ${d.page >= d.pages ? "disabled" : ""}>下一页</button></div>`;
  $("#status").value = status;
  $("#status").onchange = () => reviewsAdmin($("#status").value, q, 1);
  $("#review-search").onclick = () =>
    reviewsAdmin(status, $("#review-q").value, 1);
  $("#review-q").onkeydown = (event: KeyboardEvent) => {
    if (event.key === "Enter") reviewsAdmin(status, $("#review-q").value, 1);
  };
  $("#review-prev").onclick = () => reviewsAdmin(status, q, reviewPage - 1);
  $("#review-next").onclick = () => reviewsAdmin(status, q, reviewPage + 1);
  document.querySelectorAll<HTMLElement>("[data-review]").forEach(
    (button) =>
      (button.onclick = async () => {
        const note =
          button.dataset.status === "rejected"
            ? prompt("请输入驳回理由") || ""
            : "";
        if (button.dataset.status === "rejected" && !note) return;
        await api(`/api/admin/reviews/${button.dataset.review}`, {
          method: "PATCH",
          body: JSON.stringify({ status: button.dataset.status, note }),
        });
        reviewsAdmin(status, q, reviewPage);
      }),
  );
  document.querySelectorAll<HTMLFormElement>("[data-edit-form]").forEach(
    (form) =>
      (form.onsubmit = async (event) => {
        event.preventDefault();
        await api(`/api/admin/reviews/${form.dataset.editForm}/content`, {
          method: "PATCH",
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        reviewsAdmin(status, q, reviewPage);
      }),
  );
  document.querySelectorAll<HTMLElement>("[data-events]").forEach(
    (button) =>
      (button.onclick = async () => {
        const events = await api(
          `/api/admin/reviews/${button.dataset.events}/events`,
        );
        $(`#events-${button.dataset.events}`).innerHTML = events.length
          ? events
              .map(
                (item: any) =>
                  `<p><b>${esc(item.action)}</b> · ${esc(item.created_at)}<br>${esc(item.note || "无备注")}</p>`,
              )
              .join("")
          : "暂无审核记录";
      }),
  );
}
async function coursesAdmin() {
  const [cs, ts] = await Promise.all([
    api("/api/admin/courses"),
    api("/api/admin/teachers"),
  ]);
  $("#admin-content").innerHTML =
    `<form id="course-form"><h3>新增/编辑课程</h3><input type="hidden" name="id"><div class="two"><label>课号<input name="code"></label><label>课程名<input name="name" required></label></div><div class="two"><label>类别<select name="category"><option value="major">专业课</option><option value="pe">体育课</option><option value="general">公共选修</option></select></label><label>院系<input name="department"></label></div><label>简介<textarea name="description"></textarea></label><fieldset><legend>任课教师</legend>${ts.map((t: Teacher) => `<label><input type="checkbox" name="teacherIds" value="${t.id}">${esc(t.name)}</label>`).join("")}</fieldset><button class="primary">保存</button></form>${cs.map((c: any) => `<article class="queue"><b>${esc(c.name)}</b><p>${esc(c.teachers)}</p><button data-edit-course="${c.id}">编辑</button><button class="danger" data-delete-course="${c.id}">删除</button></article>`).join("")}`;
  const f = $<HTMLFormElement>("#course-form");
  document.querySelectorAll<HTMLElement>("[data-edit-course]").forEach(
    (b) =>
      (b.onclick = () => {
        const c = cs.find((x: any) => x.id === Number(b.dataset.editCourse));
        for (const [k, v] of Object.entries(c))
          if (f.elements.namedItem(k))
            (f.elements.namedItem(k) as HTMLInputElement).value = String(
              v ?? "",
            );
        const ids = String(c.teacher_ids || "").split(",");
        f.querySelectorAll<HTMLInputElement>("[name=teacherIds]").forEach(
          (x) => (x.checked = ids.includes(x.value)),
        );
      }),
  );
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f),
      obj: any = Object.fromEntries(fd);
    obj.teacherIds = fd.getAll("teacherIds");
    await api("/api/admin/courses", {
      method: "POST",
      body: JSON.stringify(obj),
    });
    coursesAdmin();
    load();
  };
  document.querySelectorAll<HTMLElement>("[data-delete-course]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (confirm("确认删除？")) {
          await api(`/api/admin/courses/${b.dataset.deleteCourse}`, {
            method: "DELETE",
          });
          coursesAdmin();
          load();
        }
      }),
  );
}
async function offeringsAdmin() {
  const [os, cs, ts] = await Promise.all([
    api("/api/admin/offerings"),
    api("/api/admin/courses"),
    api("/api/admin/teachers"),
  ]);
  $("#admin-content").innerHTML =
    `<form id="offering-form"><h3>新增 / 编辑开课班</h3><input type="hidden" name="id"><label>课程<select name="courseId" required><option value="">请选择</option>${cs.map((c: any) => `<option value="${c.id}">${esc(c.code)} · ${esc(c.name)}</option>`).join("")}</select></label><div class="two"><label>学期<input name="term" placeholder="2026 春"></label><label>班次<input name="section" required placeholder="01班"></label></div><div class="two"><label>校区<input name="campus"></label><label>上课安排<input name="schedule"></label></div><label>状态<select name="status"><option value="active">开放</option><option value="archived">归档</option></select></label><fieldset><legend>任课教师</legend>${ts.map((t: Teacher) => `<label><input type="checkbox" name="teacherIds" value="${t.id}">${esc(t.name)}</label>`).join("")}</fieldset><button class="primary">保存开课班</button></form>` +
    os
      .map(
        (o: any) =>
          `<article class="queue"><b>${esc(o.course_name)} · ${esc(o.term || "学期未标注")} · ${esc(o.section)}</b><p>${esc(o.teachers || "无教师")} · ${esc(o.campus)} · ${esc(o.schedule)}</p><button data-edit-offering="${o.id}">编辑</button><button class="danger" data-delete-offering="${o.id}">删除</button></article>`,
      )
      .join("");
  const form = $<HTMLFormElement>("#offering-form");
  document.querySelectorAll<HTMLElement>("[data-edit-offering]").forEach(
    (button) =>
      (button.onclick = () => {
        const o = os.find(
          (item: any) => item.id === Number(button.dataset.editOffering),
        );
        for (const [key, value] of Object.entries(o)) {
          const input = form.elements.namedItem(key) as HTMLInputElement | null;
          if (input) input.value = String(value ?? "");
        }
        const ids = String(o.teacher_ids || "").split(",");
        form
          .querySelectorAll<HTMLInputElement>("[name=teacherIds]")
          .forEach((input) => (input.checked = ids.includes(input.value)));
      }),
  );
  form.onsubmit = async (event) => {
    event.preventDefault();
    const data = new FormData(form),
      body: any = Object.fromEntries(data);
    body.teacherIds = data.getAll("teacherIds");
    await api("/api/admin/offerings", {
      method: "POST",
      body: JSON.stringify(body),
    });
    offeringsAdmin();
  };
  document.querySelectorAll<HTMLElement>("[data-delete-offering]").forEach(
    (button) =>
      (button.onclick = async () => {
        if (!confirm("确认删除这个开课班？")) return;
        await api(`/api/admin/offerings/${button.dataset.deleteOffering}`, {
          method: "DELETE",
        });
        offeringsAdmin();
      }),
  );
}
async function teachersAdmin() {
  const ts = await api("/api/admin/teachers");
  $("#admin-content").innerHTML =
    `<form id="teacher-form"><h3>新增/编辑教师</h3><input type="hidden" name="id"><div class="two"><label>姓名<input name="name" required></label><label>职称<input name="title"></label></div><label>院系<input name="department"></label><label>简介<textarea name="bio"></textarea></label><button class="primary">保存</button></form>${ts.map((t: Teacher) => `<article class="queue"><b>${esc(t.name)}</b><p>${esc(t.title)} · ${esc(t.department)}</p><button data-edit-teacher="${t.id}">编辑</button><button class="danger" data-delete-teacher="${t.id}">删除</button></article>`).join("")}`;
  const f = $<HTMLFormElement>("#teacher-form");
  document.querySelectorAll<HTMLElement>("[data-edit-teacher]").forEach(
    (b) =>
      (b.onclick = () => {
        const t = ts.find(
          (x: Teacher) => x.id === Number(b.dataset.editTeacher),
        );
        for (const [k, v] of Object.entries(t))
          if (f.elements.namedItem(k))
            (f.elements.namedItem(k) as HTMLInputElement).value = String(
              v ?? "",
            );
      }),
  );
  f.onsubmit = async (e) => {
    e.preventDefault();
    await api("/api/admin/teachers", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(f))),
    });
    teachersAdmin();
    loadTeachers();
  };
  document.querySelectorAll<HTMLElement>("[data-delete-teacher]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (confirm("确认删除？")) {
          await api(`/api/admin/teachers/${b.dataset.deleteTeacher}`, {
            method: "DELETE",
          });
          teachersAdmin();
          loadTeachers();
        }
      }),
  );
}
function csv(text: string) {
  const a: string[][] = [];
  let r: string[] = [],
    v = "",
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (q && text[i + 1] === '"') {
        v += '"';
        i++;
      } else q = !q;
    } else if (c === "," && !q) {
      r.push(v);
      v = "";
    } else if ((c === "\n" || c === "\r") && !q) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      r.push(v);
      if (r.some(Boolean)) a.push(r);
      r = [];
      v = "";
    } else v += c;
  }
  r.push(v);
  if (r.some(Boolean)) a.push(r);
  const h = a.shift()?.map((x) => x.trim().replace(/^\uFEFF/, "")) || [];
  return a.map((x) =>
    Object.fromEntries(h.map((k, i) => [k, (x[i] || "").trim()])),
  );
}
function importerLegacy() {
  $("#admin-content").innerHTML =
    `<h3>金山表格 CSV 导入</h3><p>支持逗号、引号和单元格换行。</p><select id="import-type"><option value="courses">课程：code,name,category,department,credits,description</option><option value="teachers">教师：name,department,title,bio</option><option value="relations">任课关系：course_code,course_name,teacher_name,teacher_department</option></select><label class="drop">选择 CSV<input id="csv" type="file" accept=".csv"></label><p id="import-msg"></p>`;
  $("#csv").onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const rows = csv(await f.text()),
      d = await api("/api/admin/import", {
        method: "POST",
        body: JSON.stringify({ type: $("#import-type").value, rows }),
      });
    $("#import-msg").textContent = `成功导入 ${d.count} 行`;
    load();
    loadTeachers();
  };
}
function importer() {
  $("#admin-content").innerHTML =
    `<h3>CSV 批量导入</h3><p>选择文件后先执行服务端校验，确认预览无误后才会写入数据库。</p><label>数据类型<select id="import-type"><option value="courses">课程：code,name,category,department,credits,description</option><option value="teachers">教师：name,department,title,bio</option><option value="relations">任课关系：course_code,course_name,teacher_name,teacher_department</option><option value="offerings">开课班：course_code,course_name,teacher_name,teacher_department,term,section,campus,schedule,status</option></select></label><label class="drop">选择 CSV<input id="csv" type="file" accept=".csv"></label><div id="import-preview"></div><button id="import-commit" class="primary hidden">确认导入</button><p id="import-msg"></p>`;
  let pendingRows: Record<string, string>[] = [],
    pendingType = "";
  $("#csv").onchange = async (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 900_000) {
      $("#import-msg").textContent = "文件过大，请拆分后导入";
      return;
    }
    pendingRows = csv(await file.text());
    pendingType = $("#import-type").value;
    const preview = await api("/api/admin/import/preview", {
      method: "POST",
      body: JSON.stringify({ type: pendingType, rows: pendingRows }),
    });
    $("#import-preview").innerHTML =
      `<p>总行数：${preview.total}；新增：${preview.newCount}；跳过：${preview.skipCount}；错误：${preview.errors.length}</p>` +
      (preview.errors.length
        ? `<div class="table-scroll"><table><thead><tr><th>行</th><th>字段</th><th>问题</th></tr></thead><tbody>${preview.errors.map((item: any) => `<tr><td>${esc(item.row)}</td><td>${esc(item.field)}</td><td>${esc(item.message)}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="table-scroll"><table><thead><tr><th>行</th><th>状态</th><th>规范化数据</th></tr></thead><tbody>${preview.preview.map((row: any, index: number) => `<tr><td>${index + 2}</td><td>${row.exists ? "已存在，将跳过" : "新增"}</td><td><code>${esc(JSON.stringify(row))}</code></td></tr>`).join("")}</tbody></table></div>`);
    $("#import-commit").classList.toggle("hidden", !preview.ok);
    $("#import-msg").textContent = preview.ok
      ? "校验通过，可以确认导入"
      : "请修复表格中的错误后重新选择文件";
  };
  $("#import-commit").onclick = async () => {
    $("#import-commit").setAttribute("disabled", "disabled");
    try {
      const result = await api("/api/admin/import", {
        method: "POST",
        body: JSON.stringify({ type: pendingType, rows: pendingRows }),
      });
      $("#import-msg").textContent = `新增 ${result.count} 行；跳过 ${result.skippedCount} 行`;
      $("#import-commit").classList.add("hidden");
      load();
      loadTeachers();
    } finally {
      $("#import-commit").removeAttribute("disabled");
    }
  };
}
async function legacyImportsAdmin(batchPage = 1, status = "") {
  const data = await api(
    `/api/admin/legacy-imports?page=${batchPage}&pageSize=20&status=${encodeURIComponent(status)}`,
  );
  $("#admin-content").innerHTML =
    `<h3>历史评价批次</h3><p>只接受由本地人工确认工具生成的 JSON。先校验，确认后才写入；历史文字评价不包含 overall。</p>` +
    `<div class="toolbar"><select id="legacy-status"><option value="">全部批次</option>${["imported", "rolled_back", "failed"].map((value) => `<option value="${value}" ${status === value ? "selected" : ""}>${value}</option>`).join("")}</select><label class="drop">选择批准 JSON<input id="legacy-json" type="file" accept=".json,application/json"></label></div>` +
    `<div id="legacy-preview"></div><button id="legacy-commit" class="primary hidden">确认导入为待审核</button><p id="legacy-msg"></p>` +
    `<div class="table-scroll"><table><thead><tr><th>批次</th><th>状态</th><th>行数</th><th>审核状态</th><th>导入时间</th><th>操作</th></tr></thead><tbody>${
      data.items
        .map(
          (batch: any) =>
            `<tr><td><code>${esc(batch.id)}</code></td><td>${esc(batch.status)}</td><td>${esc(batch.row_count)}</td><td>待审 ${esc(batch.pending_count)} / 通过 ${esc(batch.approved_count)} / 驳回 ${esc(batch.rejected_count)}</td><td>${esc(batch.imported_at || batch.created_at)}</td><td><button data-review-legacy-batch="${esc(batch.id)}">审核记录</button> ${batch.status === "imported" && Number(batch.approved_count) === 0 && Number(batch.rejected_count) === 0 ? `<button class="danger" data-rollback-legacy="${esc(batch.id)}">回滚</button>` : ""}</td></tr>`,
        )
        .join("") || '<tr><td colspan="6">暂无历史导入批次</td></tr>'
    }</tbody></table></div>` +
    `<div class="pager"><button id="legacy-prev" ${batchPage <= 1 ? "disabled" : ""}>上一页</button><span>${batchPage} / ${data.pages}</span><button id="legacy-next" ${batchPage >= data.pages ? "disabled" : ""}>下一页</button></div><div id="legacy-rows"></div>`;
  let pendingPayload: any = null;
  $("#legacy-status").onchange = () =>
    legacyImportsAdmin(1, $("#legacy-status").value);
  $("#legacy-prev").onclick = () => legacyImportsAdmin(batchPage - 1, status);
  $("#legacy-next").onclick = () => legacyImportsAdmin(batchPage + 1, status);
  $("#legacy-json").onchange = async (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 1_900_000) {
      $("#legacy-msg").textContent =
        "文件过大，请使用审批工具生成的分片 payload";
      return;
    }
    try {
      pendingPayload = JSON.parse(await file.text());
    } catch {
      $("#legacy-msg").textContent = "JSON 文件格式错误";
      return;
    }
    if (!pendingPayload || !Array.isArray(pendingPayload.rows)) {
      $("#legacy-msg").textContent = "JSON 缺少 rows 数组";
      return;
    }
    const preview = await api("/api/admin/legacy-imports/preview", {
      method: "POST",
      body: JSON.stringify({ rows: pendingPayload.rows }),
    });
    $("#legacy-preview").innerHTML =
      `<p>总行数：${esc(preview.total)}；错误：${esc(preview.errors.length)}</p>` +
      (preview.errors.length
        ? `<div class="table-scroll"><table><thead><tr><th>行</th><th>字段</th><th>问题</th></tr></thead><tbody>${preview.errors.map((item: any) => `<tr><td>${esc(item.row)}</td><td>${esc(item.field)}</td><td>${esc(item.message)}</td></tr>`).join("")}</tbody></table></div>`
        : "<p>服务端校验通过。请再次确认来源截图和人工审核记录后导入。</p>");
    $("#legacy-commit").classList.toggle("hidden", !preview.ok);
    $("#legacy-msg").textContent = preview.ok
      ? "尚未写入数据库"
      : "请回到人工确认队列修正错误并重新生成批准文件";
  };
  $("#legacy-commit").onclick = async () => {
    if (!pendingPayload) return;
    $("#legacy-commit").setAttribute("disabled", "disabled");
    try {
      const result = await api("/api/admin/legacy-imports", {
        method: "POST",
        body: JSON.stringify(pendingPayload),
      });
      await legacyImportsAdmin(1, "imported");
      $("#legacy-msg").textContent =
        `已导入批次 ${result.batchId}，共 ${result.count} 条，仍需管理员审核。`;
    } finally {
      $("#legacy-commit").removeAttribute("disabled");
    }
  };
  document.querySelectorAll<HTMLElement>("[data-rollback-legacy]").forEach(
    (button) =>
      (button.onclick = async () => {
        const id = button.dataset.rollbackLegacy || "";
        if (!confirm(`确认回滚批次 ${id}？该批次的历史评价将被删除。`)) return;
        await api(
          `/api/admin/legacy-imports/${encodeURIComponent(id)}/rollback`,
          {
            method: "POST",
            body: "{}",
          },
        );
        await legacyImportsAdmin(batchPage, status);
      }),
  );
  document
    .querySelectorAll<HTMLElement>("[data-review-legacy-batch]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          legacyReviewRows(button.dataset.reviewLegacyBatch || "")),
    );
}
async function legacyReviewRows(
  batchId: string,
  status = "pending",
  reviewPage = 1,
  q = "",
) {
  const data = await api(
    `/api/admin/legacy-reviews?batchId=${encodeURIComponent(batchId)}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&page=${reviewPage}&pageSize=20`,
  );
  $("#legacy-rows").innerHTML =
    `<hr><h3>批次记录审核</h3><div class="toolbar"><select id="legacy-review-status">${["pending", "approved", "rejected", "all"].map((value) => `<option value="${value}" ${status === value ? "selected" : ""}>${value}</option>`).join("")}</select><input id="legacy-review-q" value="${esc(q)}" placeholder="课程、教师、原文或截图"><button id="legacy-review-search">搜索</button></div>` +
      data.items
        .map(
          (row: any) =>
            `<article class="admin-row"><div><b>${esc(row.course_name)} · ${esc(row.teacher_name)}</b><span>${esc(row.source_file)} / ${esc(row.source_row)} · OCR ${esc(row.ocr_confidence)}</span></div><p>${esc(row.comment)}</p><details><summary>核对原始 OCR 和来源</summary><p><b>OCR 课程：</b>${esc(row.ocr_course_name)}；<b>OCR 教师：</b>${esc(row.ocr_teacher_name)}</p><pre>${esc(row.raw_ocr_text)}</pre><p>继承：${esc(row.inherited_from || "无")}；重复组：${esc(row.duplicate_group || "无")}</p></details><div class="actions">${row.status === "pending" ? `<button data-legacy-review="${esc(row.id)}" data-status="approved">通过</button><button class="danger" data-legacy-review="${esc(row.id)}" data-status="rejected">驳回</button>` : `<span>${esc(row.status)} · ${esc(row.moderator_note || "")}</span>`}<button data-legacy-events="${esc(row.id)}">历史</button></div></article>`,
        )
        .join("") || '<div class="empty">该筛选下暂无记录</div>';
  $("#legacy-rows").insertAdjacentHTML(
    "beforeend",
    `<div class="pager"><button id="legacy-review-prev" ${reviewPage <= 1 ? "disabled" : ""}>上一页</button><span>${reviewPage} / ${data.pages}</span><button id="legacy-review-next" ${reviewPage >= data.pages ? "disabled" : ""}>下一页</button></div>`,
  );
  $("#legacy-review-status").onchange = () =>
    legacyReviewRows(batchId, $("#legacy-review-status").value, 1, q);
  $("#legacy-review-search").onclick = () =>
    legacyReviewRows(batchId, status, 1, $("#legacy-review-q").value);
  $("#legacy-review-q").onkeydown = (event: KeyboardEvent) => {
    if (event.key === "Enter")
      legacyReviewRows(batchId, status, 1, $("#legacy-review-q").value);
  };
  $("#legacy-review-prev").onclick = () =>
    legacyReviewRows(batchId, status, reviewPage - 1, q);
  $("#legacy-review-next").onclick = () =>
    legacyReviewRows(batchId, status, reviewPage + 1, q);
  document.querySelectorAll<HTMLElement>("[data-legacy-review]").forEach(
    (button) =>
      (button.onclick = async () => {
        const nextStatus = button.dataset.status || "";
        const note = nextStatus === "rejected" ? prompt("请输入驳回理由") : "";
        if (nextStatus === "rejected" && !note) return;
        await api(`/api/admin/legacy-reviews/${button.dataset.legacyReview}`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus, note }),
        });
        await legacyReviewRows(batchId, status, reviewPage, q);
      }),
  );
  document.querySelectorAll<HTMLElement>("[data-legacy-events]").forEach(
    (button) =>
      (button.onclick = async () => {
        const events = await api(
          `/api/admin/legacy-reviews/${button.dataset.legacyEvents}/events`,
        );
        alert(
          events.length
            ? events
                .map(
                  (event: any) =>
                    `${event.created_at} ${event.action}: ${event.note || "无备注"}`,
                )
                .join("\n")
            : "暂无审核历史",
        );
      }),
  );
}
document
  .querySelectorAll<HTMLElement>("[data-tab]")
  .forEach(
    (x) =>
      (x.onclick = () =>
        x.dataset.tab === "reviews"
          ? reviewsAdmin()
          : x.dataset.tab === "courses"
            ? coursesAdmin()
            : x.dataset.tab === "teachers"
              ? teachersAdmin()
              : x.dataset.tab === "legacy"
                ? legacyImportsAdmin()
                : importer()),
  );
$("#dashboard .tabs").insertAdjacentHTML(
  "beforeend",
  '<button id="offerings-tab">开课班</button><button id="requests-tab">补充申请</button><button id="sessions-tab">会话</button><button id="admin-logout">退出</button>',
);
$("#offerings-tab").onclick = () => offeringsAdmin();
async function catalogRequestsAdmin(status = "pending") {
  const d = await api(`/api/admin/catalog-requests?status=${status}`);
  $("#admin-content").innerHTML =
    `<div class="toolbar"><select id="request-status"><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option><option value="all">全部</option></select><span>共 ${d.total} 条</span></div>` +
    (d.items
      .map(
        (r: any) =>
          `<article class="queue"><b>${esc(r.kind === "course" ? "课程" : "教师")}申请 · ${esc(r.course_name || r.teacher_name)}</b><dl><div><dt>课号</dt><dd>${esc(r.course_code || "—")}</dd></div><div><dt>课程</dt><dd>${esc(r.course_name || "—")}</dd></div><div><dt>类别</dt><dd>${esc(labels[r.category] || "未确定")}</dd></div><div><dt>教师</dt><dd>${esc(r.teacher_name || "—")}</dd></div><div><dt>院系</dt><dd>${esc(r.department || "—")}</dd></div><div><dt>随附评价</dt><dd>${r.has_review ? "有" : "无"}</dd></div></dl>${r.note ? `<p>${esc(r.note)}</p>` : ""}<p class="form-note">${esc(r.created_at)}${r.moderator_note ? ` · ${esc(r.moderator_note)}` : ""}</p>${
            r.status === "pending"
              ? `<button data-approve-request="${r.id}">批准并建立目录对象</button><button class="danger" data-reject-request="${r.id}">驳回</button>`
              : `<span class="status-text">${esc(r.status === "approved" ? "已通过" : "已驳回")}</span>`
          }</article>`,
      )
      .join("") || '<div class="empty">没有补充申请</div>');
  $("#request-status").value = status;
  $("#request-status").onchange = (e: Event) =>
    catalogRequestsAdmin((e.target as HTMLSelectElement).value);
  document.querySelectorAll<HTMLElement>("[data-approve-request]").forEach(
    (button) =>
      (button.onclick = async () => {
        await api(
          `/api/admin/catalog-requests/${button.dataset.approveRequest}`,
          {
            method: "PATCH",
            body: JSON.stringify({ status: "approved" }),
          },
        );
        await catalogRequestsAdmin(status);
        await Promise.all([load(), loadTeachers(), loadCourseOptions()]);
      }),
  );
  document.querySelectorAll<HTMLElement>("[data-reject-request]").forEach(
    (button) =>
      (button.onclick = async () => {
        const note = prompt("驳回理由");
        if (!note) return;
        await api(
          `/api/admin/catalog-requests/${button.dataset.rejectRequest}`,
          {
            method: "PATCH",
            body: JSON.stringify({ status: "rejected", note }),
          },
        );
        await catalogRequestsAdmin(status);
      }),
  );
}
$("#requests-tab").onclick = () => catalogRequestsAdmin();
$("#sessions-tab").onclick = async () => {
  const data = await api("/api/admin/sessions");
  $("#admin-content").innerHTML =
    `<h3>管理会话</h3><div class="toolbar"><button id="revoke-others" class="danger">撤销其他会话</button></div>` +
    `<div class="table-scroll"><table><thead><tr><th>状态</th><th>创建</th><th>过期</th><th>操作</th></tr></thead><tbody>${data.sessions
      .map(
        (s: any) =>
          `<tr><td>${s.current ? "当前" : s.revoked_at ? "已撤销" : "有效"}</td><td>${esc(s.created_at)}</td><td>${esc(s.expires_at)}</td><td>${!s.current && !s.revoked_at ? `<button data-revoke-session="${esc(s.session_id)}">撤销</button>` : "—"}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
  document.querySelectorAll<HTMLElement>("[data-revoke-session]").forEach(
    (button) =>
      (button.onclick = async () => {
        await api(
          `/api/admin/sessions/${encodeURIComponent(button.dataset.revokeSession || "")}/revoke`,
          { method: "POST", body: "{}" },
        );
        $("#sessions-tab").click();
      }),
  );
  $("#revoke-others").onclick = async () => {
    await api("/api/admin/sessions/revoke-others", {
      method: "POST",
      body: "{}",
    });
    $("#sessions-tab").click();
  };
};
$("#admin-logout").onclick = async () => {
  await api("/api/admin/logout", { method: "POST", body: "{}" });
  csrf = "";
  $("#dashboard").classList.add("hidden");
  $("#login").classList.remove("hidden");
};
$("#department").insertAdjacentHTML(
  "afterend",
  '<select id="teacher-filter"><option value="">所有教师</option></select>',
);
$("#teacher-filter").onchange = () => {
  page = 1;
  load();
};
$("#course-select").onchange = async () => {
  const id = Number($("#course-select").value);
  if (!id) {
    $("#offering-select").innerHTML = '<option value="">不指定</option>';
    $("#teacher-select").innerHTML = '<option value="">请先选择课程</option>';
    fields();
    return;
  }
  const [offerings, detail] = await Promise.all([
    api(`/api/offerings?courseId=${id}`),
    api(`/api/courses/${id}`),
  ]);
  $("#offering-select").innerHTML =
    '<option value="">不指定</option>' +
    offerings
      .map(
        (o: any) =>
          `<option value="${o.id}">${esc(o.term || "学期未标注")} · ${esc(o.section || "默认班")} ${o.campus ? "· " + esc(o.campus) : ""}</option>`,
      )
      .join("");
  $("#teacher-select").innerHTML =
    '<option value="">请选择任课教师</option>' +
    detail.course.teachers
      .map(
        (t: Teacher) =>
          `<option value="${t.id}">${esc(t.name)} · ${esc(t.department)}</option>`,
      )
      .join("");
  fields();
};
$("#offering-select").onchange = async () => {
  const id = Number($("#offering-select").value);
  if (!id) return;
  const d = await api(`/api/offerings/${id}`);
  $("#teacher-select").innerHTML =
    '<option value="">请选择任课教师</option>' +
    d.teachers
      .map(
        (t: Teacher) =>
          `<option value="${t.id}">${esc(t.name)} · ${esc(t.department)}</option>`,
      )
      .join("");
  const term = $<HTMLInputElement>("[name=term]");
  if (!term.value && d.offering.term) term.value = d.offering.term;
};
let wizardStep = 1;
const wizardLastStep = 4;
function renderWizard() {
  document.querySelectorAll<HTMLElement>("#review-form .step").forEach((el) => {
    el.classList.toggle("hidden", Number(el.dataset.step) !== wizardStep);
  });
  document
    .querySelectorAll<HTMLElement>("#wizard-progress li")
    .forEach((el) => {
      const step = Number(el.dataset.step);
      el.classList.toggle("active", step === wizardStep);
      el.classList.toggle("done", step < wizardStep);
    });
  $("#wizard-prev").classList.toggle("hidden", wizardStep === 1);
  $("#wizard-next").classList.toggle("hidden", wizardStep === wizardLastStep);
  $("#wizard-submit").classList.toggle("hidden", wizardStep !== wizardLastStep);
}
function stepIsValid() {
  const current = document.querySelector<HTMLElement>(
    `#review-form .step[data-step="${wizardStep}"]`,
  )!;
  for (const field of current.querySelectorAll("[required]")) {
    if (!(field as HTMLInputElement).reportValidity()) return false;
  }
  return true;
}
function goToStep(step: number) {
  wizardStep = Math.min(wizardLastStep, Math.max(1, step));
  renderWizard();
  $("#form-msg").textContent = "";
}
$("#wizard-next").onclick = () => stepIsValid() && goToStep(wizardStep + 1);
$("#wizard-prev").onclick = () => goToStep(wizardStep - 1);
renderWizard();
$("#request-kind").onchange = () => {
  const courseOnly = $<HTMLSelectElement>("#request-kind").value === "course";
  $<HTMLInputElement>("[name=courseName]").required = courseOnly;
  $<HTMLInputElement>("[name=teacherName]").required = !courseOnly;
  $(".attached-review").classList.toggle("hidden", !courseOnly);
  if (!courseOnly) {
    for (const name of ["reviewOverall", "reviewTerm", "reviewComment"])
      (
        $<HTMLFormElement>("#catalog-request-form").elements.namedItem(
          name,
        ) as HTMLInputElement
      ).value = "";
  }
};
$("#request-kind").dispatchEvent(new Event("change"));
$("#catalog-request-form").onsubmit = async (e) => {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  try {
    const body: any = Object.fromEntries(new FormData(form));
    const overall = Number(body.reviewOverall);
    if (overall) {
      body.review = {
        overall,
        term: body.reviewTerm,
        comment: body.reviewComment,
      };
    }
    delete body.reviewOverall;
    delete body.reviewTerm;
    delete body.reviewComment;
    body.turnstileToken = turnstileToken("request");
    const d = await api("/api/catalog-requests", {
      method: "POST",
      body: JSON.stringify(body),
    });
    $("#request-msg").textContent = d.message;
    form.reset();
    const widgetId = turnstileWidgets.request;
    if (widgetId !== undefined) {
      (window as any).turnstile?.reset?.(widgetId);
      setTurnstileReady("request", false, "正在准备新的人机验证…");
    }
  } catch (x) {
    $("#request-msg").textContent = (x as Error).message;
  }
};
(async () => {
  const c = await api("/api/config");
  document.title = c.siteName;
  $("#footer").innerHTML =
    `<span>${esc(c.siteName)} · ${esc(c.universityName)}</span><button class="link" data-go="catalog-request">找不到我的课程/教师</button>`;
  if (c.turnstileSiteKey) {
    turnstileSiteKey = c.turnstileSiteKey;
    setTurnstileReady("review", false, "进入写评价后将开始人机验证。");
    setTurnstileReady("request", false, "进入补充申请后将开始人机验证。");
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    turnstileScript = new Promise((resolve, reject) => {
      s.onload = () => resolve();
      s.onerror = () => reject(Error("Turnstile failed to load"));
    });
    // @ts-expect-error DOM and Workers HTMLRewriter Element overloads collide on append()
    document.head.append(s);
  }
  await Promise.all([load(), loadTeachers(), loadCourseOptions()]);
})().catch((e) => ($("#courses").textContent = e.message));
