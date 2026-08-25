import { escapeHtml } from "./html";
import { guestReviewBindingSql } from "./public-review-visibility";
import { readSecret, type SecretBinding } from "./secrets";

/**
 * 任课关系 AI 总结（#401，对齐 USTC 评课社区行为）：
 * 总结是挂在 课程×教师 上的公开评价文字缓存，由后台任务异步重算，
 * 不是评分，不参与推荐度。未配置 OpenAI 兼容接口时生成整体为 no-op。
 *
 * 调用方只学习三类稳定能力：调度某个任课关系的总结重算、
 * 管理员查询符合重算条件的任课关系、读取某门课程的非空任课关系总结。
 * 任课评价公开可见性规则由 public-review-visibility 拥有。
 */

export const SUMMARY_MIN_REVIEWS = 5;
export const SUMMARY_MIN_TOTAL_CHARS = 3000;
export const SUMMARY_PROMPT_MAX_CHARS = 32000;
export const SUMMARY_DEBOUNCE_SECONDS = 24 * 3600;
export const SUMMARY_OUTPUT_MAX_CHARS = 4000;
export const SUMMARY_GATEWAY_TIMEOUT_MS = 120_000;
export const AI_SUMMARY_DISCLAIMER = "AI 总结为根据点评内容自动生成，仅供参考";
export const SUMMARY_LEASE_SECONDS =
  Math.ceil(SUMMARY_GATEWAY_TIMEOUT_MS / 1000) + 60;
export const SUMMARY_LEASE_RETRY_DELAY_SECONDS = SUMMARY_LEASE_SECONDS;

/** 单条评价进提示词的长度上限，防止一条超长正文吃掉全部预算。 */
const SUMMARY_PER_REVIEW_MAX_CHARS = 3000;
/** 含这些标记的正文视为注入尝试，不进提示词。 */
const INJECTION_MARKERS = ["点评开始", "点评结束", "====="];

export type SummaryGatewayEnv = {
  OPENAI_BASE_URL?: string;
  OPENAI_API_KEY?: SecretBinding;
  OPENAI_MODEL?: string;
};

export type SummaryGateway = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export async function summaryGateway(
  env: SummaryGatewayEnv,
): Promise<SummaryGateway | null> {
  const apiKey = await readSecret(env.OPENAI_API_KEY);
  const model = (env.OPENAI_MODEL || "").trim();
  if (!apiKey || !model) return null;
  const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai.com/v1")
    .trim()
    .replace(/\/+$/, "");
  return { baseUrl, apiKey, model };
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const decodeHtmlEntities = (text: string) =>
  text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (raw, name: string) => {
    if (name[0] === "#") {
      const code = name[1]?.toLowerCase() === "x"
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10);
      if (Number.isSafeInteger(code) && code > 0) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return raw;
        }
      }
      return raw;
    }
    return HTML_ENTITIES[name] ?? raw;
  });

/** 评价正文（可能是富文本 HTML）→ 纯文本：去链接、去图片、去标签。 */
export function reviewHtmlToText(value: string): string {
  let text = value;
  text = text.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<img\b[^>]*>/gi, "");
  text = text.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n");
  text = text.replace(/<li\b[^>]*>/gi, "- ");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = decodeHtmlEntities(text);
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hasInjectionMarker(text: string): boolean {
  return INJECTION_MARKERS.some((marker) => text.includes(marker));
}

export type SummaryReviewInput = {
  text: string;
  recognition: number;
  createdAt: string;
};

/**
 * 收集某任课关系下进入公开流的全部文字评价：已批准且绑定有效的任课评价、
 * 已批准历史评价、公开历史评价；按认可数降序、再按时间降序。
 * 投稿中、驳回、未公开的一律不进。
 */
