/** 与目录主搜索同一量级的建议 debounce。 */
export const CATALOG_SUGGEST_DELAY = 320;
export const CATALOG_SUGGEST_PAGE_SIZE = 8;

export function shouldFetchCatalogSuggestions(value: string): boolean {
  return value.trim().length > 0;
}

export function shouldOpenCatalogSuggestions(state: {
  focused: boolean;
  query: string;
  ready: boolean;
  failed: boolean;
  dismissed?: boolean;
}): boolean {
  return (
    state.focused &&
    state.ready &&
    !state.failed &&
    !state.dismissed &&
    shouldFetchCatalogSuggestions(state.query)
  );
}
