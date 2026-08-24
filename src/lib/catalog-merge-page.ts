/** Real-row LIMIT/OFFSET when virtual PE rows are merged into a name-sorted page. */

export function extraMergedIndexes(realBeforeEach: number[]): number[] {
  return realBeforeEach.map((realBefore, extrasBefore) => realBefore + extrasBefore);
}

export function mergedNameRealWindow(
  start: number,
  size: number,
  extraIndexes: number[],
): { offset: number; limit: number; extraIndexesOnPage: number[] } {
  const end = start + size;
  const extraIndexesOnPage = extraIndexes.filter(
    (index) => index >= start && index < end,
  );
  const extrasBeforePage = extraIndexes.filter((index) => index < start).length;
  return {
    offset: Math.max(0, start - extrasBeforePage),
    limit: Math.max(0, size - extraIndexesOnPage.length),
    extraIndexesOnPage,
  };
}