export async function collectRelationReviewTexts(
  db: D1Database,
  courseId: number,
  teacherId: number,
): Promise<SummaryReviewInput[]> {
  const { results } = await db
    .prepare(
      `SELECT source_order,recognition,created_at,comment FROM (
         SELECT 0 source_order,phr.id row_id,0 recognition,phr.imported_at created_at,phr.comment
         FROM public_historical_reviews phr
         WHERE phr.course_id=? AND phr.teacher_id=?
         UNION ALL
         SELECT 1 source_order,lr.id row_id,0 recognition,lr.created_at created_at,lr.comment
         FROM legacy_reviews lr
         WHERE lr.course_id=? AND lr.teacher_id=? AND lr.status='approved'
           AND trim(COALESCE(lr.comment,''))<>''
         UNION ALL
         SELECT 2 source_order,r.id row_id,
           (SELECT COUNT(*) FROM review_endorsements e WHERE e.review_id=r.id) recognition,
           r.created_at created_at,r.comment
         FROM reviews r
         WHERE r.course_id=? AND r.teacher_id=? AND r.status='approved'
           AND trim(COALESCE(r.comment,''))<>''${guestReviewBindingSql}
       ) summary_sources
       ORDER BY recognition DESC,created_at DESC,source_order,row_id`,
    )
    .bind(courseId, teacherId, courseId, teacherId, courseId, teacherId)
    .all<{
      source_order: number;
      recognition: number;
      created_at: string | null;
      comment: string;
    }>();
  const reviews: SummaryReviewInput[] = [];
  for (const row of results) {
    const text = reviewHtmlToText(row.comment);
    if (!text || hasInjectionMarker(text)) continue;
    reviews.push({
      text,
      recognition: row.recognition,
      createdAt: row.created_at || "",
    });
  }
  return reviews;
}

/**
 * USTC 评课社区的目标字数：过短评不生成；总字数不足 2000 用 200；
 * 2000–4999 按总字数 / 10 四舍五入；再长封顶 500。
 */
export function expectedSummaryLength(
  reviewCount: number,
  totalChars: number,
): number | null {
  if (reviewCount < SUMMARY_MIN_REVIEWS && totalChars < SUMMARY_MIN_TOTAL_CHARS)
    return null;
  if (totalChars < 2000) return 200;
  if (totalChars < 5000) return Math.round(totalChars / 10);
  return 500;
}

function summarySubject(courseName: string, teacherName: string): string {
  const teacher = teacherName.trim();
  const titledCourse = `《${courseName}》`;
  return teacher ? `${teacher}老师的${titledCourse}` : titledCourse;
}

/**
 * 组装提示词。低于门槛（公开评不足 5 条且总字数不足约 3000）返回 null；
 * 超过约 32k 时按排序从尾部截断。
 */
export function buildSummaryPrompt(input: {
  courseName: string;
  teacherName: string;
  reviews: string[];
}): string | null {
  const texts = input.reviews
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => text.slice(0, SUMMARY_PER_REVIEW_MAX_CHARS));
  const totalChars = texts.reduce((sum, text) => sum + text.length, 0);
  const expectedLength = expectedSummaryLength(texts.length, totalChars);
  if (expectedLength == null) return null;
  const header = `根据下列点评，尽可能简洁、全面、客观地总结${summarySubject(input.courseName, input.teacherName)}课程的考试、给分、作业、教学水平、课程内容等，以便让同学们更好地选课。注意字数限制，${expectedLength} 字左右。尽量忠于点评内容，可以引用点评中的原句，点评中如果有写得特别精彩的句子建议引用。如果有冲突的观点，应客观总结双方的观点。不要说废话，不要胡编乱造。不需要全文大标题，只要分段小标题。

`;
  let prompt = header;
  let included = 0;
  for (const text of texts) {
    const block = `【评价 ${included + 1}】\n${text}\n\n`;
    if (included > 0 && prompt.length + block.length > SUMMARY_PROMPT_MAX_CHARS)
      break;
    if (included === 0 && block.length > SUMMARY_PROMPT_MAX_CHARS) {
      prompt += `【评价 1】\n${text.slice(0, SUMMARY_PROMPT_MAX_CHARS - header.length - 20)}\n\n`;
      included = 1;
      break;
    }
    prompt += block;
    included += 1;
  }
  return included ? prompt.trimEnd() : null;
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

