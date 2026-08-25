export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character]!,
  );

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
