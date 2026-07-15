import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_NAME: string;
  UNIVERSITY_NAME: string;
  ADMIN_PASSWORD?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
};
type Vars = {
  adminSession?: string;
  adminSessionId?: string;
  adminCsrf?: string;
};
const app = new Hono<{ Bindings: Bindings; Variables: Vars }>();
const clean = (v: unknown, n = 500) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";
const integer = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};
const rating = (v: unknown) => {
  if (v === "" || v == null) return null;
  const n = integer(v);
  return n && n >= 1 && n <= 5 ? n : null;
};
const digest = async (s: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const token = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const fail = (c: any, error: string, status = 400) => c.json({ error }, status);
const pageArgs = (c: any) => ({
  page: Math.max(1, integer(c.req.query("page")) || 1),
  size: Math.min(50, Math.max(1, integer(c.req.query("pageSize")) || 20)),
});
const originOk = (c: any) => {
  const origin = c.req.header("Origin");
  return origin === new URL(c.req.url).origin;
};
const csrfOk = (c: any, expected: string) => {
  const header = c.req.header("X-CSRF-Token"),
    cookie = getCookie(c, "jufexk_csrf");
  return !!header && header === cookie && header === expected;
};
const takeRateLimit = async (
  db: D1Database,
  key: string,
  seconds: number,
  limit: number,
) => {
  const result = await db
    .prepare(
      `INSERT INTO rate_limit_counters(key,window_start,count) VALUES(?,unixepoch(),1)
       ON CONFLICT(key) DO UPDATE SET
         count=CASE WHEN rate_limit_counters.window_start<=unixepoch()-? THEN 1 ELSE rate_limit_counters.count+1 END,
         window_start=CASE WHEN rate_limit_counters.window_start<=unixepoch()-? THEN unixepoch() ELSE rate_limit_counters.window_start END
       WHERE rate_limit_counters.window_start<=unixepoch()-? OR rate_limit_counters.count<?`,
    )
    .bind(key, seconds, seconds, seconds, limit)
    .run();
  return (result.meta.changes || 0) === 1;
};

app.use("/api/*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
});

app.get("/api/config", async (c) =>
  c.json({
    siteName: c.env.SITE_NAME,
    universityName: c.env.UNIVERSITY_NAME,
    admin: false,
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || "",
  }),
);
app.get("/api/courses", async (c) => {
  const { page, size } = pageArgs(c),
    q = `%${clean(c.req.query("q"), 80)}%`,
    cat = clean(c.req.query("category"), 20),
    department = clean(c.req.query("department"), 80),
    teacherId = integer(c.req.query("teacherId"));
  const where = `(?='' OR c.category=?) AND (?='' OR c.department=?) AND (? IS NULL OR ct.teacher_id=?) AND (c.name LIKE ? OR c.code LIKE ? OR t.name LIKE ?)`;
  const args = [
    cat,
    cat,
    department,
    department,
    teacherId,
    teacherId,
    q,
    q,
    q,
  ];
  const total = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT c.id) n FROM courses c LEFT JOIN course_teachers ct ON ct.course_id=c.id LEFT JOIN teachers t ON t.id=ct.teacher_id WHERE ${where}`,
  )
    .bind(...args)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT c.*,GROUP_CONCAT(DISTINCT t.name) teachers,COUNT(DISTINCT r.id) review_count,ROUND(AVG(r.overall),1) rating FROM courses c LEFT JOIN course_teachers ct ON ct.course_id=c.id LEFT JOIN teachers t ON t.id=ct.teacher_id LEFT JOIN reviews r ON r.course_id=c.id AND r.status='approved' WHERE ${where} GROUP BY c.id ORDER BY review_count DESC,c.name LIMIT ? OFFSET ?`,
  )
    .bind(...args, size, (page - 1) * size)
    .all();
  return c.json({
    items: results,
    page,
    pageSize: size,
    total: total?.n || 0,
    pages: Math.ceil((total?.n || 0) / size),
  });
});
app.get("/api/teachers", async (c) => {
  const q = `%${clean(c.req.query("q"), 80)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT t.*,COUNT(DISTINCT ct.course_id) course_count,COUNT(DISTINCT CASE WHEN r.status='approved' THEN r.id END) review_count,ROUND(AVG(CASE WHEN r.status='approved' THEN r.overall END),1) rating FROM teachers t LEFT JOIN course_teachers ct ON ct.teacher_id=t.id LEFT JOIN reviews r ON r.teacher_id=t.id WHERE t.name LIKE ? OR t.department LIKE ? GROUP BY t.id ORDER BY t.name LIMIT 100`,
  )
    .bind(q, q)
    .all();
  return c.json(results);
});
app.get("/api/teachers/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const teacher = await c.env.DB.prepare("SELECT * FROM teachers WHERE id=?")
    .bind(id)
    .first();
  if (!teacher) return fail(c, "教师不存在", 404);
  const courses = (
    await c.env.DB.prepare(
      `SELECT c.*,COUNT(r.id) review_count,ROUND(AVG(r.overall),1) rating FROM course_teachers ct JOIN courses c ON c.id=ct.course_id LEFT JOIN reviews r ON r.course_id=c.id AND r.teacher_id=? AND r.status='approved' WHERE ct.teacher_id=? GROUP BY c.id`,
    )
      .bind(id, id)
      .all()
  ).results;
  return c.json({ teacher, courses });
});
app.get("/api/courses/options", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        `SELECT c.id,c.code,c.name,c.category,c.department,GROUP_CONCAT(t.name) teachers FROM courses c LEFT JOIN course_teachers ct ON ct.course_id=c.id LEFT JOIN teachers t ON t.id=ct.teacher_id GROUP BY c.id ORDER BY c.name LIMIT 2000`,
      ).all()
    ).results,
  ),
);
app.get("/api/courses/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const course = await c.env.DB.prepare("SELECT * FROM courses WHERE id=?")
    .bind(id)
    .first();
  if (!course) return fail(c, "课程不存在", 404);
  const teachers = (
    await c.env.DB.prepare(
      "SELECT t.* FROM teachers t JOIN course_teachers ct ON ct.teacher_id=t.id WHERE ct.course_id=? ORDER BY t.name",
    )
      .bind(id)
      .all()
  ).results;
  const reviews = (
    await c.env.DB.prepare(
      `SELECT r.id,r.course_id,r.teacher_id,r.offering_id,r.category,
        r.attendance,r.grading,r.grading_score,r.workload,r.rescue,
        r.assessment,r.teaching,r.clarity,r.knowledge,r.overall,
        r.interest,r.practicality,r.workload_score,r.fairness,r.organization,
        r.comment,r.term,r.created_at,t.name teacher_name
       FROM reviews r LEFT JOIN teachers t ON t.id=r.teacher_id
       WHERE r.course_id=? AND r.status='approved'
       ORDER BY r.created_at DESC LIMIT 100`,
    )
      .bind(id)
      .all()
  ).results;
  return c.json({ course: { ...course, teachers }, reviews });
});

