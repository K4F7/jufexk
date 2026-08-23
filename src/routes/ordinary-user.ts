import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { requireOrdinaryWriteUser } from "../ordinary-user-session";
import {
  handleCreateEndorsement,
  handleWithdrawEndorsement,
} from "../review-endorsements";
import {
  handleCreateFollow,
  handleCreateNotRecommend,
  handleCreateRecommend,
  handleWithdrawFollow,
  handleWithdrawNotRecommend,
  handleWithdrawRecommend,
} from "../relation-signals";
import { snapshotReviewScores } from "../lib/review-schemes";
import { isExcludedCourseName } from "../lib/course-catalog-policy";
import { readSecret, turnstileMode } from "../secrets";
import { scheduleRelationSummaryRecompute } from "../review-summary";
import type { AppContext } from "./types";
import {
  clean,
  digest,
  fail,
  integer,
  keyedDigest,
  loadCourseSchemeInput,
  markPublicCatalogCacheChanged,
  originOk,
  parseTagCsv,
  rating,
  skipTurnstile,
  takeRateLimit,
  withPublicCourseCategory,
  type StashedReview,
} from "./support";
import {
  attachedReviewSchema,
  catalogRequestSchema,
  reviewSubmissionSchema,
} from "./request-schemas";

const ordinaryUserRoutes = new Hono<AppEnv>();
ordinaryUserRoutes.put("/api/reviews/:id/endorsement", handleCreateEndorsement);
ordinaryUserRoutes.delete(
  "/api/reviews/:id/endorsement",
  handleWithdrawEndorsement,
);
ordinaryUserRoutes.put(
  "/api/courses/:id/teachers/:teacherId/follow",
  handleCreateFollow,
);
ordinaryUserRoutes.delete(
  "/api/courses/:id/teachers/:teacherId/follow",
  handleWithdrawFollow,
);
ordinaryUserRoutes.put(
  "/api/courses/:id/teachers/:teacherId/recommend",
  handleCreateRecommend,
);
ordinaryUserRoutes.delete(
  "/api/courses/:id/teachers/:teacherId/recommend",
  handleWithdrawRecommend,
);
ordinaryUserRoutes.put(
  "/api/courses/:id/teachers/:teacherId/not-recommend",
  handleCreateNotRecommend,
);
ordinaryUserRoutes.delete(
  "/api/courses/:id/teachers/:teacherId/not-recommend",
  handleWithdrawNotRecommend,
);