type SummaryRequestResult = {
  summary: string | null;
  detail?: string;
  retryable?: boolean;
};

/** 调用 OpenAI 兼容网关；任何失败返回 null，由调用方保留旧总结。 */
export async function requestSummary(
  gateway: SummaryGateway,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  return (await requestSummaryResult(gateway, prompt, fetchImpl)).summary;
}

async function requestSummaryResult(
  gateway: SummaryGateway,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SummaryRequestResult> {
  try {
    const response = await fetchImpl(`${gateway.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${gateway.apiKey}`,
      },
      body: JSON.stringify({
        model: gateway.model,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "你是 JUFE 评课平台的一个课程总结助手，旨在为每门课程的点评生成简洁、客观、全面的总结。",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(SUMMARY_GATEWAY_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = `gateway_http_${response.status}`;
      console.error(JSON.stringify({ event: "summary_gateway_http", status: response.status }));
      return {
        summary: null,
        detail,
        retryable:
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500,
      };
    }
    const data = await response.json<ChatCompletionResponse>();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string")
      return { summary: null, detail: "gateway_empty_content" };
    const summary = content.trim().slice(0, SUMMARY_OUTPUT_MAX_CHARS);
    return summary ? { summary } : { summary: null, detail: "gateway_empty_content" };
  } catch (error) {
    const name = error instanceof Error ? error.name : "error";
    console.error(JSON.stringify({ event: "summary_gateway_error", name }));
    return {
      summary: null,
      detail: name === "TimeoutError" ? "gateway_timeout" : "gateway_error",
      retryable: true,
    };
  }
}

export type SummaryRecomputeOutcome =
  | "updated"
  | "cleared"
  | "unchanged"
  | "superseded"
  | "unconfigured"
  | "failed"
  | "no-relation";

export type SummaryRecomputeResult = {
  outcome: SummaryRecomputeOutcome;
  reviewCount: number;
  totalChars: number;
  detail?: string;
  retryable?: boolean;
  sourceHash?: string;
};

/** 公开评价输入的稳定哈希，用于抵御 Queue 至少一次投递造成的重复计费。 */
export async function summarySourceHash(
  reviews: SummaryReviewInput[],
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(reviews));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * 重算单个任课关系的总结：低于门槛时清空已有总结；接口失败保留旧文；
 * 未配置网关时不碰旧文。
 */
export async function recomputeRelationSummary(
  env: SummaryGatewayEnv,
  db: D1Database,
  courseId: number,
  teacherId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<SummaryRecomputeResult> {
  const relation = await db
    .prepare(
      `SELECT ct.ai_summary,ct.ai_summary_source_hash,c.name course_name,t.name teacher_name
       FROM course_teachers ct
       JOIN courses c ON c.id=ct.course_id
       JOIN teachers t ON t.id=ct.teacher_id
       WHERE ct.course_id=? AND ct.teacher_id=?`,
    )
    .bind(courseId, teacherId)
    .first<{
      ai_summary: string;
      ai_summary_source_hash: string;
      course_name: string;
      teacher_name: string;
    }>();
  if (!relation) return { outcome: "no-relation", reviewCount: 0, totalChars: 0 };
  const reviews = await collectRelationReviewTexts(db, courseId, teacherId);
  const totalChars = reviews.reduce((sum, review) => sum + review.text.length, 0);
  const sourceHash = await summarySourceHash(reviews);
  if (relation.ai_summary_source_hash === sourceHash)
    return {
      outcome: "unchanged",
      reviewCount: reviews.length,
      totalChars,
      sourceHash,
    };
  const prompt = buildSummaryPrompt({
    courseName: relation.course_name,
    teacherName: relation.teacher_name,
    reviews: reviews.map((review) => review.text),
  });
  if (!prompt) {
    const hadSummary = Boolean(relation.ai_summary.trim());
    if (hadSummary) {
      await db
        .prepare(
          "UPDATE course_teachers SET ai_summary='',ai_summary_source_hash=?,ai_summary_updated_at=CURRENT_TIMESTAMP WHERE course_id=? AND teacher_id=?",
        )
        .bind(sourceHash, courseId, teacherId)
        .run();
    } else {
      // Record the source hash without starting the 24h debounce clock. An
      // empty relation that has never had a summary must stay due so later
      // reviews can still generate once they cross the threshold.
      await db
        .prepare(
          "UPDATE course_teachers SET ai_summary_source_hash=? WHERE course_id=? AND teacher_id=?",
        )
        .bind(sourceHash, courseId, teacherId)
        .run();
    }
    return {
      outcome: hadSummary ? "cleared" : "unchanged",
      reviewCount: reviews.length,
      totalChars,
      sourceHash,
    };
  }
  const gateway = await summaryGateway(env);
  if (!gateway)
    return { outcome: "unconfigured", reviewCount: reviews.length, totalChars };
  const requested = await requestSummaryResult(gateway, prompt, fetchImpl);
  if (!requested.summary)
    return {
      outcome: "failed",
      reviewCount: reviews.length,
      totalChars,
      detail: requested.detail,
      retryable: requested.retryable,
      sourceHash,
    };
  const latestSourceHash = await summarySourceHash(
    await collectRelationReviewTexts(db, courseId, teacherId),
  );
  if (latestSourceHash !== sourceHash)
    return {
      outcome: "superseded",
      reviewCount: reviews.length,
      totalChars,
      sourceHash,
    };
  await db
    .prepare(
      "UPDATE course_teachers SET ai_summary=?,ai_summary_source_hash=?,ai_summary_updated_at=CURRENT_TIMESTAMP WHERE course_id=? AND teacher_id=?",
    )
    .bind(requested.summary, sourceHash, courseId, teacherId)
    .run();
  return {
    outcome: "updated",
    reviewCount: reviews.length,
    totalChars,
    sourceHash,
  };
}

export type QualifyingSummaryRelation = {
  courseId: number;
  teacherId: number;
  courseName: string;
  teacherName: string;
  courseCode: string;
  reviewCount: number;
  rawChars: number;
};

/**
 * SQL 近似门槛：公开历史评 + 已批准历史评 + 已批准任课评。
 * 用原文 LENGTH，可能略宽于纯文本门槛；最终仍由 recomputeRelationSummary 判定。
 */
export async function listQualifyingSummaryRelations(
  db: D1Database,
): Promise<QualifyingSummaryRelation[]> {
  const { results } = await db
    .prepare(
      `WITH public_texts AS (
         SELECT phr.course_id, phr.teacher_id, phr.comment AS comment
         FROM public_historical_reviews phr
         UNION ALL
         SELECT lr.course_id, lr.teacher_id, lr.comment
         FROM legacy_reviews lr
         WHERE lr.status='approved' AND trim(COALESCE(lr.comment,''))<>''
         UNION ALL
         SELECT r.course_id, r.teacher_id, r.comment
         FROM reviews r
         WHERE r.status='approved' AND trim(COALESCE(r.comment,''))<>''
           ${guestReviewBindingSql}
       )
       SELECT ct.course_id, ct.teacher_id, c.name course_name, t.name teacher_name,
         c.code course_code, COUNT(*) review_count, SUM(LENGTH(pt.comment)) raw_chars
       FROM course_teachers ct
       JOIN courses c ON c.id=ct.course_id
       JOIN teachers t ON t.id=ct.teacher_id
       JOIN public_texts pt ON pt.course_id=ct.course_id AND pt.teacher_id=ct.teacher_id
       GROUP BY ct.course_id, ct.teacher_id
       HAVING review_count>=? OR raw_chars>=?
       ORDER BY ct.course_id, ct.teacher_id`,
    )
    .bind(SUMMARY_MIN_REVIEWS, SUMMARY_MIN_TOTAL_CHARS)
    .all<{
      course_id: number;
      teacher_id: number;
      course_name: string;
      teacher_name: string;
      course_code: string;
      review_count: number;
      raw_chars: number;
    }>();
  return results.map((row) => ({
    courseId: row.course_id,
    teacherId: row.teacher_id,
    courseName: row.course_name,
    teacherName: row.teacher_name,
    courseCode: row.course_code,
    reviewCount: row.review_count,
    rawChars: row.raw_chars,
  }));
}

/** 24 小时去抖：immediate（驳回/撤回/删除）绕过；从未更新或超过 24h 才算到期。 */
export async function isSummaryRecomputeDue(
  db: D1Database,
  courseId: number,
  teacherId: number,
  immediate: boolean,
): Promise<boolean> {
  if (immediate) return true;
  const fresh = await db
    .prepare(
      `SELECT 1 fresh FROM course_teachers
       WHERE course_id=? AND teacher_id=?
         AND ai_summary_updated_at IS NOT NULL
         AND ai_summary_updated_at > datetime('now','-${SUMMARY_DEBOUNCE_SECONDS} seconds')`,
    )
    .bind(courseId, teacherId)
    .first();
  return !fresh;
}

export type AiSummaryQueueMessage = {
  courseId: number;
  teacherId: number;
  immediate: boolean;
};

type SummaryQueueSender = {
  send(message: AiSummaryQueueMessage): Promise<unknown>;
};

export type AiSummaryQueueEnv = SummaryGatewayEnv & {
  DB: D1Database;
  AI_SUMMARY_QUEUE: SummaryQueueSender;
};

type SummaryScheduleContext = {
  env: AiSummaryQueueEnv;
};

function isAiSummaryQueueMessage(value: unknown): value is AiSummaryQueueMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<AiSummaryQueueMessage>;
  return (
    Number.isSafeInteger(message.courseId) &&
    Number.isSafeInteger(message.teacherId) &&
    (message.courseId as number) > 0 &&
    (message.teacherId as number) > 0 &&
    typeof message.immediate === "boolean"
  );
}

async function acquireSummaryLease(
  db: D1Database,
  courseId: number,
  teacherId: number,
): Promise<string | null> {
  const token = crypto.randomUUID();
  const acquired = await db
    .prepare(
      `INSERT INTO summary_recompute_leases(
         course_id, teacher_id, lease_token, lease_until
       ) VALUES(?, ?, ?, unixepoch() + ?)
       ON CONFLICT(course_id, teacher_id) DO UPDATE SET
         lease_token=excluded.lease_token,
         lease_until=excluded.lease_until
       WHERE summary_recompute_leases.lease_until <= unixepoch()
       RETURNING lease_token`,
    )
    .bind(courseId, teacherId, token, SUMMARY_LEASE_SECONDS)
    .first<{ lease_token: string }>();
  return acquired?.lease_token === token ? token : null;
}

async function releaseSummaryLease(
  db: D1Database,
  message: AiSummaryQueueMessage,
  token: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM summary_recompute_leases
       WHERE course_id=? AND teacher_id=? AND lease_token=?`,
    )
    .bind(message.courseId, message.teacherId, token)
    .run();
}

function isPersistedRelationId(value: number | null | undefined): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/**
 * Cutover helper: parent isolates persisted work in summary_recompute_lock /
 * summary_recompute_pending. After the Queue migration those rows are otherwise
 * never read, so enqueue them once and clear the D1 tables.
 */
export async function drainPersistedSummaryJobs(
  env: AiSummaryQueueEnv,
): Promise<number> {
  const jobs = new Map<string, AiSummaryQueueMessage>();
  const remember = (courseId: number, teacherId: number, immediate: boolean) => {
    const key = `${courseId}:${teacherId}`;
    const existing = jobs.get(key);
    if (existing) {
      existing.immediate = existing.immediate || immediate;
      return;
    }
    jobs.set(key, { courseId, teacherId, immediate });
  };

  const locked = await env.DB.prepare(
    `SELECT course_id, teacher_id, immediate
     FROM summary_recompute_lock
     WHERE id = 1`,
  ).first<{
    course_id: number | null;
    teacher_id: number | null;
    immediate: number;
  }>();
  if (
    locked &&
    isPersistedRelationId(locked.course_id) &&
    isPersistedRelationId(locked.teacher_id)
  ) {
    remember(locked.course_id, locked.teacher_id, locked.immediate === 1);
  }

  const pending = await env.DB.prepare(
    `SELECT course_id, teacher_id, immediate
     FROM summary_recompute_pending
     ORDER BY enqueued_at ASC, course_id ASC, teacher_id ASC`,
  ).all<{
    course_id: number;
    teacher_id: number;
    immediate: number;
  }>();
  for (const row of pending.results) {
    if (
      !isPersistedRelationId(row.course_id) ||
      !isPersistedRelationId(row.teacher_id)
    )
      continue;
    remember(row.course_id, row.teacher_id, row.immediate === 1);
  }

  if (!jobs.size) return 0;
  for (const job of jobs.values()) {
    await env.AI_SUMMARY_QUEUE.send(job);
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE summary_recompute_lock
       SET course_id = NULL, teacher_id = NULL, immediate = 0,
           locked_at = NULL, lease_until = NULL
       WHERE id = 1`,
    ),
    env.DB.prepare("DELETE FROM summary_recompute_pending"),
  ]);
  return jobs.size;
}