async function verifyTurnstile(c: any, response: string, ip: string) {
  if (!c.env.TURNSTILE_SECRET) return !c.env.TURNSTILE_SITE_KEY;
  if (!response) return false;
  try {
    const body = new URLSearchParams({
      secret: c.env.TURNSTILE_SECRET,
      response,
      remoteip: ip,
    });
    const r = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    if (!r.ok) return false;
    const result = await r.json<{ success: boolean }>();
    return result.success === true;
  } catch {
    return false;
  }
}
app.get("/api/offerings", async (c) => {
  const courseId = integer(c.req.query("courseId"));
  if (!courseId) return fail(c, "courseId is required");
  const results = (
    await c.env.DB.prepare(
      `SELECT o.*,GROUP_CONCAT(t.id) teacher_ids,GROUP_CONCAT(t.name) teachers FROM offerings o LEFT JOIN offering_teachers ot ON ot.offering_id=o.id LEFT JOIN teachers t ON t.id=ot.teacher_id WHERE o.course_id=? AND o.status='active' GROUP BY o.id ORDER BY o.term DESC,o.section`,
    )
      .bind(courseId)
      .all()
  ).results;
  return c.json(results);
});
app.get("/api/offerings/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const offering = await c.env.DB.prepare(
    `SELECT o.*,c.name course_name,c.category FROM offerings o JOIN courses c ON c.id=o.course_id WHERE o.id=?`,
  )
    .bind(id)
    .first();
  if (!offering) return fail(c, "开课班不存在", 404);
  const teachers = (
    await c.env.DB.prepare(
      `SELECT t.* FROM offering_teachers ot JOIN teachers t ON t.id=ot.teacher_id WHERE ot.offering_id=? ORDER BY t.name`,
    )
      .bind(id)
      .all()
  ).results;
  return c.json({ offering, teachers });
});
app.post("/api/reviews", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  if (clean(b.website)) return c.json({ ok: true });
  let courseId = integer(b.courseId);
  const offeringId = integer(b.offeringId),
    teacherId = integer(b.teacherId),
    overall = rating(b.overall),
    ip = c.req.header("CF-Connecting-IP") || "unknown",
    ipHash = await digest(ip);
  if (!(await verifyTurnstile(c, clean(b.turnstileToken, 2048), ip)))
    return fail(c, "人机验证失败，请重试", 403);
  const course = offeringId
    ? await c.env.DB.prepare(
        `SELECT c.id course_id,c.category FROM offerings o JOIN courses c ON c.id=o.course_id JOIN offering_teachers ot ON ot.offering_id=o.id WHERE o.id=? AND o.status='active' AND ot.teacher_id=? LIMIT 1`,
      )
        .bind(offeringId, teacherId)
        .first<{ course_id: number; category: string }>()
    : await c.env.DB.prepare(
        `SELECT c.id course_id,c.category FROM courses c JOIN course_teachers ct ON ct.course_id=c.id WHERE c.id=? AND ct.teacher_id=? LIMIT 1`,
      )
        .bind(courseId, teacherId)
        .first<{ course_id: number; category: string }>();
  if (course) courseId = course.course_id;
  if (!course || !overall)
    return fail(c, "请选择有效的课程、任课教师和总体评分");
  const clarity = rating(b.clarity),
    knowledge = rating(b.knowledge),
    gradingScore = rating(b.gradingScore),
    interest = rating(b.interest),
    practicality = rating(b.practicality),
    workloadScore = rating(b.workloadScore),
    fairness = rating(b.fairness),
    organization = rating(b.organization);
  if (
    (b.clarity && !clarity) ||
    (b.knowledge && !knowledge) ||
    (b.gradingScore && !gradingScore) ||
    (b.interest && !interest) ||
    (b.practicality && !practicality) ||
    (b.workloadScore && !workloadScore) ||
    (b.fairness && !fairness) ||
    (b.organization && !organization)
  )
    return fail(c, "评分必须在 1 到 5 之间");
  if (
    course.category === "general" &&
    (!interest || !practicality || !workloadScore || !fairness || !organization)
  )
    return fail(c, "公共选修课的五项专项评分必须完整填写");
  if (!(await takeRateLimit(c.env.DB, `review-submit:${ipHash}`, 3600, 5)))
    return fail(c, "提交过于频繁，请稍后再试", 429);
  const term = clean(b.term, 30);
  const dedupeKey = await digest(
    `${courseId}|${teacherId}|${offeringId || 0}|${term}|${ipHash}`,
  );
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO review_dedupe(key) VALUES(?)").bind(
        dedupeKey,
      ),
      c.env.DB.prepare(
        `INSERT INTO reviews(course_id,teacher_id,offering_id,category,attendance,grading,grading_score,workload,rescue,assessment,teaching,clarity,knowledge,interest,practicality,workload_score,fairness,organization,overall,comment,term,submitter_hash)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        courseId,
        teacherId,
        offeringId,
        course.category,
        clean(b.attendance, 120),
        clean(b.grading, 120),
        gradingScore,
        clean(b.workload, 120),
        clean(b.rescue, 120),
        clean(b.assessment, 200),
        clean(b.teaching, 600),
        clarity,
        knowledge,
        interest,
        practicality,
        workloadScore,
        fairness,
        organization,
        overall,
        clean(b.comment, 1200),
        term,
        ipHash,
      ),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      return fail(c, "近期已提交过这位教师的同一课程评价", 409);
    throw error;
  }
  return c.json({ ok: true, message: "投稿已进入审核队列" });
});

app.post("/api/admin/login", async (c) => {
  if (!originOk(c)) return fail(c, "来源校验失败", 403);
  const ipHash = await digest(c.req.header("CF-Connecting-IP") || "unknown");
  if (!(await takeRateLimit(c.env.DB, `admin-login:${ipHash}`, 900, 8)))
    return fail(c, "登录尝试过多，请稍后再试", 429);
  const b = await c.req.json<{ password?: string }>();
  const ok =
    !!c.env.ADMIN_PASSWORD && clean(b.password, 200) === c.env.ADMIN_PASSWORD;
  await c.env.DB.prepare(
    "INSERT INTO admin_login_attempts(ip_hash,success) VALUES(?,?)",
  )
    .bind(ipHash, ok ? 1 : 0)
    .run();
  if (!ok) return fail(c, "口令错误", 401);
  const raw = token(),
    sessionId = token().slice(0, 32),
    csrf = token();
  await c.env.DB.prepare(
    `INSERT INTO admin_sessions(token_hash,csrf_token,ip_hash,expires_at,session_id) VALUES(?,?,?,datetime('now','+24 hours'),?)`,
  )
    .bind(await digest(raw), csrf, ipHash, sessionId)
    .run();
  setCookie(c, "jufexk_admin", raw, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: 86400,
  });
  setCookie(c, "jufexk_csrf", csrf, {
    httpOnly: false,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: 86400,
  });
  return c.json({ ok: true, csrfToken: csrf });
});
app.use("/api/admin/*", async (c, next) => {
  const raw = getCookie(c, "jufexk_admin");
  if (!raw) return fail(c, "请先登录管理员后台", 401);
  const session = await c.env.DB.prepare(
    `SELECT token_hash,session_id,csrf_token FROM admin_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP`,
  )
    .bind(await digest(raw))
    .first<{ token_hash: string; session_id: string; csrf_token: string }>();
  if (!session) return fail(c, "会话已失效，请重新登录", 401);
  c.set("adminSession", session.token_hash);
  c.set("adminSessionId", session.session_id);
  c.set("adminCsrf", session.csrf_token);
  if (
    c.req.method !== "GET" &&
    (!originOk(c) || !csrfOk(c, session.csrf_token))
  )
    return fail(c, "安全校验失败，请刷新后重试", 403);
  await next();
});
app.get("/api/admin/session", (c) =>
  c.json({ ok: true, csrfToken: c.get("adminCsrf") }),
);
app.post("/api/admin/logout", async (c) => {
  await c.env.DB.prepare(
    "UPDATE admin_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?",
  )
    .bind(c.get("adminSession"))
    .run();
  deleteCookie(c, "jufexk_admin", { path: "/" });
  deleteCookie(c, "jufexk_csrf", { path: "/" });
  return c.json({ ok: true });
});
app.get("/api/admin/sessions", async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM admin_sessions WHERE expires_at<datetime('now','-7 days')",
    ),
    c.env.DB.prepare(
      "DELETE FROM rate_limit_counters WHERE window_start<unixepoch()-86400",
    ),
    c.env.DB.prepare(
      "DELETE FROM review_dedupe WHERE created_at<datetime('now','-30 days')",
    ),
    c.env.DB.prepare(
      "DELETE FROM admin_login_attempts WHERE created_at<datetime('now','-30 days')",
    ),
  ]);
  const sessions = (
    await c.env.DB.prepare(
      `SELECT session_id,created_at,expires_at,revoked_at
       FROM admin_sessions ORDER BY created_at DESC LIMIT 100`,
    ).all()
  ).results.map((row: any) => ({
    ...row,
    current: row.session_id === c.get("adminSessionId"),
  }));
  return c.json({ sessions });
});
app.post("/api/admin/sessions/:id/revoke", async (c) => {
  const id = clean(c.req.param("id"), 64);
  if (id === c.get("adminSessionId"))
    return fail(c, "请使用退出功能注销当前会话", 400);
  const result = await c.env.DB.prepare(
    "UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE session_id=?",
  )
    .bind(id)
    .run();
  return c.json({ ok: true, count: result.meta.changes || 0 });
});
app.post("/api/admin/sessions/revoke-others", async (c) => {
  const result = await c.env.DB.prepare(
    "UPDATE admin_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE session_id<>? AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP",
  )
    .bind(c.get("adminSessionId"))
    .run();
  return c.json({ ok: true, count: result.meta.changes || 0 });
});
app.get("/api/admin/reviews", async (c) => {
  const { page, size } = pageArgs(c),
    status = clean(c.req.query("status"), 20) || "pending",
    q = `%${clean(c.req.query("q"), 80)}%`;
  if (!["pending", "approved", "rejected", "all"].includes(status))
    return fail(c, "无效审核状态");
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM reviews r JOIN courses c ON c.id=r.course_id LEFT JOIN teachers t ON t.id=r.teacher_id WHERE (?='all' OR r.status=?) AND(c.name LIKE ? OR c.code LIKE ? OR t.name LIKE ? OR r.comment LIKE ? OR r.teaching LIKE ? OR r.term LIKE ?)`,
  )
    .bind(status, status, q, q, q, q, q, q)
    .first<{ n: number }>();
  const results = (
    await c.env.DB.prepare(
      `SELECT r.*,c.name course_name,c.code,t.name teacher_name FROM reviews r JOIN courses c ON c.id=r.course_id LEFT JOIN teachers t ON t.id=r.teacher_id WHERE (?='all' OR r.status=?) AND(c.name LIKE ? OR c.code LIKE ? OR t.name LIKE ? OR r.comment LIKE ? OR r.teaching LIKE ? OR r.term LIKE ?) ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(status, status, q, q, q, q, q, q, size, (page - 1) * size)
      .all()
  ).results;
  return c.json({
    items: results,
    total: total?.n || 0,
    page,
    pages: Math.ceil((total?.n || 0) / size),
  });
});
app.patch("/api/admin/reviews/:id", async (c) => {
  const b = await c.req.json<Record<string, unknown>>(),
    status = clean(b.status, 20),
    note = clean(b.note, 500),
    id = integer(c.req.param("id"));
  if (!["approved", "rejected"].includes(status)) return fail(c, "无效状态");
  if (status === "rejected" && !note) return fail(c, "驳回时必须填写理由");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE reviews SET status=?,moderator_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(status, note, id),
    c.env.DB.prepare(
      "INSERT INTO review_moderation_events(review_id,action,note) VALUES(?,?,?)",
    ).bind(id, status, note),
  ]);
  return c.json({ ok: true });
});
app.patch("/api/admin/reviews/:id/content", async (c) => {
  const b = await c.req.json<Record<string, unknown>>(),
    id = integer(c.req.param("id"));
  const scores = [
    rating(b.interest),
    rating(b.practicality),
    rating(b.workloadScore),
    rating(b.fairness),
    rating(b.organization),
  ];
  if (
    [
      b.interest,
      b.practicality,
      b.workloadScore,
      b.fairness,
      b.organization,
    ].some((value, index) => value !== "" && value != null && !scores[index])
  )
    return fail(c, "评分必须在 1 到 5 之间");
  const result = await c.env.DB.prepare(
    "UPDATE reviews SET comment=?,teaching=?,attendance=?,grading=?,workload=?,rescue=?,assessment=?,interest=?,practicality=?,workload_score=?,fairness=?,organization=? WHERE id=?",
  )
    .bind(
      clean(b.comment, 1200),
      clean(b.teaching, 600),
      clean(b.attendance, 120),
      clean(b.grading, 120),
      clean(b.workload, 120),
      clean(b.rescue, 120),
      clean(b.assessment, 200),
      ...scores,
      id,
    )
    .run();
  if (!result.meta.changes) return fail(c, "评价不存在", 404);
  await c.env.DB.prepare(
    `INSERT INTO review_moderation_events(review_id,action,note) VALUES(?,'edited',?)`,
  )
    .bind(id, clean(b.note, 500))
    .run();
  return c.json({ ok: true });
});
app.get("/api/admin/reviews/:id/events", async (c) => {
  const id = integer(c.req.param("id"));
  const review = await c.env.DB.prepare("SELECT id FROM reviews WHERE id=?")
    .bind(id)
    .first();
  if (!review) return fail(c, "评价不存在", 404);
  return c.json(
    (
      await c.env.DB.prepare(
        "SELECT id,action,note,created_at FROM review_moderation_events WHERE review_id=? ORDER BY created_at DESC",
      )
        .bind(id)
        .all()
    ).results,
  );
});
app.get("/api/admin/offerings", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        `SELECT o.*,c.name course_name,c.code,GROUP_CONCAT(t.id) teacher_ids,GROUP_CONCAT(t.name) teachers FROM offerings o JOIN courses c ON c.id=o.course_id LEFT JOIN offering_teachers ot ON ot.offering_id=o.id LEFT JOIN teachers t ON t.id=ot.teacher_id GROUP BY o.id ORDER BY o.term DESC,c.name,o.section`,
      ).all()
    ).results,
  ),
);
app.post("/api/admin/offerings", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const courseId = integer(b.courseId),
    term = clean(b.term, 30),
    section = clean(b.section, 80),
    status = clean(b.status, 20) || "active",
    teacherIds = [
      ...new Set(
        (Array.isArray(b.teacherIds) ? b.teacherIds : [])
          .map(integer)
          .filter((x): x is number => !!x),
      ),
    ];
  if (!courseId || !section || !["active", "archived"].includes(status))
    return fail(c, "课程、班次和状态无效");
  if (!teacherIds.length) return fail(c, "请至少选择一位任课教师");
  const validTeachers = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM teachers WHERE id IN (${teacherIds.map(() => "?").join(",")})`,
  )
    .bind(...teacherIds)
    .first<{ n: number }>();
  if (validTeachers?.n !== teacherIds.length)
    return fail(c, "任课教师中存在无效记录");
  let offeringId = integer(b.id);
  const statements: D1PreparedStatement[] = [];
  if (offeringId) {
    const existing = await c.env.DB.prepare(
      "SELECT course_id,term,section FROM offerings WHERE id=?",
    )
      .bind(offeringId)
      .first<{ course_id: number; term: string; section: string }>();
    if (!existing) return fail(c, "开课班不存在", 404);
    const used = await c.env.DB.prepare(
      "SELECT 1 used FROM reviews WHERE offering_id=? LIMIT 1",
    )
      .bind(offeringId)
      .first();
    if (
      used &&
      (existing.course_id !== courseId ||
        existing.term !== term ||
        existing.section !== section)
    )
      return fail(c, "已有评价的开课班不能修改课程、学期或班次", 409);
    statements.push(
      c.env.DB.prepare(
        "UPDATE offerings SET course_id=?,term=?,section=?,campus=?,schedule=?,status=? WHERE id=?",
      ).bind(
        courseId,
        term,
        section,
        clean(b.campus, 80),
        clean(b.schedule, 160),
        status,
        offeringId,
      ),
    );
  } else {
    offeringId = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO offerings(id,course_id,term,section,campus,schedule,status) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        offeringId,
        courseId,
        term,
        section,
        clean(b.campus, 80),
        clean(b.schedule, 160),
        status,
      ),
    );
  }
  statements.push(
    c.env.DB.prepare("DELETE FROM offering_teachers WHERE offering_id=?").bind(
      offeringId,
    ),
    ...teacherIds.map((teacherId) =>
      c.env.DB.prepare(
        "INSERT INTO offering_teachers(offering_id,teacher_id) VALUES(?,?)",
      ).bind(offeringId, teacherId),
    ),
  );
  await c.env.DB.batch(statements);
  return c.json({ ok: true, id: offeringId });
});
app.delete("/api/admin/offerings/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const used = await c.env.DB.prepare(
    "SELECT id FROM reviews WHERE offering_id=? LIMIT 1",
  )
    .bind(id)
    .first();
  if (used) return fail(c, "已有评价的开课班不能删除", 409);
  await c.env.DB.prepare("DELETE FROM offerings WHERE id=?").bind(id).run();
  return c.json({ ok: true });
});
app.get("/api/admin/courses", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        `SELECT c.*,GROUP_CONCAT(t.id) teacher_ids,GROUP_CONCAT(t.name) teachers FROM courses c LEFT JOIN course_teachers ct ON ct.course_id=c.id LEFT JOIN teachers t ON t.id=ct.teacher_id GROUP BY c.id ORDER BY c.name`,
      ).all()
    ).results,
  ),
);
app.post("/api/admin/courses", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const name = clean(b.name, 120),
    category = clean(b.category, 20);
  if (!name || !["major", "pe", "general"].includes(category))
    return fail(c, "课程名称和类别无效");
  let id = integer(b.id);
  if (id)
    await c.env.DB.prepare(
      "UPDATE courses SET code=?,name=?,category=?,department=?,credits=?,description=? WHERE id=?",
    )
      .bind(
        clean(b.code, 40),
        name,
        category,
        clean(b.department, 80),
        Number(b.credits) || null,
        clean(b.description, 500),
        id,
      )
      .run();
  else {
    const result = await c.env.DB.prepare(
      "INSERT INTO courses(code,name,category,department,credits,description) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        clean(b.code, 40),
        name,
        category,
        clean(b.department, 80),
        Number(b.credits) || null,
        clean(b.description, 500),
      )
      .run();
    id = Number(result.meta.last_row_id);
  }
  const teacherIds = [
    ...new Set(
      (Array.isArray(b.teacherIds) ? b.teacherIds : [])
        .map(integer)
        .filter((x): x is number => !!x),
    ),
  ];
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM course_teachers WHERE course_id=?").bind(id),
    ...teacherIds.map((teacherId) =>
      c.env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
      ).bind(id, teacherId),
    ),
  ]);
  return c.json({ ok: true, id });
});
app.delete("/api/admin/courses/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const used = await c.env.DB.prepare(
    "SELECT id FROM reviews WHERE course_id=? LIMIT 1",
  )
    .bind(id)
    .first();
  if (used) return fail(c, "已有评价的课程不能删除", 409);
  await c.env.DB.prepare("DELETE FROM courses WHERE id=?").bind(id).run();
  return c.json({ ok: true });
});
app.get("/api/admin/teachers", async (c) =>
  c.json(
    (await c.env.DB.prepare("SELECT * FROM teachers ORDER BY name").all())
      .results,
  ),
);
app.post("/api/admin/teachers", async (c) => {
  const b = await c.req.json<Record<string, unknown>>(),
    name = clean(b.name, 120);
  if (!name) return fail(c, "教师姓名不能为空");
  const id = integer(b.id);
  if (id)
    await c.env.DB.prepare(
      "UPDATE teachers SET name=?,department=?,title=?,bio=? WHERE id=?",
    )
      .bind(
        name,
        clean(b.department, 80),
        clean(b.title, 80),
        clean(b.bio, 1000),
        id,
      )
      .run();
  else
    await c.env.DB.prepare(
      "INSERT INTO teachers(name,department,title,bio) VALUES(?,?,?,?)",
    )
      .bind(
        name,
        clean(b.department, 80),
        clean(b.title, 80),
        clean(b.bio, 1000),
      )
      .run();
  return c.json({ ok: true });
});
app.delete("/api/admin/teachers/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const used = await c.env.DB.prepare(
    "SELECT id FROM reviews WHERE teacher_id=? LIMIT 1",
  )
    .bind(id)
    .first();
  if (used) return fail(c, "已有评价的教师不能删除", 409);
  await c.env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(id).run();
  return c.json({ ok: true });
});
app.put("/api/admin/courses/:id/teachers", async (c) => {
  const courseId = integer(c.req.param("id")),
    b = await c.req.json<{ teacherIds?: unknown[] }>(),
    ids = [
      ...new Set(
        (b.teacherIds || []).map(integer).filter((x): x is number => !!x),
      ),
    ];
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM course_teachers WHERE course_id=?").bind(
      courseId,
    ),
    ...ids.map((id) =>
      c.env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
      ).bind(courseId, id),
    ),
  ]);
  return c.json({ ok: true });
});
type ImportIssue = {
  row: number;
  field: string;
  code: string;
  message: string;
};
async function validateImport(
  c: any,
  type: string,
  input: Record<string, unknown>[],
) {
  const errors: ImportIssue[] = [],
    rows: Record<string, unknown>[] = [];
  const issue = (index: number, field: string, code: string, message: string) =>
    errors.push({ row: index + 2, field, code, message });
  for (let index = 0; index < input.length; index++) {
    const source = input[index];
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      issue(index, "row", "invalid_row", "该行不是有效对象");
      continue;
    }
    if (type === "courses") {
      const row = {
        code: clean(source.code, 40),
        name: clean(source.name, 120),
        category: clean(source.category, 20) || "major",
        department: clean(source.department, 80),
        credits:
          source.credits === "" || source.credits == null
            ? null
            : Number(source.credits),
        description: clean(source.description, 500),
      };
      if (!row.name) issue(index, "name", "required", "课程名称不能为空");
      if (!["major", "pe", "general"].includes(row.category))
        issue(
          index,
          "category",
          "invalid_enum",
          "课程类别必须是 major、pe 或 general",
        );
      if (
        row.credits !== null &&
        (!Number.isFinite(row.credits) || row.credits < 0)
      )
        issue(index, "credits", "invalid_number", "学分必须是非负数字");
      rows.push(row);
    } else if (type === "teachers") {
      const row = {
        name: clean(source.name, 120),
        department: clean(source.department, 80),
        title: clean(source.title, 80),
        bio: clean(source.bio, 1000),
      };
      if (!row.name) issue(index, "name", "required", "教师姓名不能为空");
      rows.push(row);
    } else if (type === "relations" || type === "offerings") {
      const row = {
        course_code: clean(source.course_code, 40),
        course_name: clean(source.course_name, 120),
        teacher_name: clean(source.teacher_name, 120),
        teacher_department: clean(source.teacher_department, 80),
        term: clean(source.term, 30),
        section: clean(source.section, 80),
        campus: clean(source.campus, 80),
        schedule: clean(source.schedule, 160),
        status: clean(source.status, 20) || "active",
      };
      if (!row.course_name)
        issue(index, "course_name", "required", "课程名称不能为空");
      if (!row.teacher_name)
        issue(index, "teacher_name", "required", "教师姓名不能为空");
      if (type === "offerings" && !row.section)
        issue(index, "section", "required", "开课班次不能为空");
      if (type === "offerings" && !["active", "archived"].includes(row.status))
        issue(index, "status", "invalid_enum", "状态必须是 active 或 archived");
      if (row.course_name) {
        const course = await c.env.DB.prepare(
          "SELECT id FROM courses WHERE code=? AND name=? LIMIT 1",
        )
          .bind(row.course_code, row.course_name)
          .first();
        if (!course)
          issue(
            index,
            "course_name",
            "course_not_found",
            "找不到匹配课程，请先导入课程",
          );
      }
      if (row.teacher_name) {
        const teacher = await c.env.DB.prepare(
          "SELECT id FROM teachers WHERE name=? AND department=? LIMIT 1",
        )
          .bind(row.teacher_name, row.teacher_department)
          .first();
        if (!teacher)
          issue(
            index,
            "teacher_name",
            "teacher_not_found",
            "找不到匹配教师，请先导入教师",
          );
      }
      rows.push(row);
    }
  }
  return { rows, errors };
}
app.post("/api/admin/import/preview", async (c) => {
  const contentLength = Number(c.req.header("Content-Length") || 0);
  if (contentLength > 1_000_000) return fail(c, "导入文件过大", 413);
  const body = await c.req.json<{
    rows?: Record<string, unknown>[];
    type?: string;
  }>();
  const type = clean(body.type, 20),
    input = Array.isArray(body.rows) ? body.rows : [];
  if (!input.length) return fail(c, "没有可预览的数据");
  if (input.length > 500) return fail(c, "单次最多导入 500 行");
  if (!["courses", "teachers", "relations", "offerings"].includes(type))
    return fail(c, "未知导入类型");
  const validation = await validateImport(c, type, input);
  return c.json({
    ok: validation.errors.length === 0,
    type,
    total: input.length,
    validCount:
      input.length - new Set(validation.errors.map((x) => x.row)).size,
    errors: validation.errors,
    preview: validation.rows.slice(0, 50),
  });
});
app.post("/api/admin/import", async (c) => {
  const contentLength = Number(c.req.header("Content-Length") || 0);
  if (contentLength > 1_000_000) return fail(c, "导入文件过大", 413);
  const b = await c.req.json<{
      rows?: Record<string, unknown>[];
      type?: string;
    }>(),
    input = Array.isArray(b.rows) ? b.rows : [],
    type = clean(b.type, 20) || "courses",
    rows = input;
  if (rows.length > 500) return fail(c, "单次最多导入 500 行");
  if (!["courses", "teachers", "relations", "offerings"].includes(type))
    return fail(c, "未知导入类型");
  if (!rows.length) return fail(c, "没有可导入的数据");
  const validation = await validateImport(c, type, rows);
  if (validation.errors.length)
    return c.json(
      { error: "导入数据校验失败", errors: validation.errors },
      422,
    );
  const normalizedRows = validation.rows;
  if (type === "teachers")
    await c.env.DB.batch(
      normalizedRows.map((x) =>
        c.env.DB.prepare(
          `INSERT INTO teachers(name,department,title,bio) VALUES(?,?,?,?) ON CONFLICT(name,department) DO UPDATE SET title=excluded.title,bio=excluded.bio`,
        ).bind(
          clean(x.name, 120),
          clean(x.department, 80),
          clean(x.title, 80),
          clean(x.bio, 1000),
        ),
      ),
    );
  else if (type === "relations") {
    for (let offset = 0; offset < normalizedRows.length; offset += 25) {
      const statements = normalizedRows.slice(offset, offset + 25).map((x) => {
          const courseCode = clean(x.course_code, 40),
            courseName = clean(x.course_name, 120),
            teacherName = clean(x.teacher_name, 120),
            teacherDepartment = clean(x.teacher_department, 80);
          return c.env.DB.prepare(
            `INSERT OR IGNORE INTO course_teachers(course_id,teacher_id) SELECT c.id,t.id FROM courses c,teachers t WHERE c.code=? AND c.name=? AND t.name=? AND t.department=?`,
          ).bind(courseCode, courseName, teacherName, teacherDepartment);
        });
      await c.env.DB.batch(statements);
    }
  } else if (type === "offerings") {
    for (const x of normalizedRows) {
      const course = await c.env.DB.prepare(
        "SELECT id FROM courses WHERE code=? AND name=? LIMIT 1",
      )
        .bind(x.course_code, x.course_name)
        .first<{ id: number }>();
      const teacher = await c.env.DB.prepare(
        "SELECT id FROM teachers WHERE name=? AND department=? LIMIT 1",
      )
        .bind(x.teacher_name, x.teacher_department)
        .first<{ id: number }>();
      if (!course || !teacher) continue;
      await c.env.DB.prepare(
        `INSERT INTO offerings(course_id,term,section,campus,schedule,status) VALUES(?,?,?,?,?,?) ON CONFLICT(course_id,term,section) DO UPDATE SET campus=excluded.campus,schedule=excluded.schedule,status=excluded.status`,
      )
        .bind(course.id, x.term, x.section, x.campus, x.schedule, x.status)
        .run();
      const offering = await c.env.DB.prepare(
        "SELECT id FROM offerings WHERE course_id=? AND term=? AND section=?",
      )
        .bind(course.id, x.term, x.section)
        .first<{ id: number }>();
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO offering_teachers(offering_id,teacher_id) VALUES(?,?)",
      )
        .bind(offering?.id, teacher.id)
        .run();
    }
  } else
    await c.env.DB.batch(
      normalizedRows.map((x) =>
        c.env.DB.prepare(
          `INSERT INTO courses(code,name,category,department,credits,description) VALUES(?,?,?,?,?,?) ON CONFLICT(code,name) DO UPDATE SET category=excluded.category,department=excluded.department,credits=excluded.credits,description=excluded.description`,
        ).bind(
          clean(x.code, 40),
          clean(x.name, 120),
          clean(x.category, 20) || "major",
          clean(x.department, 80),
          Number(x.credits) || null,
          clean(x.description, 500),
        ),
      ),
    );
  return c.json({ ok: true, count: rows.length });
});