async function verifyTurnstile(c: AppContext, response: string, ip: string) {
  const secret = await readSecret(c.env.TURNSTILE_SECRET);
  if (skipTurnstile(secret)) return true;
  const mode = turnstileMode(c.env.TURNSTILE_SITE_KEY, secret);
  if (mode !== "enabled") return mode !== "secret-only";
  if (!response) return false;
  try {
    const body = new URLSearchParams({
      secret,
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
ordinaryUserRoutes.get("/api/offerings", async (c) => {
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
ordinaryUserRoutes.get("/api/offerings/:id", async (c) => {
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
  return c.json({ offering: withPublicCourseCategory(offering), teachers });
});
ordinaryUserRoutes.post("/api/reviews", async (c) => {
  const rawBody = await c.req.json<unknown>();
  const writer = await requireOrdinaryWriteUser(
    c,
    "请先登录后再投稿",
    "当前账号无法投稿",
  );
  if ("error" in writer) return writer.error;
  const parsedBody = reviewSubmissionSchema.safeParse(rawBody);
  if (!parsedBody.success)
    return fail(c, "请选择有效的课程、任课教师和总体评分");
  const b = parsedBody.data;
  if (b.website) return c.json({ ok: true });
  const captchaMode = turnstileMode(
    c.env.TURNSTILE_SITE_KEY,
    await readSecret(c.env.TURNSTILE_SECRET),
  );
  if (captchaMode === "secret-only") return fail(c, "人机验证配置异常", 503);
  if (!originOk(c)) return fail(c, "来源校验失败", 403);
  let courseId = b.courseId;
  const offeringId = b.offeringId.value,
    teacherId = b.teacherId,
    overall = b.overall,
    ip = c.req.header("CF-Connecting-IP") || "unknown",
    ipHash = await keyedDigest(ip, await readSecret(c.env.IP_HASH_SECRET));
  if (b.offeringId.supplied && (!offeringId || offeringId < 1))
    return fail(c, "开课班无效");
  if (!(await verifyTurnstile(c, b.turnstileToken, ip)))
    return fail(c, "人机验证失败，请重试", 403);
  if (!courseId || !teacherId || !overall)
    return fail(c, "请选择有效的课程、任课教师和总体评分");
  // 一句话总结必填（#444）；成绩选填，空串存 NULL，不进 AI 总结提示词。
  const headline = b.headline;
  if (!headline) return fail(c, "请填写一句话总结本课");
  if (headline.length > 80) return fail(c, "一句话总结不能超过 80 字");
  if (b.grade.length > 20) return fail(c, "成绩不能超过 20 字");
  const grade = b.grade || null;
  const course = offeringId
    ? await c.env.DB.prepare(
        `SELECT c.id course_id,c.category,c.scheme_key,
           (SELECT GROUP_CONCAT(tag) FROM course_tags WHERE course_id=c.id) tag_csv,
           o.term offering_term
         FROM offerings o JOIN courses c ON c.id=o.course_id
         JOIN offering_teachers ot ON ot.offering_id=o.id
         JOIN course_teachers ct
           ON ct.course_id=o.course_id AND ct.teacher_id=ot.teacher_id
         WHERE o.id=? AND o.course_id=? AND o.status='active' AND ot.teacher_id=? LIMIT 1`,
      )
        .bind(offeringId, courseId, teacherId)
        .first<{
          course_id: number;
          category: string;
          scheme_key: string | null;
          tag_csv: string | null;
          offering_term: string;
        }>()
    : await c.env.DB.prepare(
        `SELECT c.id course_id,c.category,c.scheme_key,
           (SELECT GROUP_CONCAT(tag) FROM course_tags WHERE course_id=c.id) tag_csv
         FROM courses c JOIN course_teachers ct ON ct.course_id=c.id
         WHERE c.id=? AND ct.teacher_id=? LIMIT 1`,
      )
        .bind(courseId, teacherId)
        .first<{
          course_id: number;
          category: string;
          scheme_key: string | null;
          tag_csv: string | null;
          offering_term?: string;
        }>();
  if (course) courseId = course.course_id;
  if (!course || !overall)
    return fail(c, "请选择有效的课程、任课教师和总体评分");
  const snapshot = snapshotReviewScores({
    schemeKey: course.scheme_key,
    category: course.category,
    tags: parseTagCsv(course.tag_csv),
    scores: b.scores,
    comment: b.comment,
  });
  if (!snapshot.ok) return fail(c, snapshot.error);
  if (!(await takeRateLimit(c.env.DB, `review-submit:${ipHash}`, 3600, 5)))
    return fail(c, "提交过于频繁，请稍后再试", 429);
  const term = offeringId ? clean(course.offering_term, 30) : b.term;
  const dedupeKey = await digest(
    `${courseId}|${teacherId}|${offeringId || 0}|${term}|${ipHash}`,
  );
  await c.env.DB.prepare(
    "DELETE FROM review_dedupe WHERE key=? AND created_at<datetime('now','-30 days')",
  )
    .bind(dedupeKey)
    .run();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO review_dedupe(key) VALUES(?)").bind(
        dedupeKey,
      ),
      c.env.DB.prepare(
        `INSERT INTO reviews(course_id,teacher_id,offering_id,category,overall,comment,comment_format,headline,grade,term,submitter_hash,scheme_key,scheme_version,scores,status,reviewed_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'approved',CURRENT_TIMESTAMP)`,
      ).bind(
        courseId,
        teacherId,
        offeringId,
        course.category,
        overall,
        snapshot.comment,
        snapshot.commentFormat,
        headline,
        grade,
        term,
        ipHash,
        snapshot.schemeKey,
        snapshot.schemeVersion,
        snapshot.scoresJson,
      ),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      return fail(c, "近期已提交过这位教师的同一课程评价", 409);
    throw error;
  }
  markPublicCatalogCacheChanged(c);
  // 新公开评价：后台重算该任课关系总结（24h 去抖）。
  await scheduleRelationSummaryRecompute(c, courseId, teacherId);
  return c.json({ ok: true, message: "评价已发布" });
});
ordinaryUserRoutes.post("/api/catalog-requests", async (c) => {
  const rawBody = await c.req.json<unknown>();
  const writer = await requireOrdinaryWriteUser(
    c,
    "请先登录后再申请补充",
    "当前账号无法申请补充",
  );
  if ("error" in writer) return writer.error;
  const parsedBody = catalogRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) return fail(c, "申请类型必须是 course 或 teacher");
  const b = parsedBody.data;
  if (b.website) return c.json({ ok: true });
  const captchaMode = turnstileMode(
    c.env.TURNSTILE_SITE_KEY,
    await readSecret(c.env.TURNSTILE_SECRET),
  );
  if (captchaMode === "secret-only") return fail(c, "人机验证配置异常", 503);
  if (!originOk(c)) return fail(c, "来源校验失败", 403);
  const kind = b.kind,
    courseCode = b.courseCode,
    courseName = b.courseName,
    category = b.category,
    teacherSourceLabel = b.teacherSourceLabel,
    department = b.department,
    ip = c.req.header("CF-Connecting-IP") || "unknown",
    ipHash = await keyedDigest(ip, await readSecret(c.env.IP_HASH_SECRET));
  if (!(await verifyTurnstile(c, b.turnstileToken, ip)))
    return fail(c, "人机验证失败，请重试", 403);
  if (!["course", "teacher"].includes(kind))
    return fail(c, "申请类型必须是 course 或 teacher");
  if (
    kind === "teacher" &&
    (courseCode || courseName || category || b.review != null)
  )
    return fail(c, "教师申请不得携带课程字段或随附评价");
  if (kind === "course" && (!courseCode || !courseName))
    return fail(c, "请填写课号和课程名称");
  if (kind === "course" && isExcludedCourseName(courseName))
    return fail(c, "班会不纳入课程目录");
  if (!teacherSourceLabel) return fail(c, "请填写来源教师名");
  if (kind === "course" && !category) return fail(c, "请选择评价模板类型");
  if (category && !["general", "sports"].includes(category))
    return fail(c, "评价模板类型必须为 general 或 sports");
  const rawReview = b.review;
  const parsedReview =
    rawReview == null ? null : attachedReviewSchema.safeParse(rawReview);
  if (parsedReview && !parsedReview.success) return fail(c, "随附评价格式无效");
  const review = parsedReview?.data ?? null;
  if (review && (!courseCode || !courseName || !teacherSourceLabel))
    return fail(c, "随附评价必须同时填写课程和教师，以便绑定任课关系");
  const overall = review ? review.overall : null;
  if (review && !overall) return fail(c, "随附评价必须包含 1 到 5 的总体评分");
  let stashedReview: StashedReview | null = null;
  if (review) {
    const existingCourse = courseCode
      ? await loadCourseSchemeInput(c.env.DB, courseCode)
      : null;
    const snapshot = snapshotReviewScores({
      schemeKey: existingCourse?.scheme_key,
      category: existingCourse?.category ?? category,
      tags: parseTagCsv(existingCourse?.tag_csv),
      scores: review.scores,
      comment: review.comment,
    });
    if (!snapshot.ok) return fail(c, snapshot.error);
    stashedReview = {
      scores: snapshot.scores,
      overall: overall as number,
      comment: snapshot.comment,
      term: review.term,
    };
  }
  if (!(await takeRateLimit(c.env.DB, `catalog-request:${ipHash}`, 3600, 5)))
    return fail(c, "提交过于频繁，请稍后再试", 429);
  const result = await c.env.DB.prepare(
    `INSERT INTO catalog_requests(kind,course_code,course_name,category,teacher_name,teacher_source_label,department,note,pending_review_json,submitter_hash)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      kind,
      courseCode,
      courseName,
      category,
      teacherSourceLabel,
      teacherSourceLabel,
      department,
      b.note,
      stashedReview ? JSON.stringify(stashedReview) : "",
      ipHash,
    )
    .run();
  return c.json({
    ok: true,
    id: Number(result.meta.last_row_id),
    message: "补充申请已提交，待管理员审核",
  });
});

export default ordinaryUserRoutes;
