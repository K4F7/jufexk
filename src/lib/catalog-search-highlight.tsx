import { Fragment, useMemo } from "react";
import { parseSearchTerms } from "./catalog-search";

export type HighlightSegment = { text: string; highlight: boolean };

const MARK_CLASS = "rounded-sm bg-accent-soft text-inherit";

/** Escape user-supplied terms for literal RegExp alternation. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split display text into plain and matched spans for every search term.
 * Terms match literally (case-insensitive); `%` / `_` are not wildcards.
 */
export function splitSearchHighlights(
  text: string,
  terms: string[],
): HighlightSegment[] {
  if (!text) return [{ text: "", highlight: false }];

  const uniqueTerms = [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
  if (!uniqueTerms.length) return [{ text, highlight: false }];

  const pattern = new RegExp(
    `(${uniqueTerms.map(escapeRegExp).join("|")})`,
    "gi",
  );
  const segments: HighlightSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, index), highlight: false });
    }
    segments.push({ text: match[0], highlight: true });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), highlight: false });
  }

  return segments.length ? segments : [{ text, highlight: false }];
}

/** Parse `q` from a catalog location.search string into highlight terms. */
export function highlightTermsFromSearch(search: string): string[] {
  const query = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  ).get("q");
  return parseSearchTerms(query ?? "");
}

export function HighlightSearchTerms({
  text,
  terms,
}: {
  text: string;
  terms: string[];
}) {
  const segments = useMemo(
    () => splitSearchHighlights(text, terms),
    [text, terms],
  );

  if (!terms.length) return text;

  return (
    <>
      {segments.map((segment, index) =>
        segment.highlight ? (
          <mark key={index} className={MARK_CLASS}>
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
