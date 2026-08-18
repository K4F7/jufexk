/**
 * Catalog title + primary search — visually frozen: prototype C (同行工具条).
 * Title left · count under title · HeroUI SearchField secondary full-width right.
 */
import { Label, SearchField, Skeleton, Typography } from "@heroui/react";

export type CatalogSearchHeaderProps = {
  title: string;
  /** e.g. "12840 门课程" — empty while first load */
  meta?: string;
  /** True during the first load: the meta line shows a skeleton bar instead
   * of popping the count in later, keeping the header height stable
   * (Issue #205). */
  metaLoading?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible name for the search field */
  searchLabel: string;
  clearAriaLabel: string;
  name?: string;
};

export function CatalogSearchHeader({
  title,
  meta,
  metaLoading = false,
  value,
  onChange,
  placeholder,
  searchLabel,
  clearAriaLabel,
  name = "catalog-search",
}: CatalogSearchHeaderProps) {
  return (
    <header className="mb-3" aria-label="目录标题与搜索">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 sm:flex-nowrap">
        <div className="min-w-0 shrink-0">
          <Typography
            className="m-0 text-lg font-bold leading-tight tracking-tight text-foreground"
            type="h1"
          >
            {title}
          </Typography>
          {/* 计数行恒占一行高度：加载时骨架、到达后文字，避免布局跳动。 */}
          <div
            className="mt-0.5 flex min-h-4 items-center text-xs text-muted"
            aria-live="polite"
          >
            {metaLoading ? (
              <Skeleton className="h-3 w-20 rounded" aria-label="数量加载中" />
            ) : (
              meta || null
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1 basis-[min(100%,18rem)]">
          <SearchField
            fullWidth
            name={name}
            value={value}
            variant="secondary"
            onChange={onChange}
          >
            <Label className="sr-only">{searchLabel}</Label>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input className="w-full" placeholder={placeholder} />
              <SearchField.ClearButton aria-label={clearAriaLabel} />
            </SearchField.Group>
          </SearchField>
        </div>
      </div>
    </header>
  );
}
