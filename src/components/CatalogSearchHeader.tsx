/**
 * Catalog title + primary search — visually frozen: prototype C (同行工具条).
 * Title left · count under title · HeroUI SearchField secondary full-width right.
 */
import { Label, SearchField } from "@heroui/react";

export type CatalogSearchHeaderProps = {
  title: string;
  /** e.g. "12840 门课程" — empty while first load */
  meta?: string;
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
          <h1 className="m-0 text-lg font-bold leading-tight tracking-tight text-foreground">
            {title}
          </h1>
          {meta ? (
            <p className="m-0 mt-0.5 text-xs text-muted" aria-live="polite">
              {meta}
            </p>
          ) : null}
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