type LegacyApprovedRow = {
  course_id: number;
  teacher_id: number;
  offering_id: number | null;
  category: "major" | "pe" | "general";
  comment: string;
  term: string;
  source_file: string;
  sheet_name: string;
  source_row: string;
  raw_ocr_text: string;
  ocr_confidence: number;
  ocr_tokens_json: string;
  inherited_from: string;
  ocr_course_name: string;
  ocr_teacher_name: string;
  duplicate_group: string | null;
};

async function validateLegacyApproved(
  db: D1Database,
  input: Record<string, unknown>[],
) {
  const errors: Array<{ row: number; field: string; message: string }> = [];
  const rows: LegacyApprovedRow[] = [];
  const add = (row: number, field: string, message: string) =>
    errors.push({ row, field, message });
  input.forEach((raw, offset) => {
    const rowNumber = offset + 2;
    const courseId = integer(raw.course_id),
      teacherId = integer(raw.teacher_id),
      offeringId = raw.offering_id === "" || raw.offering_id == null
        ? null
        : integer(raw.offering_id),
      category = clean(raw.category, 20),
      comment = clean(raw.comment, 5000),
      sourceFile = clean(raw.source_file, 240),
      sourceRow = clean(raw.source_row, 80),
      rawText = clean(raw.raw_ocr_text, 10000),
      confidence = Number(raw.ocr_confidence);
    if (typeof raw.comment !== "string" || raw.comment.length > 5000) add(rowNumber, "comment", "文字评价超过 5000 字限制");
    if (typeof raw.raw_ocr_text !== "string" || raw.raw_ocr_text.length > 10000) add(rowNumber, "raw_ocr_text", "原始 OCR 文本超过 10000 字限制");
    if (typeof raw.ocr_tokens_json !== "string" || raw.ocr_tokens_json.length > 100000) add(rowNumber, "ocr_tokens_json", "OCR token JSON 超过 100000 字限制");
    if (!courseId || courseId < 1) add(rowNumber, "course_id", "必须填写现有课程 ID");
    if (!teacherId || teacherId < 1) add(rowNumber, "teacher_id", "必须填写现有教师 ID");
    if (raw.offering_id !== "" && raw.offering_id != null && (!offeringId || offeringId < 1))
      add(rowNumber, "offering_id", "开课班 ID 无效");
    if (!(["major", "pe", "general"] as string[]).includes(category))
      add(rowNumber, "category", "类别必须为 major、pe 或 general");
    if (!comment) add(rowNumber, "comment", "文字评价不能为空");
    if (!sourceFile) add(rowNumber, "source_file", "来源截图不能为空");
    if (!sourceRow) add(rowNumber, "source_row", "来源行不能为空");
    if (!rawText) add(rowNumber, "raw_ocr_text", "必须保留原始 OCR 文本");
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
      add(rowNumber, "ocr_confidence", "OCR 置信度必须在 0 到 1 之间");
    if (raw.source_type !== "legacy_ocr") add(rowNumber, "source_type", "来源类型必须为 legacy_ocr");
    if (raw.source_label !== "腾讯表格历史资料") add(rowNumber, "source_label", "来源标签不正确");
    if (Object.hasOwn(raw, "overall") && raw.overall !== "" && raw.overall != null)
      add(rowNumber, "overall", "历史文字评价禁止填写或推算 overall");
    try {
      const parsed = JSON.parse(clean(raw.ocr_tokens_json, 100000) || "[]");
      if (!Array.isArray(parsed)) throw new Error("not array");
    } catch {
      add(rowNumber, "ocr_tokens_json", "OCR token 必须是 JSON 数组");
    }
    rows.push({
      course_id: courseId || 0,
      teacher_id: teacherId || 0,
      offering_id: offeringId,
      category: category as LegacyApprovedRow["category"],
      comment,
      term: clean(raw.term, 80),
      source_file: sourceFile,
      sheet_name: clean(raw.sheet_name, 80),
      source_row: sourceRow,
      raw_ocr_text: rawText,
      ocr_confidence: confidence,
      ocr_tokens_json: clean(raw.ocr_tokens_json, 100000) || "[]",
      inherited_from: clean(raw.inherited_from, 240),
      ocr_course_name: clean(raw.ocr_course_name, 240),
      ocr_teacher_name: clean(raw.ocr_teacher_name, 240),
      duplicate_group: clean(raw.duplicate_group, 80) || null,
    });
  });
  if (errors.length) return { rows, errors };
  const courseIds = [...new Set(rows.map((row) => row.course_id))],
    teacherIds = [...new Set(rows.map((row) => row.teacher_id))],
    pairKeys = [...new Set(rows.map((row) => `${row.course_id}:${row.teacher_id}`))],
    offeringIds = [...new Set(rows.flatMap((row) => row.offering_id ? [row.offering_id] : []))];
  const courses = await db.prepare("SELECT id,category FROM courses WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))").bind(JSON.stringify(courseIds)).all<{ id: number; category: string }>();
  const teachers = await db.prepare("SELECT id FROM teachers WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))").bind(JSON.stringify(teacherIds)).all<{ id: number }>();
  const pairs = await db.prepare("SELECT course_id||':'||teacher_id key FROM course_teachers WHERE course_id||':'||teacher_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(pairKeys)).all<{ key: string }>();
  const offeringKeys = offeringIds.length
    ? await db.prepare("SELECT o.id||':'||o.course_id||':'||ot.teacher_id key FROM offerings o JOIN offering_teachers ot ON ot.offering_id=o.id WHERE o.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))").bind(JSON.stringify(offeringIds)).all<{ key: string }>()
    : { results: [] as Array<{ key: string }> };
  const knownCourses = new Map(courses.results.map((row) => [row.id, row.category])),
    knownTeachers = new Set(teachers.results.map((row) => row.id)),
    knownPairs = new Set(pairs.results.map((row) => row.key)),
    knownOfferings = new Set(offeringKeys.results.map((row) => row.key));
  rows.forEach((row, offset) => {
    const rowNumber = offset + 2;
    if (!knownCourses.has(row.course_id)) add(rowNumber, "course_id", "课程不存在");
    else if (knownCourses.get(row.course_id) !== row.category) add(rowNumber, "category", "类别与现有课程不一致");
    if (!knownTeachers.has(row.teacher_id)) add(rowNumber, "teacher_id", "教师不存在");
    if (!knownPairs.has(`${row.course_id}:${row.teacher_id}`)) add(rowNumber, "teacher_id", "教师不在课程已有任课关系中");
    if (row.offering_id && !knownOfferings.has(`${row.offering_id}:${row.course_id}:${row.teacher_id}`))
      add(rowNumber, "offering_id", "开课班与课程、教师不一致");
    if (row.offering_id && !row.term) add(rowNumber, "term", "指定开课班时必须填写明确学期");
  });
  return { rows, errors };
}

app.get("/api/admin/legacy-imports", async (c) => {
  const { page, size } = pageArgs(c),
    status = clean(c.req.query("status"), 20);
  if (status && !["preview", "approved", "imported", "rolled_back", "failed"].includes(status))
    return fail(c, "批次状态无效");
  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) n FROM legacy_import_batches WHERE (?='' OR status=?)",
  ).bind(status, status).first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT b.id,b.source_type,b.source_label,b.status,b.row_count,b.created_at,b.imported_at,b.rolled_back_at,
      (SELECT COUNT(*) FROM legacy_reviews r WHERE r.import_batch_id=b.id AND r.status='pending') pending_count,
      (SELECT COUNT(*) FROM legacy_reviews r WHERE r.import_batch_id=b.id AND r.status='approved') approved_count,
      (SELECT COUNT(*) FROM legacy_reviews r WHERE r.import_batch_id=b.id AND r.status='rejected') rejected_count
     FROM legacy_import_batches b WHERE (?='' OR b.status=?)
     ORDER BY b.created_at DESC,b.id DESC LIMIT ? OFFSET ?`,
  ).bind(status, status, size, (page - 1) * size).all();
  return c.json({ items: results, total: total?.n || 0, page, pages: Math.max(1, Math.ceil((total?.n || 0) / size)) });
});

app.post("/api/admin/legacy-imports/preview", async (c) => {
  if (Number(c.req.header("Content-Length") || 0) > 2_000_000) return fail(c, "批准数据过大", 413);
  const body = await c.req.json<{ rows?: Record<string, unknown>[] }>();
  const input = Array.isArray(body.rows) ? body.rows : [];
  if (!input.length || input.length > 40) return fail(c, "每批必须包含 1–40 条记录");
  const validation = await validateLegacyApproved(c.env.DB, input);
  return c.json({ ok: validation.errors.length === 0, total: input.length, errors: validation.errors });
});

app.post("/api/admin/legacy-imports", async (c) => {
  if (Number(c.req.header("Content-Length") || 0) > 2_000_000) return fail(c, "批准数据过大", 413);
  const body = await c.req.json<{ rows?: Record<string, unknown>[]; manifest?: Record<string, unknown>; idempotencyKey?: string }>();
  const input = Array.isArray(body.rows) ? body.rows : [];
  if (!input.length || input.length > 40) return fail(c, "每批必须包含 1–40 条记录");
  const idempotencyKey = clean(body.idempotencyKey, 64);
  if (!/^[a-f0-9]{32,64}$/.test(idempotencyKey)) return fail(c, "缺少有效的幂等键");
  const validation = await validateLegacyApproved(c.env.DB, input);
  if (validation.errors.length) return c.json({ error: "批准数据校验失败", errors: validation.errors }, 422);
  const batchId = `legacy_${idempotencyKey}`;
  if (await c.env.DB.prepare("SELECT 1 FROM legacy_import_batches WHERE id=?").bind(batchId).first())
    return fail(c, "该批准批次已经导入", 409);
  const statements = [
    c.env.DB.prepare("INSERT INTO legacy_import_batches(id,source_type,source_label,manifest_json,status,row_count,imported_at) VALUES(?,'legacy_ocr','腾讯表格历史资料',?,'imported',?,CURRENT_TIMESTAMP)").bind(batchId, JSON.stringify(body.manifest || {}), validation.rows.length),
    ...validation.rows.map((row) => c.env.DB.prepare(
      `INSERT INTO legacy_reviews(import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,ocr_confidence,ocr_tokens_json,inherited_from,ocr_course_name,course_id,ocr_teacher_name,teacher_id,offering_id,category,comment,term,source_type,source_label,status,duplicate_group)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'legacy_ocr','腾讯表格历史资料','pending',?)`,
    ).bind(batchId, row.source_file, row.sheet_name, row.source_row, row.raw_ocr_text, row.ocr_confidence, row.ocr_tokens_json, row.inherited_from, row.ocr_course_name, row.course_id, row.ocr_teacher_name, row.teacher_id, row.offering_id, row.category, row.comment, row.term, row.duplicate_group)),
  ];
  await c.env.DB.batch(statements);
  return c.json({ ok: true, batchId, count: validation.rows.length, batchStatus: "imported", reviewStatus: "pending" });
});

app.post("/api/admin/legacy-imports/:id/rollback", async (c) => {
  const batchId = clean(c.req.param("id"), 80);
  const batch = await c.env.DB.prepare("SELECT status FROM legacy_import_batches WHERE id=?").bind(batchId).first<{ status: string }>();
  if (!batch) return fail(c, "导入批次不存在", 404);
  if (batch.status !== "imported") return fail(c, "只有 imported 批次可以回滚", 409);
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE legacy_import_batches SET status='rolled_back',rolled_back_at=CURRENT_TIMESTAMP WHERE id=? AND status='imported'").bind(batchId),
    c.env.DB.prepare("DELETE FROM legacy_reviews WHERE import_batch_id=? AND EXISTS(SELECT 1 FROM legacy_import_batches WHERE id=? AND status='rolled_back')").bind(batchId, batchId),
  ]);
  if (!(results[0].meta.changes || 0)) return fail(c, "该批次已经回滚或状态已变化", 409);
  return c.json({ ok: true, batchId, status: "rolled_back" });
});

app.onError((e, c) => {
  if (e instanceof SyntaxError) return fail(c, "请求 JSON 格式错误", 400);
  console.error(
    JSON.stringify({
      event: "request_error",
      message: e.message,
      path: c.req.path,
    }),
  );
  return fail(c, "服务器暂时开小差了", 500);
});
export default app;
