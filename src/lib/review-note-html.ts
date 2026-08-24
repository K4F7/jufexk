/**
 * 补充说明富文本的白名单消毒与纯文本提取（issue #400）。
 *
 * 纯 TS 实现、不依赖 DOM：投稿接口在 Workers（无 DOM）里落库前消毒，
 * 浏览器展示侧用 DOMPurify 按同一份白名单再做一层。两边都不允许
 * 白名单外的标签或属性。
 */

/** 允许保留的标签（历史富文本行与投稿转义后的段落子集）。 */
export const REVIEW_NOTE_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
] as const;

/** 展示侧 DOMPurify 允许的属性（仅 a[href]，rel/target 由消毒方统一补）。 */
export const REVIEW_NOTE_ALLOWED_ATTRS = ["href"] as const;

/** 消毒后 HTML 的存储上限；纯文本 10–1200 门槛之外的防滥用护栏。 */
export const REVIEW_NOTE_HTML_MAX_LENGTH = 8000;

/** 投稿原始体积上限，超出直接按超长拒绝，不进入解析。 */
export const REVIEW_NOTE_RAW_MAX_LENGTH = 20000;

const ALLOWED = new Set<string>(REVIEW_NOTE_ALLOWED_TAGS);
/** 整个元素连同内容一起丢弃的标签。 */
const DROP_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
  "textarea",
  "title",
  "head",
]);
/** 常见别名统一成 Tiptap 规范输出。 */
const TAG_ALIAS: Record<string, string> = { b: "strong", i: "em" };
const VOID_TAGS = new Set(["br"]);

const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(value: string): string {
  return value.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body: string) => {
      if (body.startsWith("#")) {
        const hex = body[1]?.toLowerCase() === "x";
        const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (Number.isInteger(code) && code >= 0 && code <= 0x10ffff) {
          try {
            return String.fromCodePoint(code);
          } catch {
            return match;
          }
        }
        return match;
      }
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}

const escapeText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (value: string) => escapeText(value).replace(/"/g, "&quot;");

/**
 * 投稿页只收纯文本。接口与公开展示仍走既有白名单 HTML 消毒路径，
 * 因此把换行收成段落、把尖括号转义后再提交。
 */
export function plainTextToReviewNoteHtml(text: string): string {
  if (!text.trim()) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => `<p>${escapeText(line)}</p>`)
    .join("");
}

/** a[href] 只允许 http/https/mailto 与相对地址，其余协议丢弃该属性。 */
function safeHref(raw: string): string | null {
  // 先剥掉 ASCII 控制字符与空白，防止 java\tscript: 这类混淆协议绕过。
  const href = decodeEntities(raw).replace(/[\x00-\x20]/g, "");
  if (!href) return null;
  if (/^(?:https?:|mailto:)/i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  return href;
}

type Attrs = Record<string, string>;

/** 解析开标签内的属性段；值只保留到消毒阶段再按白名单取用。 */
function parseAttrs(source: string): Attrs {
  const attrs: Attrs = {};
  const pattern = /([a-zA-Z][a-zA-Z0-9:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const name = match[1].toLowerCase();
    attrs[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

type Token =
  | { kind: "text"; text: string }
  | { kind: "open"; name: string; attrs: Attrs; selfClosing: boolean }
  | { kind: "close"; name: string };

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const pushText = (text: string) => {
    if (text) tokens.push({ kind: "text", text });
  };
  while (index < html.length) {
    const lt = html.indexOf("<", index);
    if (lt === -1) {
      pushText(html.slice(index));
      break;
    }
    pushText(html.slice(index, lt));
    const rest = html.slice(lt);
    // 注释与声明整体跳过。
    const bang = rest.match(/^<!(?:--[\s\S]*?--|[^>]*)>/);
    if (bang) {
      index = lt + bang[0].length;
      continue;
    }
    if (rest.startsWith("<?")) {
      const end = rest.indexOf(">", 2);
      index = end === -1 ? html.length : lt + end + 1;
      continue;
    }
    const close = rest.match(/^<\/\s*([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/);
    if (close) {
      tokens.push({ kind: "close", name: close[1].toLowerCase() });
      index = lt + close[0].length;
      continue;
    }
    const open = rest.match(/^<\s*([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/);
    if (open) {
      tokens.push({
        kind: "open",
        name: open[1].toLowerCase(),
        attrs: parseAttrs(open[2] ?? ""),
        selfClosing: open[3] === "/",
      });
      index = lt + open[0].length;
      continue;
    }
    // 不是合法标签的 `<` 按普通文本处理。
    pushText("<");
    index = lt + 1;
  }
  return tokens;
}

/**
 * 把任意输入消毒成白名单 HTML：白名单外标签被解开（保留文本）、
 * 危险元素连同内容丢弃、文本与属性值重新转义、a 只保留安全 href。
 */
export function sanitizeReviewNoteHtml(input: string): string {
  const out: string[] = [];
  const openStack: string[] = [];
  const dropStack: string[] = [];
  for (const token of tokenize(input)) {
    if (token.kind === "text") {
      if (!dropStack.length) out.push(escapeText(decodeEntities(token.text)));
      continue;
    }
    const name = TAG_ALIAS[token.name] ?? token.name;
    if (token.kind === "open") {
      if (DROP_CONTENT.has(token.name)) {
        dropStack.push(token.name);
        continue;
      }
      if (dropStack.length) continue;
      if (!ALLOWED.has(name)) continue;
      if (name === "a") {
        const href = token.attrs.href ? safeHref(token.attrs.href) : null;
        out.push(
          href
            ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">`
            : "<a>",
        );
      } else {
        out.push(`<${name}>`);
      }
      if (!VOID_TAGS.has(name) && !token.selfClosing) openStack.push(name);
      else if (!VOID_TAGS.has(name) && token.selfClosing) out.push(`</${name}>`);
      continue;
    }
    // 闭标签：先匹配丢弃区，再匹配已打开的白名单标签（自动闭合交叉标签）。
    if (dropStack.length) {
      const at = dropStack.lastIndexOf(token.name);
      if (at !== -1) dropStack.length = at;
      continue;
    }
    if (!ALLOWED.has(name) || VOID_TAGS.has(name)) continue;
    const at = openStack.lastIndexOf(name);
    if (at === -1) continue;
    for (let i = openStack.length - 1; i >= at; i--) {
      out.push(`</${openStack[i]}>`);
    }
    openStack.length = at;
  }
  while (openStack.length) out.push(`</${openStack.pop()}>`);
  return out.join("");
}

/**
 * 消毒后 HTML 的纯文本视图：块级边界换成换行，用于 10–1200 字门槛，
 * 与编辑器 getText() 的块分隔一致。
 */
export function reviewNotePlainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|li|blockquote|ul|ol)>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  );
}

export type SanitizedReviewNote = {
  comment: string;
  /** 'html' 表示消毒后的富文本；null 表示纯文本（含历史行）。 */
  commentFormat: "html" | null;
};

/**
 * 投稿/审核编辑共用的落库规范化：含白名单标记的存消毒 HTML，
 * 不含标记的回落为纯文本，不假装成富文本。
 */
export function sanitizeReviewNoteValue(raw: string): SanitizedReviewNote {
  const comment = sanitizeReviewNoteHtml(raw).trim();
  if (!comment) return { comment: "", commentFormat: null };
  if (!/<[a-z]/i.test(comment)) {
    return { comment: reviewNotePlainText(comment).trim(), commentFormat: null };
  }
  return { comment, commentFormat: "html" };
}
