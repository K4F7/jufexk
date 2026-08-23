import { escapeHtml } from "./html";
import { readSecret, type SecretBinding } from "./secrets";

/**
 * 任课关系 AI 总结（#401，对齐 USTC 评课社区行为）：
 * 总结是挂在 课程×教师 上的公开评价文字缓存，由后台任务异步重算，
 * 不是评分，不参与推荐度。未配置 OpenAI 兼容接口时生成整体为 no-op。
 */

/** 与公开文字流一致的任课评价可见性绑定：已批准且关系/开班绑定有效。 */
export const publicReviewBindingSql = `
       AND EXISTS(
         SELECT 1 FROM course_teachers public_relation
         WHERE public_relation.course_id=r.course_id
           AND public_relation.teacher_id=r.teacher_id
       )
       AND (
         r.offering_id IS NULL OR EXISTS(
           SELECT 1
           FROM offerings public_offering
           JOIN offering_teachers public_offering_teacher
             ON public_offering_teacher.offering_id=public_offering.id
            AND public_offering_teacher.teacher_id=r.teacher_id
           WHERE public_offering.id=r.offering_id
             AND public_offering.course_id=r.course_id
         )
       )`;

export const SUMMARY_MIN_REVIEWS = 5;
export const SUMMARY_MIN_TOTAL_CHARS = 3000;
export const SUMMARY_PROMPT_MAX_CHARS = 32000;
export const SUMMARY_DEBOUNCE_SECONDS = 24 * 3600;
export const SUMMARY_OUTPUT_MAX_CHARS = 4000;
export const AI_SUMMARY_DISCLAIMER = "AI 总结为根据点评内容自动生成，仅供参考";

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
           AND trim(COALESCE(r.comment,''))<>''${publicReviewBindingSql}
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
  if (texts.length < SUMMARY_MIN_REVIEWS && totalChars < SUMMARY_MIN_TOTAL_CHARS)
    return null;
  const header = `你正在为课程评价站整理一份「课程 × 教师」的公开评价总结。

课程：${input.courseName}
任课教师：${input.teacherName}

请根据下面 ${texts.length} 条学生公开评价写一份 200 到 500 字的客观总结，要求：
1. 只依据给出的评价内容，不得编造评价中没有的信息；
2. 围绕考试、给分、作业、教学、课程内容五个方面归纳，评价没提到的方面可以不写；
3. 评价之间存在分歧时，两边的观点都要写出来；
4. 可以引用评价原句，但不要逐条罗列；
5. 全文只用「## 」分段小标题组织，不要写开场白、结束语或评价条数。

公开评价如下：

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

/** 调用 OpenAI 兼容网关；任何失败返回 null，由调用方保留旧总结。 */
export async function requestSummary(
  gateway: SummaryGateway,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
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
              "你是课程评价整理助手，只输出客观、带分段小标题的 Markdown 总结，不编造评价中没有的信息。",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    const data = await response.json<ChatCompletionResponse>();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const summary = content.trim().slice(0, SUMMARY_OUTPUT_MAX_CHARS);
    return summary || null;
  } catch {
    return null;
  }
}

export type SummaryRecomputeOutcome =
  | "updated"
  | "cleared"
  | "unchanged"
  | "unconfigured"
  | "failed"
  | "no-relation";

export type SummaryRecomputeResult = {
  outcome: SummaryRecomputeOutcome;
  reviewCount: number;
  totalChars: number;
};

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
      `SELECT ct.ai_summary,c.name course_name,t.name teacher_name
       FROM course_teachers ct
       JOIN courses c ON c.id=ct.course_id
       JOIN teachers t ON t.id=ct.teacher_id
       WHERE ct.course_id=? AND ct.teacher_id=?`,
    )
    .bind(courseId, teacherId)
    .first<{ ai_summary: string; course_name: string; teacher_name: string }>();
  if (!relation) return { outcome: "no-relation", reviewCount: 0, totalChars: 0 };
  const reviews = await collectRelationReviewTexts(db, courseId, teacherId);
  const totalChars = reviews.reduce((sum, review) => sum + review.text.length, 0);
  const prompt = buildSummaryPrompt({
    courseName: relation.course_name,
    teacherName: relation.teacher_name,
    reviews: reviews.map((review) => review.text),
  });
  if (!prompt) {
    if (relation.ai_summary.trim()) {
      await db
        .prepare(
          "UPDATE course_teachers SET ai_summary='',ai_summary_updated_at=CURRENT_TIMESTAMP WHERE course_id=? AND teacher_id=?",
        )
        .bind(courseId, teacherId)
        .run();
      return { outcome: "cleared", reviewCount: reviews.length, totalChars };
    }
    return { outcome: "unchanged", reviewCount: reviews.length, totalChars };
  }
  const gateway = await summaryGateway(env);
  if (!gateway)
    return { outcome: "unconfigured", reviewCount: reviews.length, totalChars };
  const summary = await requestSummary(gateway, prompt, fetchImpl);
  if (!summary)
    return { outcome: "failed", reviewCount: reviews.length, totalChars };
  await db
    .prepare(
      "UPDATE course_teachers SET ai_summary=?,ai_summary_updated_at=CURRENT_TIMESTAMP WHERE course_id=? AND teacher_id=?",
    )
    .bind(summary, courseId, teacherId)
    .run();
  return { outcome: "updated", reviewCount: reviews.length, totalChars };
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

type SummaryScheduleContext = {
  env: SummaryGatewayEnv & { DB: D1Database };
  /** 结构类型即可：Hono 与 workers-types 的 ExecutionContext 定义不同。 */
  executionCtx?: { waitUntil(promise: Promise<unknown>): void };
};

/**
 * 公开评价内容变更后的后台重算入口。有执行上下文时挂 waitUntil 异步执行，
 * 否则（脚本/测试）就地执行；任务内部吞掉所有异常，绝不影响主请求。
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
  const course = courseId as number;
  const teacher = teacherId as number;
  const task = (async () => {
    try {
      if (
        !(await isSummaryRecomputeDue(
          c.env.DB,
          course,
          teacher,
          options.immediate === true,
        ))
      )
        return;
      const result = await recomputeRelationSummary(
        c.env,
        c.env.DB,
        course,
        teacher,
      );
      console.log(
        JSON.stringify({
          event: "summary_recompute",
          courseId: course,
          teacherId: teacher,
          outcome: result.outcome,
          reviewCount: result.reviewCount,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "summary_recompute_error",
          courseId: course,
          teacherId: teacher,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  })();
  let ctx: SummaryScheduleContext["executionCtx"];
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(task);
    return;
  }
  await task;
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
        `<h${level} class="mb-1 mt-3 text-[15px] font-bold leading-snug first:mt-0">${inlineSummaryHtml(heading[2])}</h${level}>`,
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
