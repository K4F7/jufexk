/** Public review stream ids: review:1 / historical:x. */
export type PublicReviewTarget =
  | { kind: "review"; id: number; publicId: string }
  | { kind: "historical"; id: string; publicId: string };

const HISTORICAL_ID = /^[A-Za-z0-9._-]+$/;

function decodeRaw(raw: string | undefined) {
  const value = (raw || "").trim();
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value;
  }
}

export function parsePublicReviewTarget(
  raw: string | undefined,
): PublicReviewTarget | null {
  const value = decodeRaw(raw);
  const review = /^(?:review:)?(\d+)$/.exec(value);
  if (review) {
    const id = Number(review[1]);
    return Number.isSafeInteger(id) && id > 0
      ? { kind: "review", id, publicId: `review:${id}` }
      : null;
  }
  const historical = /^historical:(.+)$/.exec(value);
  if (historical && HISTORICAL_ID.test(historical[1])) {
    return {
      kind: "historical",
      id: historical[1],
      publicId: `historical:${historical[1]}`,
    };
  }
  return null;
}

export function parseCurrentReviewId(raw: string | undefined) {
  const target = parsePublicReviewTarget(raw);
  return target?.kind === "review" ? target.id : null;
}

export function isEndorsablePublicId(id: unknown) {
  if (typeof id === "number") return parsePublicReviewTarget(String(id)) != null;
  return parsePublicReviewTarget(typeof id === "string" ? id : undefined) != null;
}
