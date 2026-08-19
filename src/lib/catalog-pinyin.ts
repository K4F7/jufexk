import { pinyin } from "pinyin-pro";

/** ASCII 字母词条才走拼音面；汉字、纯数字、纯通配符仍只打字面 match_text。 */
export function isAsciiLetterTerm(term: string): boolean {
  return /[A-Za-z]/.test(term) && !/[^\x00-\x7F]/.test(term);
}

const pinyinOptions = {
  toneType: "none",
  type: "array",
  v: true,
  nonZh: "removed",
} as const;

function syllables(text: string, surname = false): string[] {
  const result = pinyin(text, {
    ...pinyinOptions,
    ...(surname ? { surname: "head" as const } : {}),
  });
  return Array.isArray(result)
    ? result.map((part) => String(part).toLowerCase()).filter(Boolean)
    : [];
}

function tokensForPart(text: string, surname: boolean): string[] {
  const full = syllables(text, surname);
  if (!full.length) return [];
  const initials = pinyin(text, {
    ...pinyinOptions,
    pattern: "first",
    ...(surname ? { surname: "head" as const } : {}),
  });
  const initialJoin = Array.isArray(initials)
    ? initials.map((part) => String(part).toLowerCase()).join("")
    : "";
  const shorts: string[] = [];
  // 有序字对简称：高等数学 → gaoshu，检索高等数学 也能对上 高+数。
  const limit = Math.min(full.length, 8);
  for (let start = 0; start < limit; start += 1) {
    for (let end = start + 1; end < limit; end += 1) {
      shorts.push(`${full[start]}${full[end]}`);
    }
  }
  return [full.join(""), initialJoin, ...shorts].filter(Boolean);
}

/** 写入时生成全拼（无空格）+ 首字母；查询路径不再转写。 */
export function catalogPinyinText(
  parts: readonly string[],
  options: { surname?: boolean } = {},
): string {
  const unique = [...new Set(parts.map((part) => part.trim()).filter(Boolean))];
  return [...new Set(unique.flatMap((part) => tokensForPart(part, options.surname === true)))].join(
    " ",
  );
}
