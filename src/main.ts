import "./style.css";
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
  `<header><a class="brand" href="#"><i>J</i><span id="brand">选课志</span></a><nav><button data-go="browse">课程</button><button data-go="faculty">教师</button><button data-go="submit">写评价</button><button data-go="admin">后台</button></nav></header><main>
<section id="browse" class="page"><div class="hero"><p class="eyebrow">COURSE INDEX</p><h1>关于一门课，<br><em>上过的人最清楚。</em></h1><div class="search"><label>查找</label><input id="q" placeholder="课程、课号或教师"><select id="category"><option value="">所有课程</option><option value="major">专业课</option><option value="pe">体育课</option><option value="general">公共选修</option></select><input id="department" placeholder="院系"><button data-go="submit">投稿</button></div></div><div class="catalog-main"><div class="section-head"><h2>课程目录</h2><span id="count"></span></div><div id="courses" class="grid"></div><div id="pager"></div></div></section>
<section id="faculty" class="page hidden"><div class="section-head"><h2>教师资料</h2></div><div id="teachers" class="grid"></div></section>
<section id="detail" class="page hidden"><button class="back" data-go="browse">← 返回</button><div id="course-detail"></div></section>
<section id="teacher-detail" class="page hidden"><button class="back" data-go="faculty">← 返回</button><div id="teacher-profile"></div></section>
<section id="submit" class="page hidden narrow"><h1>写评价</h1><p class="lede">评价必须绑定具体任课教师，投稿经审核后公开。</p><form id="review-form"><label>课程<select name="courseId" id="course-select" required></select></label><label>任课教师<select name="teacherId" id="teacher-select" required></select></label><div class="two"><label>学期<input name="term" required placeholder="2025 秋"></label><label>总体推荐度<select name="overall" required><option value="">请选择</option>${[5, 4, 3, 2, 1].map((x) => `<option>${x}</option>`).join("")}</select></label></div><div id="dynamic-fields"></div><label>补充说明<textarea name="comment"></textarea></label><input class="trap" name="website"><div id="turnstile"></div><button class="primary">提交审核</button><p id="form-msg"></p></form></section>
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
}
document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-go]");
  if (t) go(t.dataset.go!);
});
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
          `<article class="card" data-course="${c.id}"><div><span class="pill ${esc(c.category)}">${esc(labels[c.category])}</span><span class="code">${esc(c.code)}</span></div><div><h3>${esc(c.name)}</h3><p>${esc(c.teachers || "教师待补充")} · ${esc(c.department)}</p></div><div class="metrics"><b>${c.rating ? esc(c.rating) + "/5" : "暂无评分"}</b><span>${esc(c.review_count)} 份评价</span></div></article>`,
      )
      .join("") || '<div class="empty">没有匹配课程</div>';
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
        `<article class="card" data-teacher="${t.id}"><div><span class="pill">教师</span></div><div><h3>${esc(t.name)}</h3><p>${esc(t.title)} · ${esc(t.department)}</p></div><div class="metrics"><b>${t.rating ? esc(t.rating) + "/5" : "暂无评分"}</b><span>${esc(t.course_count)} 门课</span></div></article>`,
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
    `<div class="detail-hero"><h1>${esc(t.name)}</h1><p>${esc(t.title)} · ${esc(t.department)}</p><p>${esc(t.bio)}</p></div><div class="grid">${d.courses.map((c: any) => `<article class="card" data-course="${c.id}"><div></div><div><h3>${esc(c.name)}</h3><p>${esc(c.code)}</p></div><div class="metrics"><b>${c.rating ? esc(c.rating) + "/5" : "暂无评分"}</b></div></article>`).join("")}</div>`;
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
async function detail(id: number) {
  const d = await api(`/api/courses/${id}`),
    c = d.course;
  $("#course-detail").innerHTML =
    `<div class="detail-hero"><span class="pill ${esc(c.category)}">${esc(labels[c.category])}</span><h1>${esc(c.name)}</h1><p>${esc(c.code)} · ${esc(c.department)} · ${c.teachers.map((t: Teacher) => `<button class="link" data-teacher="${t.id}">${esc(t.name)}</button>`).join(" ")}</p></div><h2>学生怎么说</h2><div class="reviews">${d.reviews.map((r: any) => `<article class="review"><div class="score">${esc(r.overall)}<small>/5</small></div><div><b>${esc(r.teacher_name || "未指定教师")} · ${esc(r.term)}</b><p>${esc(r.comment || r.teaching)}</p><dl>${reviewMetrics(r)}</dl></div></article>`).join("") || '<div class="empty">暂无评价</div>'}</div>`;
  document
    .querySelectorAll<HTMLElement>("[data-teacher]")
    .forEach(
      (x) => (x.onclick = () => teacherDetail(Number(x.dataset.teacher))),
    );
  go("detail");
}
const score = (name: string, label: string, required = false) =>
  `<label>${label}<select name="${name}" ${required ? "required" : ""}><option value="">未评价</option>${[5, 4, 3, 2, 1].map((x) => `<option>${x}</option>`).join("")}</select></label>`;
const adminScore = (name: string, label: string, value: unknown) =>
  `<label>${label}<select name="${name}"><option value="">未评价</option>${[5, 4, 3, 2, 1].map((x) => `<option value="${x}" ${Number(value) === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>`;
function fields() {
  const c = courseOptions.find(
    (x) => x.id === Number($("#course-select").value),
  );
  $("#dynamic-fields").innerHTML = !c
    ? ""
    : c.category === "pe"
      ? `<div class="two"><label>点名<input name="attendance"></label><label>强度<input name="workload"></label></div><label>考核方式<textarea name="assessment"></textarea></label><div class="two"><label>给分说明<input name="grading"></label>${score("gradingScore", "给分评价")}</div>`
      : c.category === "general"
        ? `<p class="form-note">请评价这门公共选修课本身的体验。</p><div class="two">${score("interest", "内容吸引力", true)}${score("practicality", "实用与收获", true)}</div><div class="two">${score("workloadScore", "时间投入（5 为投入大）", true)}${score("fairness", "考核公平", true)}</div>${score("organization", "课堂组织", true)}<label>考核方式<textarea name="assessment"></textarea></label>`
        : `<div class="two"><label>点名<input name="attendance"></label><label>给分<input name="grading"></label></div><label>是否捞人<input name="rescue"></label><label>课堂质量<textarea name="teaching"></textarea></label><div class="two">${score("clarity", "讲解清晰度")}${score("knowledge", "知识收获")}</div>`;
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
    b.turnstileToken = (window as any).turnstile?.getResponse?.() || "";
    const d = await api("/api/reviews", {
      method: "POST",
      body: JSON.stringify(b),
    });
    $("#form-msg").textContent = d.message;
    f.reset();
    fields();
    (window as any).turnstile?.reset?.();
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
      `<p>总行数：${preview.total}；有效：${preview.validCount}；错误：${preview.errors.length}</p>` +
      (preview.errors.length
        ? `<div class="table-scroll"><table><thead><tr><th>行</th><th>字段</th><th>问题</th></tr></thead><tbody>${preview.errors.map((item: any) => `<tr><td>${esc(item.row)}</td><td>${esc(item.field)}</td><td>${esc(item.message)}</td></tr>`).join("")}</tbody></table></div>`
        : `<details><summary>查看规范化预览（前 50 行）</summary><pre>${esc(JSON.stringify(preview.preview, null, 2))}</pre></details>`);
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
      $("#import-msg").textContent = `成功导入 ${result.count} 行`;
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
    `<div class="table-scroll"><table><thead><tr><th>批次</th><th>状态</th><th>行数</th><th>审核状态</th><th>导入时间</th><th>操作</th></tr></thead><tbody>${data.items
      .map(
        (batch: any) =>
          `<tr><td><code>${esc(batch.id)}</code></td><td>${esc(batch.status)}</td><td>${esc(batch.row_count)}</td><td>待审 ${esc(batch.pending_count)} / 通过 ${esc(batch.approved_count)} / 驳回 ${esc(batch.rejected_count)}</td><td>${esc(batch.imported_at || batch.created_at)}</td><td>${batch.status === "imported" ? `<button class="danger" data-rollback-legacy="${esc(batch.id)}">回滚</button>` : "—"}</td></tr>`,
      )
      .join("") || '<tr><td colspan="6">暂无历史导入批次</td></tr>'}</tbody></table></div>` +
    `<div class="pager"><button id="legacy-prev" ${batchPage <= 1 ? "disabled" : ""}>上一页</button><span>${batchPage} / ${data.pages}</span><button id="legacy-next" ${batchPage >= data.pages ? "disabled" : ""}>下一页</button></div>`;
  let pendingPayload: any = null;
  $("#legacy-status").onchange = () =>
    legacyImportsAdmin(1, $("#legacy-status").value);
  $("#legacy-prev").onclick = () => legacyImportsAdmin(batchPage - 1, status);
  $("#legacy-next").onclick = () => legacyImportsAdmin(batchPage + 1, status);
  $("#legacy-json").onchange = async (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 1_900_000) {
      $("#legacy-msg").textContent = "文件过大，请使用审批工具生成的分片 payload";
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
      $("#legacy-msg").textContent = `已导入批次 ${result.batchId}，共 ${result.count} 条，仍需管理员审核。`;
    } finally {
      $("#legacy-commit").removeAttribute("disabled");
    }
  };
  document.querySelectorAll<HTMLElement>("[data-rollback-legacy]").forEach(
    (button) =>
      (button.onclick = async () => {
        const id = button.dataset.rollbackLegacy || "";
        if (!confirm(`确认回滚批次 ${id}？该批次的历史评价将被删除。`)) return;
        await api(`/api/admin/legacy-imports/${encodeURIComponent(id)}/rollback`, {
          method: "POST",
          body: "{}",
        });
        await legacyImportsAdmin(batchPage, status);
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
  '<button id="offerings-tab">开课班</button><button id="sessions-tab">会话</button><button id="admin-logout">退出</button>',
);
$("#offerings-tab").onclick = () => offeringsAdmin();
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
$("#teacher-select")
  .closest("label")
  .insertAdjacentHTML(
    "beforebegin",
    '<label>开课班<select name="offeringId" id="offering-select" required><option value="">请先选择课程</option></select></label>',
  );
$("#course-select").onchange = async () => {
  const id = Number($("#course-select").value);
  $("#teacher-select").innerHTML = '<option value="">请先选择开课班</option>';
  if (!id) {
    $("#offering-select").innerHTML = '<option value="">请先选择课程</option>';
    fields();
    return;
  }
  const os = await api(`/api/offerings?courseId=${id}`);
  $("#offering-select").innerHTML =
    '<option value="">请选择学期与班次</option>' +
    os
      .map(
        (o: any) =>
          `<option value="${o.id}">${esc(o.term || "学期未标注")} · ${esc(o.section || "默认班")} ${o.campus ? "· " + esc(o.campus) : ""}</option>`,
      )
      .join("");
  fields();
};
$("#offering-select").onchange = async () => {
  const id = Number($("#offering-select").value);
  if (!id) {
    $("#teacher-select").innerHTML = '<option value="">请先选择开课班</option>';
    return;
  }
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
(async () => {
  const c = await api("/api/config");
  $("#brand").textContent = c.siteName;
  $("#footer").textContent = `${c.siteName} · ${c.universityName}`;
  if (c.turnstileSiteKey) {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.defer = true;
    // @ts-expect-error DOM and Workers HTMLRewriter Element overloads collide on append()
    document.head.append(s);
    $("#turnstile").innerHTML =
      `<div class="cf-turnstile" data-sitekey="${esc(c.turnstileSiteKey)}" data-action="turnstile-spin-v2"></div>`;
  }
  await Promise.all([load(), loadTeachers(), loadCourseOptions()]);
})().catch((e) => ($("#courses").textContent = e.message));