/**
 * HTTP 侧只负责把关系标识入队；正文由 consumer 从 D1 重新读取，评价发布和
 * 管理操作不会等待最长 120 秒的模型调用。
 */
export async function scheduleRelationSummaryRecompute(
  c: SummaryScheduleContext,
  courseId: number | null | undefined,
  teacherId: number | null | undefined,
  options: { immediate?: boolean } = {},
): Promise<void> {
  if (
    !Number.isSafeInteger(courseId) ||
    !Number.isSafeInteger(teacherId) ||
    (courseId as number) <= 0 ||
    (teacherId as number) <= 0
  )
    return;
  try {
    await drainPersistedSummaryJobs(c.env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "summary_cutover_drain_error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  try {
    await c.env.AI_SUMMARY_QUEUE.send({
      courseId: courseId as number,
      teacherId: teacherId as number,
      immediate: options.immediate === true,
    });
  } catch (error) {
    // The caller has typically already committed its D1 mutation (review
    // insert, admin reject, ...). Queue outage must not turn that into a 500.
    console.error(
      JSON.stringify({
        event: "summary_enqueue_error",
        courseId,
        teacherId,
        immediate: options.immediate === true,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/** 单条 Queue 消息的处理入口；异常和临时网关故障由 Queue 自动重试并最终进 DLQ。 */
export async function consumeAiSummaryMessage(
  message: Message<AiSummaryQueueMessage>,
  env: AiSummaryQueueEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!isAiSummaryQueueMessage(message.body)) {
    message.ack();
    return;
  }
  const body = message.body;
  let token: string;
  try {
    const acquired = await acquireSummaryLease(env.DB, body.courseId, body.teacherId);
    if (!acquired) {
      message.retry({ delaySeconds: SUMMARY_LEASE_RETRY_DELAY_SECONDS });
      return;
    }
    token = acquired;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "summary_lease_acquire_error",
        courseId: body.courseId,
        teacherId: body.teacherId,
        attempt: message.attempts,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    message.retry();
    return;
  }

  let retry = false;
  let enqueueLatest = false;
  try {
    if (
      !(await isSummaryRecomputeDue(
        env.DB,
        body.courseId,
        body.teacherId,
        body.immediate,
      ))
    ) {
      // The source hash is intentionally not needed here: non-immediate work
      // remains subject to the existing 24-hour debounce contract.
    } else {
      const result = await recomputeRelationSummary(
        env,
        env.DB,
        body.courseId,
        body.teacherId,
        fetchImpl,
      );
      console.log(
        JSON.stringify({
          event: "summary_recompute",
          courseId: body.courseId,
          teacherId: body.teacherId,
          outcome: result.outcome,
          reviewCount: result.reviewCount,
          attempt: message.attempts,
        }),
      );
      retry = result.outcome === "failed" && result.retryable === true;
      if (result.sourceHash && result.outcome !== "failed") {
        const latestHash = await summarySourceHash(
          await collectRelationReviewTexts(env.DB, body.courseId, body.teacherId),
        );
        enqueueLatest = latestHash !== result.sourceHash;
      }
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "summary_recompute_error",
        courseId: body.courseId,
        teacherId: body.teacherId,
        attempt: message.attempts,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    retry = true;
  } finally {
    try {
      await releaseSummaryLease(env.DB, body, token);
    } catch (error) {
      retry = true;
      console.error(
        JSON.stringify({
          event: "summary_lease_release_error",
          courseId: body.courseId,
          teacherId: body.teacherId,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  if (retry) {
    message.retry();
    return;
  }
  if (enqueueLatest) {
    try {
      await env.AI_SUMMARY_QUEUE.send({
        courseId: body.courseId,
        teacherId: body.teacherId,
        immediate: true,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "summary_requeue_error",
          courseId: body.courseId,
          teacherId: body.teacherId,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      message.retry();
      return;
    }
  }
  message.ack();
}

export async function consumeAiSummaryQueue(
  batch: MessageBatch<AiSummaryQueueMessage>,
  env: AiSummaryQueueEnv,
): Promise<void> {
  try {
    await drainPersistedSummaryJobs(env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "summary_cutover_drain_error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  await Promise.all(
    batch.messages.map((message) => consumeAiSummaryMessage(message, env)),
  );
}

const inlineSummaryHtml = (text: string) =>
  escapeHtml(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

/**
 * 总结 Markdown → HTML。先整体转义再套用极小 Markdown 子集
 * （小标题 / 段落 / 加粗 / 行内代码 / 引用 / 无序列表），不渲染链接与图片，
 * 因此输出天然不含可执行 HTML——这就是消毒。
 */
export function renderSummaryHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(
      `<p class="my-2 break-words text-sm leading-relaxed">${paragraph.map(inlineSummaryHtml).join("<br>")}</p>`,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      `<ul class="my-2 list-disc pl-5 text-sm leading-relaxed">${list
        .map((item) => `<li>${inlineSummaryHtml(item)}</li>`)
        .join("")}</ul>`,
    );
    list = [];
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      const level = Math.min(3 + Math.max(0, heading[1].length - 2), 4);
      blocks.push(
        `<h${level} class="mb-1 mt-3 text-[1rem] font-bold leading-snug first:mt-0">${inlineSummaryHtml(heading[2])}</h${level}>`,
      );
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      blocks.push(
        `<blockquote class="my-2 border-l-2 border-border pl-3 text-sm leading-relaxed text-muted">${inlineSummaryHtml(quote[1])}</blockquote>`,
      );
      continue;
    }
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flush();
  return blocks.join("");
}

export type RelationSummaryView = {
  html: string;
  updatedAt: string | null;
};

/** 课程详情载荷：该课程各任课关系的非空总结，按教师 ID 索引。 */
export async function getCourseRelationSummaries(
  db: D1Database,
  courseId: number | null,
): Promise<Record<number, RelationSummaryView>> {
  if (!courseId) return {};
  const { results } = await db
    .prepare(
      `SELECT teacher_id,ai_summary,ai_summary_updated_at
       FROM course_teachers
       WHERE course_id=? AND trim(ai_summary)<>''`,
    )
    .bind(courseId)
    .all<{
      teacher_id: number;
      ai_summary: string;
      ai_summary_updated_at: string | null;
    }>();
  const summaries: Record<number, RelationSummaryView> = {};
  for (const row of results) {
    summaries[row.teacher_id] = {
      html: renderSummaryHtml(row.ai_summary),
      updatedAt: row.ai_summary_updated_at,
    };
  }
  return summaries;
}
