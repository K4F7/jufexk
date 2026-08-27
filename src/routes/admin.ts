import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../app-env";
import type { AppContext } from "./types";
import { isExcludedCourseName } from "../lib/course-catalog-policy";
import {
  andSearchTerms,
  likeSql,
  parseSearchTerms,
} from "../lib/catalog-search";
import {
  isCourseTag,
  isSchemeKey,
  snapshotReviewScores,
  type CourseTag,
  type SchemeKey,
} from "../lib/review-schemes";
import {
  REVIEW_NOTE_HTML_MAX_LENGTH,
  sanitizeReviewNoteValue,
} from "../lib/review-note-html";
import {
  addAdminStudentBindings,
  casSubjectHash,
  casSubjectIsAdminBound,
  claimFirstAdminStudentBinding,
  deleteAdminStudentBinding,
  listAdminStudentBindings,
  loadUserCasSubject,
  parseBindingUsernames,
} from "../admin-student-bindings";
import { resolveOrdinaryUser } from "../ordinary-user-authentication";
import { isOrdinaryUserAuthenticated } from "../ordinary-user-write-authorization";
import { readSecret } from "../secrets";
import {
  listQualifyingSummaryRelations,
  scheduleRelationSummaryRecompute,
} from "../review-summary";
import { loadSiteBanner, sanitizeSiteBanner } from "../site-banner";
import {
  deliverReviewAuthorLookup,
  type ReviewAuthorIdentity,
} from "../admin-review-author-mail";
import {
  clean,
  csrfOk,
  digest,
  fail,
  integer,
  keyedDigest,
  loadCourseSchemeInput,
  markPublicCatalogCacheChanged,
  nullableClean,
  originOk,
  pageArgs,
  parseAdminSchemeKey,
  parseAdminTags,
  parseStashedReview,
  parseTagCsv,
  rating,
  token,
} from "./support";
import {
  adminCourseNoticeSchema,
  adminCourseSchema,
  adminStudentBindingsSchema,
  adminOfferingSchema,
  adminCtaSyncSchema,
  adminTeacherSchema,
  adminUserBlockSchema,
  moderationSchema,
  siteBannerSchema,
  summaryRecomputeSchema,
  teacherIdsSchema,
} from "./request-schemas";
import announcementRoutes from "./announcements";
import {
  ctaHomepageUrl,
  isAllowedCtaHomepageUrl,
  parseCtaHomepageUrl,
} from "../cta-teacher-homepage";
import {
  createHttpCtaClient,
  syncTeacherCtaHomepageBatch,
} from "../cta-teacher-sync";

const adminRoutes = new Hono<AppEnv>();

type CatalogRequestRow = {
  status: string;
  kind: string;
  course_code: string;
  course_name: string;
  category: string;
  teacher_name: string;
  teacher_source_label: string;
  department: string;
  pending_review_json: string;
  submitter_hash: string;
  author_user_id: string | null;
};

type AdminReviewTarget = {
  id: number;
  status: string;
  course_id: number;
  teacher_id: number | null;
  blocked_at: string | null;
  deleted_at: string | null;
};

async function mutateReviewVisibility(
  c: AppContext,
  action: "blocked" | "unblocked" | "deleted",
) {
  const id = integer(c.req.param("id"));
  if (!id) return fail(c, "评价 ID 无效");
  const current = await c.env.DB.prepare(
    `SELECT id,status,course_id,teacher_id,blocked_at,deleted_at
     FROM reviews WHERE id=?`,
  )
    .bind(id)
    .first<AdminReviewTarget>();
  if (!current) return fail(c, "评价不存在", 404);
  if (action !== "deleted" && current.deleted_at)
    return fail(c, "已删除评价不能变更屏蔽状态", 409);

  const updateSql =
    action === "blocked"
      ? `UPDATE reviews SET blocked_at=CURRENT_TIMESTAMP
         WHERE id=? AND blocked_at IS NULL AND deleted_at IS NULL RETURNING id`
      : action === "unblocked"
        ? `UPDATE reviews SET blocked_at=NULL
           WHERE id=? AND blocked_at IS NOT NULL AND deleted_at IS NULL RETURNING id`
        : `UPDATE reviews SET deleted_at=CURRENT_TIMESTAMP
           WHERE id=? AND deleted_at IS NULL RETURNING id`;
  const eventGuard =
    action === "blocked"
      ? "blocked_at IS NULL AND deleted_at IS NULL"
      : action === "unblocked"
        ? "blocked_at IS NOT NULL AND deleted_at IS NULL"
        : "deleted_at IS NULL";
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO review_moderation_events(review_id,action,note,actor_session_id)
       SELECT ?,?,'',? FROM reviews WHERE id=? AND ${eventGuard}`,
    ).bind(id, action, c.get("adminSessionId"), id),
    c.env.DB.prepare(updateSql).bind(id),
  ]);
  const changed = results[1].results.length > 0;
  if (changed && current.status === "approved") {
    markPublicCatalogCacheChanged(c);
    await scheduleRelationSummaryRecompute(c, current.course_id, current.teacher_id, {
      immediate: action !== "unblocked",
    });
  }
  return c.json({ ok: true, changed });
}

async function clientIpHash(c: AppContext) {
  return keyedDigest(
    c.req.header("CF-Connecting-IP") || "unknown",
    await readSecret(c.env.IP_HASH_SECRET),
  );
}

async function issueAdminSession(c: AppContext, ipHash: string) {
  const raw = token();
  const sessionId = token().slice(0, 32);
  const csrf = token();
  const tokenHash = await digest(raw);
  await c.env.DB.prepare(
    `INSERT INTO admin_sessions(token_hash,csrf_token,ip_hash,expires_at,session_id) VALUES(?,?,?,datetime('now','+24 hours'),?)`,
  )
    .bind(tokenHash, csrf, ipHash, sessionId)
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
  c.set("adminSession", tokenHash);
  c.set("adminSessionId", sessionId);
  c.set("adminCsrf", csrf);
  c.set("adminSource", "student");
  return csrf;
}

async function tryElevateStudentAdmin(c: AppContext) {
  const user = await resolveOrdinaryUser(c);
  if (!user || !isOrdinaryUserAuthenticated(user)) return false;
  const subject = await loadUserCasSubject(c.env.DB, user.id);
  if (!subject) return false;
  const bound = await casSubjectIsAdminBound(c.env.DB, subject);
  if (!bound && !(await claimFirstAdminStudentBinding(c.env.DB, subject))) {
    return false;
  }
  await issueAdminSession(c, await clientIpHash(c));
  return true;
}

// Admin access is an allowlisted CAS student identity, not a shared password.
adminRoutes.use("/api/admin/*", async (c, next) => {
  const raw = getCookie(c, "jufexk_admin");
  if (raw) {
    const session = await c.env.DB.prepare(
      `SELECT token_hash,session_id,csrf_token FROM admin_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP`,
    )
      .bind(await digest(raw))
      .first<{ token_hash: string; session_id: string; csrf_token: string }>();
    if (!session) return fail(c, "会话已失效，请重新登录", 401);
    c.set("adminSession", session.token_hash);
    c.set("adminSessionId", session.session_id);
    c.set("adminCsrf", session.csrf_token);
  } else if (!(await tryElevateStudentAdmin(c))) {
    return fail(c, "请先用已绑定的学号登录", 401);
  }
  const csrf = c.get("adminCsrf");
  if (c.req.method !== "GET" && (!originOk(c) || !csrf || !csrfOk(c, csrf)))
    return fail(c, "安全校验失败，请刷新后重试", 403);
  await next();
});
adminRoutes.get("/api/admin/session", (c) =>
  c.json({
    ok: true,
    kind: "admin",
    source: c.get("adminSource") || "session",
    csrfToken: c.get("adminCsrf"),
  }),
);
adminRoutes.post("/api/admin/logout", async (c) => {
  await c.env.DB.prepare(
    "UPDATE admin_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?",
  )
    .bind(c.get("adminSession"))
    .run();
  deleteCookie(c, "jufexk_admin", { path: "/" });
  deleteCookie(c, "jufexk_csrf", { path: "/" });
  return c.json({ ok: true });
});
adminRoutes.put("/api/admin/banner", async (c) => {
  const parsedBody = siteBannerSchema.safeParse(await c.req.json<unknown>());
  if (!parsedBody.success) return fail(c, "Banner HTML 格式或长度无效");
  const banner = sanitizeSiteBanner(parsedBody.data);
  if (!banner) return fail(c, "Banner HTML 消毒后过长");
  const actorSessionId = c.get("adminSessionId") ?? null;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO site_banner_history(desktop_html,mobile_html,actor_session_id)
       VALUES(?,?,?)`,
    ).bind(banner.desktopHtml, banner.mobileHtml, actorSessionId),
    c.env.DB.prepare(
      `UPDATE site_banner_current
       SET desktop_html=?,mobile_html=?,updated_by_session_id=?,updated_at=CURRENT_TIMESTAMP
       WHERE id=1`,
    ).bind(banner.desktopHtml, banner.mobileHtml, actorSessionId),
  ]);
  return c.json({ ok: true, banner: await loadSiteBanner(c.env.DB) });
});
adminRoutes.get("/api/admin/banners", async (c) => {
  const rows = (
    await c.env.DB.prepare(
      `SELECT id,desktop_html,mobile_html,created_at
       FROM site_banner_history
       ORDER BY id DESC
       LIMIT 50`,
    ).all<{
      id: number;
      desktop_html: string;
      mobile_html: string;
      created_at: string;
    }>()
  ).results;
  return c.json({
    items: rows.map((row) => ({
      id: row.id,
      desktopHtml: row.desktop_html,
      mobileHtml: row.mobile_html,
      createdAt: row.created_at,
    })),
  });
});
adminRoutes.get("/api/admin/sessions", async (c) => {
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
  ).results.map((row: Record<string, unknown> & { session_id?: string }) => ({
    ...row,
    current: row.session_id === c.get("adminSessionId"),
  }));
  return c.json({ sessions });
});
adminRoutes.post("/api/admin/sessions/:id/revoke", async (c) => {
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
adminRoutes.post("/api/admin/sessions/revoke-others", async (c) => {
  const result = await c.env.DB.prepare(
    "UPDATE admin_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE session_id<>? AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP",
  )
    .bind(c.get("adminSessionId"))
    .run();
  return c.json({ ok: true, count: result.meta.changes || 0 });
});
adminRoutes.get("/api/admin/users/:id", async (c) => {
  const id = clean(c.req.param("id"), 128);
  if (!id) return fail(c, "用户 ID 无效");
  const user = await c.env.DB.prepare(
    "SELECT id, muted_until FROM users WHERE id=?",
  )
    .bind(id)
    .first<{ id: string; muted_until: number | null }>();
  if (!user) return fail(c, "用户不存在", 404);
  const mutedUntil = user.muted_until;
  if (mutedUntil == null || mutedUntil <= Date.now() / 1000) {
    return c.json({
      userRef: user.id,
      blocked: false,
      blockedUntil: null,
    });
  }
  return c.json({
    userRef: user.id,
    blocked: true,
    blockedUntil: new Date(mutedUntil * 1000).toISOString(),
  });
});
adminRoutes.post("/api/admin/users/:id/block", async (c) => {
  const id = clean(c.req.param("id"), 128);
  const parsedBody = adminUserBlockSchema.safeParse(await c.req.json<unknown>());
  if (!id || !parsedBody.success)
    return fail(c, "禁言天数必须是 1 到 3650 的整数");
  const user = await c.env.DB.prepare("SELECT status FROM users WHERE id=?")
    .bind(id)
    .first<{ status: string }>();
  if (!user) return fail(c, "用户不存在", 404);
  if (user.status !== "active") return fail(c, "当前账号状态不能禁言", 409);
  const mutedUntil = Math.floor(Date.now() / 1000) + parsedBody.data.days * 86400;
  const result = await c.env.DB.prepare(
    "UPDATE users SET muted_until=? WHERE id=? AND status='active'",
  )
    .bind(mutedUntil, id)
    .run();
  if (!(result.meta.changes || 0)) return fail(c, "当前账号状态不能禁言", 409);
  return c.json({
    ok: true,
    blockedUntil: new Date(mutedUntil * 1000).toISOString(),
  });
});
adminRoutes.post("/api/admin/users/:id/unblock", async (c) => {
  const id = clean(c.req.param("id"), 128);
  if (!id) return fail(c, "用户 ID 无效");
  const result = await c.env.DB.prepare(
    "UPDATE users SET muted_until=NULL WHERE id=?",
  )
    .bind(id)
    .run();
  if (!(result.meta.changes || 0)) return fail(c, "用户不存在", 404);
  return c.json({ ok: true, blockedUntil: null });
});
adminRoutes.get("/api/admin/reviews", async (c) => {
  const { page, size } = pageArgs(c),
    status = clean(c.req.query("status"), 20) || "pending",
    searchGroup = andSearchTerms(
      parseSearchTerms(clean(c.req.query("q"), 80)),
      `${likeSql("c.name")} OR ${likeSql("c.code")} OR ${likeSql("t.name")} OR ${likeSql("r.comment")} OR ${likeSql("r.teaching")}`,
    );
  if (!["pending", "approved", "rejected", "all"].includes(status))
    return fail(c, "无效审核状态");
  const searchFilter = searchGroup.sql ? ` AND ${searchGroup.sql}` : "";
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM reviews r JOIN courses c ON c.id=r.course_id LEFT JOIN teachers t ON t.id=r.teacher_id WHERE (?='all' OR r.status=?)${searchFilter}`,
  )
    .bind(status, status, ...searchGroup.args)
    .first<{ n: number }>();
  const results = (
    await c.env.DB.prepare(
      `SELECT r.id,r.course_id,r.teacher_id,r.offering_id,r.category,
        r.attendance,r.grading,r.grading_score,r.workload,r.rescue,
        r.assessment,r.teaching,r.clarity,r.knowledge,r.overall,
        r.interest,r.practicality,r.workload_score,r.fairness,r.organization,
        r.comment,r.comment_format,r.headline,r.grade,
        r.status,r.blocked_at,r.deleted_at,r.moderator_note,r.created_at,r.reviewed_at,
        r.scheme_key,r.scheme_version,
        c.name course_name,c.code,t.name teacher_name
       FROM reviews r JOIN courses c ON c.id=r.course_id
       LEFT JOIN teachers t ON t.id=r.teacher_id
       WHERE (?='all' OR r.status=?)${searchFilter}
       ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(status, status, ...searchGroup.args, size, (page - 1) * size)
      .all()
  ).results;
  return c.json({
    items: results,
    total: total?.n || 0,
    page,
    pages: Math.ceil((total?.n || 0) / size),
  });
});
adminRoutes.get("/api/admin/catalog-requests", async (c) => {
  const { page, size } = pageArgs(c),
    status = clean(c.req.query("status"), 20) || "pending";
  if (!["pending", "approved", "rejected", "all"].includes(status))
    return fail(c, "无效审核状态");
  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) n FROM catalog_requests WHERE (?='all' OR status=?)",
  )
    .bind(status, status)
    .first<{ n: number }>();
  const results = (
    await c.env.DB.prepare(
      `SELECT id,kind,course_code,course_name,category,teacher_name,teacher_source_label,department,note,status,moderator_note,
              created_course_id,created_teacher_id,created_review_id,created_at,reviewed_at,
              pending_review_json<>'' AS has_review
       FROM catalog_requests WHERE (?='all' OR status=?) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(status, status, size, (page - 1) * size)
      .all()
  ).results;
  return c.json({
    items: results,
    total: total?.n || 0,
    page,
    pages: Math.ceil((total?.n || 0) / size),
  });
});
adminRoutes.patch("/api/admin/catalog-requests/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const parsedBody = moderationSchema.safeParse(await c.req.json<unknown>());
  if (!parsedBody.success)
    return fail(c, "审核结果必须是 approved 或 rejected");
  const { status, note } = parsedBody.data;
  if (!id) return fail(c, "无效申请 ID");
  if (!["approved", "rejected"].includes(status))
    return fail(c, "审核结果必须是 approved 或 rejected");
  const request = await c.env.DB.prepare(
    `SELECT status,kind,course_code,course_name,category,teacher_name,
            teacher_source_label,department,pending_review_json,
            submitter_hash,author_user_id
     FROM catalog_requests WHERE id=?`,
  )
    .bind(id)
    .first<CatalogRequestRow>();
  if (!request) return fail(c, "补充申请不存在", 404);
  if (request.status !== "pending")
    return fail(c, "该申请已审核，不能重复处理", 409);
  if (status === "rejected") {
    if (!note) return fail(c, "驳回必须填写理由");
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE catalog_requests SET status='rejected',moderator_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",
      ).bind(note, id),
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO catalog_request_moderation_events(
           catalog_request_id,action,note,actor_session_id
         )
         SELECT ?,?,?,? WHERE EXISTS(
           SELECT 1 FROM catalog_requests WHERE id=? AND status='rejected'
         ) AND NOT EXISTS(
           SELECT 1 FROM catalog_request_moderation_events
           WHERE catalog_request_id=?
         )`,
      ).bind(id, status, note, c.get("adminSessionId"), id, id),
    ]);
    if (!(results[0].meta.changes || 0))
      return fail(c, "该申请已审核，不能重复处理", 409);
    return c.json({ ok: true });
  }
  const statements: D1PreparedStatement[] = [];
  const createsCourse = request.kind === "course";
  if (createsCourse && isExcludedCourseName(request.course_name || ""))
    return fail(c, "班会不纳入课程目录", 409);
  const createsReview = createsCourse && Boolean(request.pending_review_json);
  if (
    createsReview &&
    (!request.course_code ||
      !request.course_name ||
      !request.teacher_source_label)
  )
    return fail(c, "暂存评价无法绑定课程与任课教师", 409);
  if (request.teacher_source_label)
    statements.push(
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO teachers(source_teacher_label,name,department)
         SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM catalog_requests WHERE id=? AND status='pending')`,
      ).bind(
        request.teacher_source_label,
        request.teacher_name || request.teacher_source_label,
        nullableClean(request.department, 80),
        id,
      ),
    );
  if (createsCourse && request.course_code && request.course_name)
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO courses(code,name,category,department)
         SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM catalog_requests WHERE id=? AND status='pending')
         ON CONFLICT(code) DO UPDATE SET name=excluded.name`,
      ).bind(
        request.course_code,
        request.course_name,
        request.category,
        request.department,
        id,
      ),
    );
  if (createsCourse && request.course_code && request.teacher_source_label)
    statements.push(
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO course_teachers(course_id,teacher_id)
         SELECT c.id,t.id FROM courses c,teachers t
         WHERE c.code=? AND t.source_teacher_label=?
           AND EXISTS(SELECT 1 FROM catalog_requests WHERE id=? AND status='pending')`,
      ).bind(request.course_code, request.teacher_source_label, id),
    );
  if (createsReview) {
    const stashed = parseStashedReview(request.pending_review_json);
    if (!stashed) return fail(c, "暂存评价数据无效", 409);
    const existingCourse = request.course_code
      ? await loadCourseSchemeInput(c.env.DB, request.course_code)
      : null;
    const snapshot = snapshotReviewScores({
      schemeKey: existingCourse?.scheme_key,
      category: existingCourse?.category ?? request.category,
      tags: parseTagCsv(existingCourse?.tag_csv),
      scores: stashed.scores,
      comment: stashed.comment,
    });
    if (!snapshot.ok) return fail(c, "暂存评价数据无效", 409);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO reviews(
           course_id,teacher_id,category,overall,comment,comment_format,
           term,submitter_hash,author_user_id,scheme_key,scheme_version,scores,
           status,reviewed_at
         )
         SELECT c.id,t.id,c.category,?,?,?,?,?,?,?,?,?,'approved',CURRENT_TIMESTAMP
         FROM courses c,teachers t
         WHERE c.code=? AND t.source_teacher_label=?
           AND EXISTS(SELECT 1 FROM catalog_requests WHERE id=? AND status='pending')`,
      ).bind(
        stashed.overall,
        snapshot.comment,
        snapshot.commentFormat,
        "",
        request.submitter_hash,
        request.author_user_id,
        snapshot.schemeKey,
        snapshot.schemeVersion,
        snapshot.scoresJson,
        request.course_code,
        request.teacher_source_label,
        id,
      ),
    );
  }
  const updateIndex = statements.length;
  statements.push(
    c.env.DB.prepare(
      `UPDATE catalog_requests SET status='approved',moderator_note=?,reviewed_at=CURRENT_TIMESTAMP,
         created_course_id=CASE WHEN ?='course' THEN (SELECT id FROM courses WHERE code=?) ELSE NULL END,
         created_teacher_id=(SELECT id FROM teachers WHERE source_teacher_label=?),
         created_review_id=${createsReview ? "last_insert_rowid()" : "NULL"}
       WHERE id=? AND status='pending'`,
    ).bind(
      note,
      request.kind,
      request.course_code,
      request.teacher_source_label,
      id,
    ),
  );
  statements.push(
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO catalog_request_moderation_events(
         catalog_request_id,action,note,actor_session_id
       )
       SELECT ?,?,?,? WHERE EXISTS(
         SELECT 1 FROM catalog_requests WHERE id=? AND status='approved'
       ) AND NOT EXISTS(
         SELECT 1 FROM catalog_request_moderation_events
         WHERE catalog_request_id=?
       )`,
    ).bind(id, status, note, c.get("adminSessionId"), id, id),
  );
  const results = await c.env.DB.batch(statements);
  if (!(results[updateIndex].meta.changes || 0))
    return fail(c, "该申请已审核，不能重复处理", 409);
  const approved = await c.env.DB.prepare(
    "SELECT created_course_id courseId,created_teacher_id teacherId,created_review_id reviewId FROM catalog_requests WHERE id=?",
  )
    .bind(id)
    .first<{
      courseId: number | null;
      teacherId: number | null;
      reviewId: number | null;
    }>();
  markPublicCatalogCacheChanged(c);
  // 补充申请批准连带暂存评价公开：后台去抖重算该关系总结（#401）。
  if (approved?.reviewId)
    await scheduleRelationSummaryRecompute(
      c,
      approved.courseId,
      approved.teacherId,
    );
  return c.json({ ok: true, ...approved });
});
adminRoutes.get("/api/admin/catalog-requests/:id/events", async (c) => {
  const id = integer(c.req.param("id"));
  if (
    !(await c.env.DB.prepare("SELECT 1 FROM catalog_requests WHERE id=?")
      .bind(id)
      .first())
  )
    return fail(c, "补充申请不存在", 404);
  return c.json(
    (
      await c.env.DB.prepare(
        `SELECT id,action,note,created_at
         FROM catalog_request_moderation_events
         WHERE catalog_request_id=?
         ORDER BY created_at DESC,id DESC`,
      )
        .bind(id)
        .all()
    ).results,
  );
});
adminRoutes.patch("/api/admin/reviews/:id", async (c) => {
  const parsedBody = moderationSchema.safeParse(await c.req.json<unknown>());
  if (!parsedBody.success) return fail(c, "无效状态");
  const { status, note } = parsedBody.data;
  const id = integer(c.req.param("id"));
  if (!id) return fail(c, "评价 ID 无效");
  if (!["approved", "rejected"].includes(status)) return fail(c, "无效状态");
  if (status === "rejected" && !note) return fail(c, "驳回时必须填写理由");
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE reviews
       SET status=?,moderator_note=?,reviewed_at=CURRENT_TIMESTAMP
       WHERE id=? AND status='pending'
       RETURNING id`,
    ).bind(status, note, id),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO review_moderation_events(review_id,action,note)
       SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM reviews WHERE id=? AND status=?)
       AND NOT EXISTS(
         SELECT 1 FROM review_moderation_events
         WHERE review_id=? AND action IN('approved','rejected')
       )`,
    ).bind(id, status, note, id, status, id),
  ]);
  if (!results[0].results.length) {
    const exists = await c.env.DB.prepare("SELECT 1 FROM reviews WHERE id=?")
      .bind(id)
      .first();
    return exists ? fail(c, "评价已经审核", 409) : fail(c, "评价不存在", 404);
  }
  if (status === "approved") markPublicCatalogCacheChanged(c);
  // 批准引入新公开文字（去抖重算）；驳回则按新集合立刻重算（#401）。
  const moderated = await c.env.DB.prepare(
    "SELECT course_id,teacher_id FROM reviews WHERE id=?",
  )
    .bind(id)
    .first<{ course_id: number; teacher_id: number | null }>();
  await scheduleRelationSummaryRecompute(
    c,
    moderated?.course_id,
    moderated?.teacher_id,
    {
      immediate: status === "rejected",
    },
  );
  return c.json({ ok: true });
});
adminRoutes.patch("/api/admin/reviews/:id/content", async (c) => {
  const b = await c.req.json<Record<string, unknown>>(),
    id = integer(c.req.param("id"));
  const current = await c.env.DB.prepare(
    "SELECT id,status,course_id,teacher_id FROM reviews WHERE id=?",
  )
    .bind(id)
    .first<{
      id: number;
      status: string;
      course_id: number;
      teacher_id: number | null;
    }>();
  if (!current) return fail(c, "评价不存在", 404);
  const scoreFields = [
    ["clarity", "clarity"],
    ["knowledge", "knowledge"],
    ["gradingScore", "grading_score"],
    ["workloadScore", "workload_score"],
    ["fairness", "fairness"],
  ] as const;
  const rawScores = scoreFields.map(([field]) => b[field]);
  const scores = rawScores.map((value) =>
    value === undefined ? null : rating(value),
  );
  if (
    rawScores.some(
      (value, index) =>
        value !== undefined && value !== "" && value != null && !scores[index],
    )
  )
    return fail(c, "评分必须在 1 到 5 之间");
  const updates: string[] = [];
  const values: unknown[] = [];
  // 补充说明走与投稿同一套白名单消毒，并重写格式标记（issue #400）。
  if (Object.hasOwn(b, "comment")) {
    const note = sanitizeReviewNoteValue(
      clean(b.comment, REVIEW_NOTE_HTML_MAX_LENGTH),
    );
    updates.push("comment=?", "comment_format=?");
    values.push(note.comment, note.commentFormat);
  }
  const textFields = [
    ["teaching", "teaching", 600],
    ["attendance", "attendance", 120],
    ["grading", "grading", 120],
    ["workload", "workload", 120],
    ["assessment", "assessment", 200],
  ] as const;
  for (const [field, column, max] of textFields) {
    if (Object.hasOwn(b, field)) {
      updates.push(`${column}=?`);
      values.push(clean(b[field], max));
    }
  }
  scoreFields.forEach(([field, column], index) => {
    if (rawScores[index] !== undefined) {
      updates.push(`${column}=?`);
      values.push(scores[index]);
    }
  });
  updates.push(
    "rescue=''",
    "interest=NULL",
    "practicality=NULL",
    "organization=NULL",
  );
  const update = c.env.DB.prepare(
    `UPDATE reviews SET ${updates.join(",")} WHERE id=? RETURNING id`,
  ).bind(...values, id);
  const event = c.env.DB.prepare(
    `INSERT INTO review_moderation_events(review_id,action,note)
     SELECT ?,'edited',? WHERE EXISTS(SELECT 1 FROM reviews WHERE id=?)`,
  ).bind(id, clean(b.note, 500), id);
  const results = await c.env.DB.batch([update, event]);
  if (!results[0].results.length) return fail(c, "评价不存在", 404);
  if (current.status === "approved") {
    markPublicCatalogCacheChanged(c);
    // 已公开评价正文被修改：后台去抖重算该关系总结（#401）。
    await scheduleRelationSummaryRecompute(
      c,
      current.course_id,
      current.teacher_id,
    );
  }
  return c.json({ ok: true });
});
adminRoutes.post("/api/admin/reviews/:id/block", (c) =>
  mutateReviewVisibility(c, "blocked"),
);
adminRoutes.post("/api/admin/reviews/:id/unblock", (c) =>
  mutateReviewVisibility(c, "unblocked"),
);
adminRoutes.delete("/api/admin/reviews/:id", (c) =>
  mutateReviewVisibility(c, "deleted"),
);
adminRoutes.post("/api/admin/reviews/:id/author-lookup", async (c) => {
  const id = integer(c.req.param("id"));
  if (!id) return fail(c, "评价 ID 无效");
  const review = await c.env.DB.prepare(
    `SELECT r.id,r.status,r.blocked_at,r.deleted_at,r.submitter_hash,
       r.author_user_id,r.headline,r.comment,r.created_at,
       c.code course_code,c.name course_name,COALESCE(t.name,'') teacher_name,
       u.status author_status,u.created_at author_created_at
     FROM reviews r
     JOIN courses c ON c.id=r.course_id
     LEFT JOIN teachers t ON t.id=r.teacher_id
     LEFT JOIN users u ON u.id=r.author_user_id
     WHERE r.id=?`,
  )
    .bind(id)
    .first<{
      id: number;
      status: string;
      blocked_at: string | null;
      deleted_at: string | null;
      submitter_hash: string;
      author_user_id: string | null;
      headline: string;
      comment: string;
      created_at: string;
      course_code: string;
      course_name: string;
      teacher_name: string;
      author_status: string | null;
      author_created_at: string | null;
    }>();
  if (!review) return fail(c, "评价不存在", 404);
  const identities = review.author_user_id
    ? (
        await c.env.DB.prepare(
          `SELECT provider,issuer,subject,created_at
           FROM auth_identities WHERE user_id=? ORDER BY created_at,provider,issuer`,
        )
          .bind(review.author_user_id)
          .all<ReviewAuthorIdentity>()
      ).results
    : [];
  const audit = await c.env.DB.prepare(
    `INSERT INTO review_moderation_events(review_id,action,note,actor_session_id)
     VALUES(?,'author_lookup','requested',?)`,
  )
    .bind(id, c.get("adminSessionId"))
    .run();
  const auditId = Number(audit.meta.last_row_id);
  const delivery = await deliverReviewAuthorLookup(c.env, {
    reviewId: review.id,
    courseCode: review.course_code,
    courseName: review.course_name,
    teacherName: review.teacher_name,
    headline: review.headline,
    comment: review.comment,
    reviewCreatedAt: review.created_at,
    reviewStatus: review.status,
    blockedAt: review.blocked_at,
    deletedAt: review.deleted_at,
    submitterHash: review.submitter_hash,
    authorUserId: review.author_user_id,
    authorStatus: review.author_status,
    authorCreatedAt: review.author_created_at,
    identities,
    requestedBySessionId: c.get("adminSessionId")!,
  });
  await c.env.DB.prepare(
    "UPDATE review_moderation_events SET note=? WHERE id=? AND review_id=?",
  )
    .bind(delivery, auditId, id)
    .run();
  if (delivery === "unconfigured")
    return fail(c, "管理员邮箱投递尚未配置", 503);
  if (delivery === "failed") return fail(c, "管理员邮箱投递失败", 502);
  return c.json({ ok: true, delivered: true });
});
adminRoutes.get("/api/admin/reviews/:id/events", async (c) => {
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
adminRoutes.get("/api/admin/legacy-reviews", async (c) => {
  const { page, size } = pageArgs(c),
    status = clean(c.req.query("status"), 20) || "pending",
    batchId = clean(c.req.query("batchId"), 80),
    searchGroup = andSearchTerms(
      parseSearchTerms(clean(c.req.query("q"), 100)),
      `${likeSql("lr.comment")} OR ${likeSql("lr.raw_ocr_text")} OR ${likeSql("lr.ocr_course_name")} OR ${likeSql("lr.ocr_teacher_name")} OR ${likeSql("lr.source_file")} OR ${likeSql("lr.term")} OR ${likeSql("c.name")} OR ${likeSql("c.code")} OR ${likeSql("t.name")}`,
    );
  if (!["pending", "approved", "rejected", "all"].includes(status))
    return fail(c, "无效历史审核状态");
  const searchFilter = searchGroup.sql ? ` AND ${searchGroup.sql}` : "";
  const where = `(?='all' OR lr.status=?) AND (?='' OR lr.import_batch_id=?)${searchFilter}`;
  const values = [status, status, batchId, batchId, ...searchGroup.args];
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM legacy_reviews lr LEFT JOIN courses c ON c.id=lr.course_id LEFT JOIN teachers t ON t.id=lr.teacher_id WHERE ${where}`,
  )
    .bind(...values)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT lr.id,lr.import_batch_id,lr.source_file,lr.sheet_name,lr.source_row,lr.raw_ocr_text,
      lr.ocr_confidence,lr.inherited_from,lr.ocr_course_name,lr.course_id,lr.ocr_teacher_name,
      lr.teacher_id,lr.offering_id,lr.category,lr.comment,lr.term,lr.source_type,lr.source_label,
      lr.status,lr.duplicate_group,lr.duplicate_action,lr.review_note,
      lr.moderator_note,lr.created_at,lr.reviewed_at,
      c.name course_name,c.code,t.name teacher_name
     FROM legacy_reviews lr LEFT JOIN courses c ON c.id=lr.course_id LEFT JOIN teachers t ON t.id=lr.teacher_id
     WHERE ${where} ORDER BY lr.created_at DESC,lr.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...values, size, (page - 1) * size)
    .all();
  return c.json({
    items: results,
    total: total?.n || 0,
    page,
    pages: Math.max(1, Math.ceil((total?.n || 0) / size)),
  });
});
adminRoutes.get("/api/admin/legacy-reviews/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const review = await c.env.DB.prepare(
    `SELECT lr.*,c.name course_name,c.code,t.name teacher_name,o.section offering_section
     FROM legacy_reviews lr LEFT JOIN courses c ON c.id=lr.course_id LEFT JOIN teachers t ON t.id=lr.teacher_id
     LEFT JOIN offerings o ON o.id=lr.offering_id WHERE lr.id=?`,
  )
    .bind(id)
    .first();
  if (!review) return fail(c, "历史评价不存在", 404);
  return c.json(review);
});
adminRoutes.patch("/api/admin/legacy-reviews/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const parsedBody = moderationSchema.safeParse(await c.req.json<unknown>());
  if (!parsedBody.success) return fail(c, "无效状态");
  const { status, note } = parsedBody.data;
  if (!["approved", "rejected"].includes(status)) return fail(c, "无效状态");
  if (status === "rejected" && !note) return fail(c, "驳回时必须填写理由");
  const current = await c.env.DB.prepare(
    "SELECT status,course_id,teacher_id FROM legacy_reviews WHERE id=?",
  )
    .bind(id)
    .first<{
      status: string;
      course_id: number | null;
      teacher_id: number | null;
    }>();
  if (!current) return fail(c, "历史评价不存在", 404);
  if (current.status !== "pending") return fail(c, "历史评价已经审核", 409);
  const approvalBindingGuard =
    status === "approved"
      ? ` AND EXISTS(
         SELECT 1 FROM legacy_reviews candidate
         JOIN courses course
           ON course.id=candidate.course_id AND course.category=candidate.category
         JOIN teachers teacher ON teacher.id=candidate.teacher_id
         JOIN course_teachers relation
           ON relation.course_id=candidate.course_id
          AND relation.teacher_id=candidate.teacher_id
         WHERE candidate.id=legacy_reviews.id
           AND (
             candidate.offering_id IS NULL OR EXISTS(
               SELECT 1 FROM offerings offering
               JOIN offering_teachers assigned
                 ON assigned.offering_id=offering.id
                AND assigned.teacher_id=candidate.teacher_id
               WHERE offering.id=candidate.offering_id
                 AND offering.course_id=candidate.course_id
                 AND trim(offering.term)=trim(candidate.term)
             )
           )
       )`
      : "";
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE legacy_reviews
       SET status=?,moderator_note=?,reviewed_at=CURRENT_TIMESTAMP
       WHERE id=? AND status='pending'${approvalBindingGuard}
       RETURNING id`,
    ).bind(status, note, id),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO legacy_review_moderation_events(legacy_review_id,action,note,actor_session_id)
       SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM legacy_reviews WHERE id=? AND status=?)`,
    ).bind(id, status, note, c.get("adminSessionId"), id, status),
  ]);
  if (!results[0].results.length)
    return fail(c, "历史评价绑定已经失效，或评价已经审核", 409);
  if (status === "approved") markPublicCatalogCacheChanged(c);
  // 历史评价批准引入公开文字（去抖）；驳回立刻按新集合重算（#401）。
  await scheduleRelationSummaryRecompute(
    c,
    current.course_id,
    current.teacher_id,
    {
      immediate: status === "rejected",
    },
  );
  return c.json({ ok: true, id, status });
});
adminRoutes.get("/api/admin/legacy-reviews/:id/events", async (c) => {
  const id = integer(c.req.param("id"));
  if (
    !(await c.env.DB.prepare("SELECT 1 FROM legacy_reviews WHERE id=?")
      .bind(id)
      .first())
  )
    return fail(c, "历史评价不存在", 404);
  const { results } = await c.env.DB.prepare(
    "SELECT id,action,note,created_at FROM legacy_review_moderation_events WHERE legacy_review_id=? ORDER BY created_at DESC,id DESC",
  )
    .bind(id)
    .all();
  return c.json(results);
});
adminRoutes.get("/api/admin/offerings", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        `SELECT o.*,c.name course_name,c.code,GROUP_CONCAT(t.id) teacher_ids,GROUP_CONCAT(t.name) teachers FROM offerings o JOIN courses c ON c.id=o.course_id LEFT JOIN offering_teachers ot ON ot.offering_id=o.id LEFT JOIN teachers t ON t.id=ot.teacher_id GROUP BY o.id ORDER BY o.term DESC,c.name,o.section`,
      ).all()
    ).results,
  ),
);
adminRoutes.post("/api/admin/offerings", async (c) => {
  const parsedBody = adminOfferingSchema.safeParse(await c.req.json<unknown>());
  if (!parsedBody.success) return fail(c, "任课教师列表无效");
  const b = parsedBody.data;
  const courseId = b.courseId,
    term = b.term,
    section = b.section,
    status = b.status || "active",
    teacherIds = b.teacherIds;
  if (
    !courseId ||
    !term ||
    !section ||
    !["active", "archived"].includes(status)
  )
    return fail(c, "课程、学期、班次和状态无效");
  if (!teacherIds.length) return fail(c, "请至少选择一位任课教师");
  const courseExists = await c.env.DB.prepare(
    "SELECT id FROM courses WHERE id=?",
  )
    .bind(courseId)
    .first();
  if (!courseExists) return fail(c, "课程不存在", 400);
  const validTeachers = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM teachers WHERE id IN (${teacherIds.map(() => "?").join(",")})`,
  )
    .bind(...teacherIds)
    .first<{ n: number }>();
  if (validTeachers?.n !== teacherIds.length)
    return fail(c, "任课教师中存在无效记录");
  const relatedTeachers = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM course_teachers
     WHERE course_id=? AND teacher_id IN (${teacherIds.map(() => "?").join(",")})`,
  )
    .bind(courseId, ...teacherIds)
    .first<{ n: number }>();
  if (relatedTeachers?.n !== teacherIds.length)
    return fail(c, "任课教师不属于该课程");
  let offeringId = b.id;
  const statements: D1PreparedStatement[] = [];
  if (offeringId) {
    const existing = await c.env.DB.prepare(
      "SELECT course_id,term,section FROM offerings WHERE id=?",
    )
      .bind(offeringId)
      .first<{ course_id: number; term: string; section: string }>();
    if (!existing) return fail(c, "开课班不存在", 404);
    const used = await c.env.DB.prepare(
      `SELECT 1 used FROM reviews WHERE offering_id=?
       UNION ALL
       SELECT 1 FROM legacy_reviews
       WHERE offering_id=? AND status IN('pending','approved')
       LIMIT 1`,
    )
      .bind(offeringId, offeringId)
      .first();
    if (
      used &&
      (existing.course_id !== courseId ||
        existing.term !== term ||
        existing.section !== section)
    )
      return fail(c, "已有评价的开课班不能修改课程、学期或班次", 409);
    const removedReviewedTeacher = await c.env.DB.prepare(
      `SELECT 1 FROM reviews
       WHERE offering_id=? AND teacher_id IS NOT NULL
         AND teacher_id NOT IN (${teacherIds.map(() => "?").join(",")})
       UNION ALL
       SELECT 1 FROM legacy_reviews
       WHERE offering_id=? AND status IN('pending','approved')
         AND teacher_id IS NOT NULL
         AND teacher_id NOT IN (${teacherIds.map(() => "?").join(",")})
       LIMIT 1`,
    )
      .bind(offeringId, ...teacherIds, offeringId, ...teacherIds)
      .first();
    if (removedReviewedTeacher)
      return fail(c, "已有评价的教师不能从开课班移除", 409);
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
adminRoutes.delete("/api/admin/offerings/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const used = await c.env.DB.prepare(
    `SELECT id FROM reviews WHERE offering_id=?
     UNION ALL
     SELECT id FROM legacy_reviews
     WHERE offering_id=? AND status IN('pending','approved')
     LIMIT 1`,
  )
    .bind(id, id)
    .first();
  if (used) return fail(c, "已有评价的开课班不能删除", 409);
  await c.env.DB.prepare("DELETE FROM offerings WHERE id=?").bind(id).run();
  return c.json({ ok: true });
});
adminRoutes.get("/api/admin/courses", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.*,
       (SELECT GROUP_CONCAT(tag) FROM course_tags WHERE course_id=c.id) tag_csv,
       GROUP_CONCAT(t.id) teacher_ids,GROUP_CONCAT(t.name) teachers
     FROM courses c
     LEFT JOIN course_teachers ct ON ct.course_id=c.id
     LEFT JOIN teachers t ON t.id=ct.teacher_id
     GROUP BY c.id ORDER BY c.name`,
  ).all();
  return c.json(
    results.map((row) => {
      const { tag_csv: tagCsv, ...rest } = row as Record<string, unknown>;
      return { ...rest, tags: parseTagCsv(tagCsv) };
    }),
  );
});
adminRoutes.post("/api/admin/courses", async (c) => {
  const rawBody = await c.req.json<unknown>();
  const parsedBody = adminCourseSchema.safeParse(rawBody);
  if (!parsedBody.success) return fail(c, "任课教师列表无效");
  const b = parsedBody.data;
  const name = b.name,
    code = b.code,
    category = b.category,
    department = b.department,
    description = b.description,
    teacherIdsProvided = b.teacherIds !== undefined;
  const scheme = parseAdminSchemeKey(b.schemeKey);
  if ("error" in scheme) return fail(c, scheme.error);
  const tags = parseAdminTags(b.tags);
  if ("error" in tags) return fail(c, tags.error);
  if (!code || !name || !["general", "sports"].includes(category))
    return fail(c, "课号、课程名称和类别无效");
  if (isExcludedCourseName(name)) return fail(c, "班会不纳入课程目录");
  let id = b.id;
  const existing = id
    ? await c.env.DB.prepare("SELECT * FROM courses WHERE id=?")
        .bind(id)
        .first<{
          code: string;
          category: string;
          credits: number | null;
          enrollment_category: string;
          teaching_type: string;
          course_level: string;
        }>()
    : null;
  if (id && !existing) return fail(c, "课程不存在", 404);
  const baselinePublished = !!(await c.env.DB.prepare(
    "SELECT 1 FROM catalog_baseline_marker WHERE singleton=1",
  ).first());
  if (baselinePublished && !id)
    return fail(c, "基线发布后新增课程必须通过目录补充申请", 409);
  if (existing && existing.code !== code)
    return fail(c, "课号是稳定身份，创建后不可修改", 409);
  let teacherIds: number[] | undefined;
  if (teacherIdsProvided) {
    teacherIds = b.teacherIds as number[];
    if (teacherIds.length) {
      const validTeachers = await c.env.DB.prepare(
        `SELECT COUNT(*) n FROM teachers WHERE id IN (${teacherIds
          .map(() => "?")
          .join(",")})`,
      )
        .bind(...teacherIds)
        .first<{ n: number }>();
      if (validTeachers?.n !== teacherIds.length)
        return fail(c, "任课教师中存在无效记录");
    }
  }
  const creditsProvided = Object.hasOwn(b, "credits");
  let credits = existing?.credits ?? null;
  if (creditsProvided) {
    if (b.credits === "" || b.credits == null) credits = null;
    else {
      credits = Number(b.credits);
      if (!Number.isFinite(credits) || credits < 0)
        return fail(c, "学分必须是非负数字");
    }
  }
  const planField = (
    key: "enrollmentCategory" | "teachingType" | "courseLevel",
    max: number,
  ) => {
    if (!Object.hasOwn(b, key)) return undefined;
    const value = b[key];
    if (value == null) return "";
    if (typeof value !== "string") return null;
    return clean(value, max);
  };
  const enrollmentCategory = planField("enrollmentCategory", 40);
  const teachingType = planField("teachingType", 40);
  const courseLevel = planField("courseLevel", 80);
  if (
    enrollmentCategory === null ||
    teachingType === null ||
    courseLevel === null
  )
    return fail(c, "选课类别、教学类型或课程层次无效");
  const nextEnrollment =
    enrollmentCategory ?? existing?.enrollment_category ?? "";
  const nextTeaching = teachingType ?? existing?.teaching_type ?? "";
  const nextLevel = courseLevel ?? existing?.course_level ?? "";
  if (id) {
    if (category !== existing!.category) {
      const legacyCategoryDependency = await c.env.DB.prepare(
        `SELECT 1 FROM legacy_reviews
         WHERE course_id=? AND status IN('pending','approved') LIMIT 1`,
      )
        .bind(id)
        .first();
      if (legacyCategoryDependency)
        return fail(c, "已有待审或已批准历史评价，不能修改课程类别", 409);
    }
    const currentRelations = (
      await c.env.DB.prepare(
        "SELECT teacher_id FROM course_teachers WHERE course_id=?",
      )
        .bind(id)
        .all<{ teacher_id: number }>()
    ).results.map((row) => row.teacher_id);
    if (teacherIdsProvided) {
      if (
        baselinePublished &&
        JSON.stringify([...teacherIds!].sort((left, right) => left - right)) !==
          JSON.stringify(
            [...currentRelations].sort((left, right) => left - right),
          )
      )
        return fail(c, "基线发布后新增任课关系必须通过目录补充申请", 409);
      const removed = currentRelations.filter(
        (teacherId) => !teacherIds!.includes(teacherId),
      );
      if (removed.length) {
        const placeholders = removed.map(() => "?").join(",");
        const reviewDependency = await c.env.DB.prepare(
          `SELECT 1 FROM reviews WHERE course_id=? AND teacher_id IN (${placeholders})
           UNION ALL
           SELECT 1 FROM legacy_reviews
           WHERE course_id=? AND status IN('pending','approved')
             AND teacher_id IN (${placeholders})
           LIMIT 1`,
        )
          .bind(id, ...removed, id, ...removed)
          .first();
        const offeringDependency = await c.env.DB.prepare(
          `SELECT 1 FROM offerings o JOIN offering_teachers ot ON ot.offering_id=o.id
           WHERE o.course_id=? AND ot.teacher_id IN (${placeholders}) LIMIT 1`,
        )
          .bind(id, ...removed)
          .first();
        if (reviewDependency || offeringDependency)
          return fail(c, "已有评价或开课班依赖该任课关系，不能删除", 409);
      }
    }
    const statements: D1PreparedStatement[] = [
      scheme.provided
        ? c.env.DB.prepare(
            "UPDATE courses SET code=?,name=?,category=?,department=?,credits=?,description=?,enrollment_category=?,teaching_type=?,course_level=?,scheme_key=? WHERE id=?",
          ).bind(
            code,
            name,
            category,
            department,
            credits,
            description,
            nextEnrollment,
            nextTeaching,
            nextLevel,
            scheme.value,
            id,
          )
        : c.env.DB.prepare(
            "UPDATE courses SET code=?,name=?,category=?,department=?,credits=?,description=?,enrollment_category=?,teaching_type=?,course_level=? WHERE id=?",
          ).bind(
            code,
            name,
            category,
            department,
            credits,
            description,
            nextEnrollment,
            nextTeaching,
            nextLevel,
            id,
          ),
    ];
    if (teacherIdsProvided) {
      statements.push(
        c.env.DB.prepare("DELETE FROM course_teachers WHERE course_id=?").bind(
          id,
        ),
        ...teacherIds!.map((teacherId) =>
          c.env.DB.prepare(
            "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
          ).bind(id, teacherId),
        ),
      );
    }
    if (tags.provided) {
      statements.push(
        c.env.DB.prepare("DELETE FROM course_tags WHERE course_id=?").bind(id),
        ...tags.value.map((tag) =>
          c.env.DB.prepare(
            "INSERT INTO course_tags(course_id,tag) VALUES(?,?)",
          ).bind(id, tag),
        ),
      );
    }
    await c.env.DB.batch(statements);
  } else {
    const statements: D1PreparedStatement[] = [
      scheme.provided
        ? c.env.DB.prepare(
            "INSERT INTO courses(code,name,category,department,credits,description,enrollment_category,teaching_type,course_level,scheme_key) VALUES(?,?,?,?,?,?,?,?,?,?)",
          ).bind(
            code,
            name,
            category,
            department,
            credits,
            description,
            nextEnrollment,
            nextTeaching,
            nextLevel,
            scheme.value,
          )
        : c.env.DB.prepare(
            "INSERT INTO courses(code,name,category,department,credits,description,enrollment_category,teaching_type,course_level) VALUES(?,?,?,?,?,?,?,?,?)",
          ).bind(
            code,
            name,
            category,
            department,
            credits,
            description,
            nextEnrollment,
            nextTeaching,
            nextLevel,
          ),
    ];
    if (teacherIds?.length) {
      statements.push(
        ...teacherIds.map((teacherId) =>
          c.env.DB.prepare(
            `INSERT INTO course_teachers(course_id,teacher_id)
             SELECT id,? FROM courses WHERE code=? AND name=?`,
          ).bind(teacherId, code, name),
        ),
      );
    }
    const results = await c.env.DB.batch(statements);
    id = Number(results[0].meta.last_row_id);
    if (tags.provided) {
      await c.env.DB.batch([
        c.env.DB.prepare("DELETE FROM course_tags WHERE course_id=?").bind(id),
        ...tags.value.map((tag) =>
          c.env.DB.prepare(
            "INSERT INTO course_tags(course_id,tag) VALUES(?,?)",
          ).bind(id, tag),
        ),
      ]);
    }
  }
  return c.json({ ok: true, id });
});
adminRoutes.put("/api/admin/courses/:id/notice", async (c) => {
  const courseId = integer(c.req.param("id"));
  if (!courseId) return fail(c, "课程 ID 无效");
  const parsedBody = adminCourseNoticeSchema.safeParse(
    await c.req.json<unknown>(),
  );
  if (!parsedBody.success) return fail(c, "管理员公告必须是 2000 字以内的文本");
  const updated = await c.env.DB.prepare(
    `UPDATE courses
     SET admin_notice=?,admin_notice_updated_at=CURRENT_TIMESTAMP
     WHERE id=?
     RETURNING admin_notice content,admin_notice_updated_at updatedAt`,
  )
    .bind(parsedBody.data.content, courseId)
    .first<{ content: string; updatedAt: string }>();
  if (!updated) return fail(c, "课程不存在", 404);
  markPublicCatalogCacheChanged(c);
  return c.json({ ok: true, ...updated });
});
adminRoutes.delete("/api/admin/courses/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const used = await c.env.DB.prepare(
    "SELECT id FROM reviews WHERE course_id=? LIMIT 1",
  )
    .bind(id)
    .first();
  if (used) return fail(c, "已有评价的课程不能删除", 409);
  const legacyUsed = await c.env.DB.prepare(
    "SELECT id FROM legacy_reviews WHERE course_id=? AND status IN('pending','approved') LIMIT 1",
  )
    .bind(id)
    .first();
  if (legacyUsed) return fail(c, "已有审核通过的历史评价，不能删除", 409);
  const catalogReference = await c.env.DB.prepare(
    "SELECT id FROM catalog_requests WHERE created_course_id=? LIMIT 1",
  )
    .bind(id)
    .first();
  if (catalogReference)
    return fail(c, "已有补充申请记录引用该课程，不能删除", 409);
  await c.env.DB.prepare("DELETE FROM courses WHERE id=?").bind(id).run();
  return c.json({ ok: true });
});
function parseOptionalFlag(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return undefined;
}

function parseAdminCtaHomepagePatch(body: {
  homepageUrl?: unknown;
  homepageLocked?: unknown;
  imageLocked?: unknown;
}): { error?: string; sql?: string; args?: unknown[] } {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (body.homepageUrl !== undefined) {
    const url =
      typeof body.homepageUrl === "string" ? body.homepageUrl.trim() : "";
    if (url && !isAllowedCtaHomepageUrl(url)) return { error: "官方主页链接无效" };
    if (!url) {
      sets.push(
        "homepage_url=NULL",
        "cta_fid=NULL",
        "cta_uid=NULL",
        "homepage_match='none'",
      );
    } else {
      const parsed = parseCtaHomepageUrl(url);
      if (!parsed) return { error: "官方主页链接无效" };
      sets.push(
        "homepage_url=?",
        "cta_fid=?",
        "cta_uid=?",
        "homepage_match='manual'",
      );
      args.push(ctaHomepageUrl(parsed.uid, parsed.fid), parsed.fid, parsed.uid);
    }
  }
  const homepageLocked = parseOptionalFlag(body.homepageLocked);
  if (homepageLocked !== undefined) {
    sets.push("homepage_locked=?");
    args.push(homepageLocked ? 1 : 0);
  }
  const imageLocked = parseOptionalFlag(body.imageLocked);
  if (imageLocked !== undefined) {
    sets.push("image_locked=?");
    args.push(imageLocked ? 1 : 0);
    if (imageLocked) sets.push("avatar_sha256=NULL");
  }
  if (!sets.length) return {};
  return {
    sql: `UPDATE teachers SET ${sets.join(",")} WHERE id=?`,
    args,
  };
}

adminRoutes.get("/api/admin/teachers", async (c) =>
  c.json(
    (await c.env.DB.prepare("SELECT * FROM teachers ORDER BY name").all())
      .results,
  ),
);
adminRoutes.post("/api/admin/teachers", async (c) => {
  const parsedBody = adminTeacherSchema.safeParse(await c.req.json<unknown>());
  if (!parsedBody.success) return fail(c, "来源教师名不能为空");
  const b = parsedBody.data,
    sourceTeacherLabel = b.sourceTeacherLabel,
    name = b.name || sourceTeacherLabel,
    department = nullableClean(b.department, 80);
  const existingId = b.id;
  if (
    !existingId &&
    (await c.env.DB.prepare(
      "SELECT 1 FROM catalog_baseline_marker WHERE singleton=1",
    ).first())
  )
    return fail(c, "基线发布后新增教师必须通过目录补充申请", 409);
  let id = existingId;
  if (existingId) {
    const existing = await c.env.DB.prepare(
      "SELECT source_teacher_label FROM teachers WHERE id=?",
    )
      .bind(existingId)
      .first<{ source_teacher_label: string }>();
    if (!existing) return fail(c, "教师不存在", 404);
    if (
      sourceTeacherLabel &&
      sourceTeacherLabel !== existing.source_teacher_label
    )
      return fail(c, "来源教师名是稳定身份，创建后不可修改", 409);
    if (!name) return fail(c, "教师显示名不能为空");
    await c.env.DB.prepare(
      "UPDATE teachers SET name=?,department=?,title=?,bio=? WHERE id=?",
    )
      .bind(
        name,
        department,
        clean(b.title, 80),
        clean(b.bio, 1000),
        existingId,
      )
      .run();
    const homepagePatch = parseAdminCtaHomepagePatch(b);
    if (homepagePatch.error) return fail(c, homepagePatch.error);
    if (homepagePatch.sql) {
      await c.env.DB.prepare(homepagePatch.sql)
        .bind(...(homepagePatch.args ?? []), existingId)
        .run();
    }
  } else {
    if (!sourceTeacherLabel || !name) return fail(c, "来源教师名不能为空");
    const result = await c.env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department,title,bio) VALUES(?,?,?,?,?)",
    )
      .bind(
        sourceTeacherLabel,
        name,
        department,
        clean(b.title, 80),
        clean(b.bio, 1000),
      )
      .run();
    id = Number(result.meta.last_row_id);
  }
  if (parseOptionalFlag(b.imageLocked) === true && id) {
    await c.env.DB.prepare("DELETE FROM teacher_avatars WHERE teacher_id=?")
      .bind(id)
      .run();
  }
  return c.json({ ok: true, id });
});
adminRoutes.post("/api/admin/cta-sync", async (c) => {
  const parsedBody = adminCtaSyncSchema.safeParse(
    (await c.req.json<unknown>().catch(() => ({}))) ?? {},
  );
  if (!parsedBody.success) return fail(c, "同步参数无效");
  const teacherId = parsedBody.data.teacherId;
  const limit = parsedBody.data.limit;
  try {
    const items = await syncTeacherCtaHomepageBatch(
      c.env.DB,
      {
        teacherId: teacherId ?? undefined,
        limit: limit ?? undefined,
      },
      createHttpCtaClient(),
    );
    markPublicCatalogCacheChanged(c);
    return c.json({ ok: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步失败";
    if (message === "教师不存在") return fail(c, message, 404);
    return fail(c, "同步失败", 502);
  }
});
adminRoutes.delete("/api/admin/teachers/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const used = await c.env.DB.prepare(
    "SELECT id FROM reviews WHERE teacher_id=? LIMIT 1",
  )
    .bind(id)
    .first();
  if (used) return fail(c, "已有评价的教师不能删除", 409);
  const legacyUsed = await c.env.DB.prepare(
    "SELECT id FROM legacy_reviews WHERE teacher_id=? AND status IN('pending','approved') LIMIT 1",
  )
    .bind(id)
    .first();
  if (legacyUsed) return fail(c, "已有审核通过的历史评价，不能删除", 409);
  const catalogReference = await c.env.DB.prepare(
    "SELECT id FROM catalog_requests WHERE created_teacher_id=? LIMIT 1",
  )
    .bind(id)
    .first();
  if (catalogReference)
    return fail(c, "已有补充申请记录引用该教师，不能删除", 409);
  const soleActiveOffering = await c.env.DB.prepare(
    `SELECT 1
     FROM offerings o JOIN offering_teachers ot ON ot.offering_id=o.id
     WHERE o.status='active' AND ot.teacher_id=?
       AND (SELECT COUNT(*) FROM offering_teachers other WHERE other.offering_id=o.id)=1
     LIMIT 1`,
  )
    .bind(id)
    .first();
  if (soleActiveOffering)
    return fail(c, "该教师是开课班唯一任课教师，不能删除", 409);
  await c.env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(id).run();
  return c.json({ ok: true });
});
adminRoutes.put("/api/admin/courses/:id/teachers", async (c) => {
  if (
    await c.env.DB.prepare(
      "SELECT 1 FROM catalog_baseline_marker WHERE singleton=1",
    ).first()
  )
    return fail(c, "基线发布后变更任课关系必须通过目录补充申请", 409);
  const courseId = integer(c.req.param("id"));
  if (!courseId) return fail(c, "课程 ID 无效");
  const parsedBody = teacherIdsSchema.safeParse(await c.req.json<unknown>());
  if (!parsedBody.success) return fail(c, "任课教师列表无效");
  const ids = parsedBody.data.teacherIds;
  if (
    !(await c.env.DB.prepare("SELECT id FROM courses WHERE id=?")
      .bind(courseId)
      .first())
  )
    return fail(c, "课程不存在", 404);
  if (ids.length) {
    const validTeachers = await c.env.DB.prepare(
      `SELECT COUNT(*) n FROM teachers WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .first<{ n: number }>();
    if (validTeachers?.n !== ids.length)
      return fail(c, "任课教师中存在无效记录");
  }
  const currentIds = (
    await c.env.DB.prepare(
      "SELECT teacher_id FROM course_teachers WHERE course_id=?",
    )
      .bind(courseId)
      .all<{ teacher_id: number }>()
  ).results.map((row) => row.teacher_id);
  const removed = currentIds.filter((teacherId) => !ids.includes(teacherId));
  if (removed.length) {
    const placeholders = removed.map(() => "?").join(",");
    const reviewDependency = await c.env.DB.prepare(
      `SELECT 1 FROM reviews WHERE course_id=? AND teacher_id IN (${placeholders})
       UNION ALL
       SELECT 1 FROM legacy_reviews
       WHERE course_id=? AND status IN('pending','approved')
         AND teacher_id IN (${placeholders})
       LIMIT 1`,
    )
      .bind(courseId, ...removed, courseId, ...removed)
      .first();
    const offeringDependency = await c.env.DB.prepare(
      `SELECT 1 FROM offerings o JOIN offering_teachers ot ON ot.offering_id=o.id
       WHERE o.course_id=? AND ot.teacher_id IN (${placeholders}) LIMIT 1`,
    )
      .bind(courseId, ...removed)
      .first();
    if (reviewDependency || offeringDependency)
      return fail(c, "已有评价或开课班依赖该任课关系，不能删除", 409);
  }
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
adminRoutes.get("/api/admin/summaries/qualifying", async (c) => {
  const items = await listQualifyingSummaryRelations(c.env.DB);
  return c.json({ ok: true, total: items.length, items });
});
adminRoutes.post("/api/admin/summaries/recompute", async (c) => {
  const parsedBody = summaryRecomputeSchema.safeParse(
    await c.req.json<unknown>(),
  );
  if (!parsedBody.success) return fail(c, "课程或教师 ID 无效");
  const courseId = parsedBody.data.courseId;
  const teacherId = parsedBody.data.teacherId;
  if (!courseId || !teacherId || courseId < 1 || teacherId < 1)
    return fail(c, "课程或教师 ID 无效");
  await scheduleRelationSummaryRecompute(c, courseId, teacherId, {
    immediate: true,
  });
  return c.json({ ok: true, courseId, teacherId, outcome: "queued" }, 202);
});
adminRoutes.get("/api/admin/student-bindings", async (c) =>
  c.json({ items: await listAdminStudentBindings(c.env.DB) }),
);
adminRoutes.post("/api/admin/student-bindings", async (c) => {
  const parsedBody = adminStudentBindingsSchema.safeParse(
    await c.req.json<unknown>(),
  );
  if (!parsedBody.success) return fail(c, "学号格式不正确");
  const parsed = parseBindingUsernames(parsedBody.data);
  if (!parsed.ok) return fail(c, parsed.error);
  const identitySecret = await readSecret(c.env.CAMPUS_IDENTITY_SECRET);
  if (!identitySecret) return fail(c, "身份密钥未配置", 503);
  const hashes = await Promise.all(
    parsed.usernames.map((username) => casSubjectHash(username, identitySecret)),
  );
  const result = await addAdminStudentBindings(c.env.DB, hashes);
  return c.json({ ok: true, added: result.added, skipped: result.skipped });
});
adminRoutes.delete("/api/admin/student-bindings/:id", async (c) => {
  const id = integer(c.req.param("id"));
  if (!id) return fail(c, "绑定不存在", 404);
  if (!(await deleteAdminStudentBinding(c.env.DB, id))) {
    return fail(c, "绑定不存在", 404);
  }
  return c.json({ ok: true });
});
adminRoutes.route("/", announcementRoutes);
export default adminRoutes;
