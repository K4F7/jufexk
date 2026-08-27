/**
 * Catalog title + primary search — visually frozen: prototype C (同行工具条).
 * Title left · count under title · HeroUI SearchField nested in Autocomplete.
 */
import {
  Autocomplete,
  Description,
  EmptyState,
  Label,
  ListBox,
  SearchField,
  Skeleton,
  Typography,
} from "@heroui/react";
import { useState } from "react";
import { shouldOpenCatalogSuggestions } from "../lib/catalog-search-suggest";

export type CatalogSearchSuggestion = {
  id: string;
  title: string;
  detail?: string;
  kind?: "strict" | "fuzzy";
};

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
  suggestions?: CatalogSearchSuggestion[];
  suggestionsReady?: boolean;
  suggestionsFailed?: boolean;
  onSelectSuggestion?: (title: string) => void;
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
  suggestions = [],
  suggestionsReady = false,
  suggestionsFailed = false,
  onSelectSuggestion,
}: CatalogSearchHeaderProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = shouldOpenCatalogSuggestions({
    focused: searchFocused,
    query: value,
    ready: suggestionsReady,
    failed: suggestionsFailed,
    dismissed,
  });

  function chooseSuggestion(key: string | number | bigint) {
    const selected = suggestions.find((item) => item.id === String(key));
    if (selected) onSelectSuggestion?.(selected.title);
  }

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
          <Autocomplete
            allowsEmptyCollection
            fullWidth
            variant="secondary"
            selectionMode="single"
            value={null}
            isOpen={open}
            onOpenChange={(next) => {
              if (!next) setDismissed(true);
            }}
            onChange={(key) => {
              const selectedKey = Array.isArray(key) ? key[0] : key;
              if (selectedKey == null) return;
              chooseSuggestion(selectedKey);
            }}
          >
            <Label className="sr-only">{searchLabel}</Label>
            <Autocomplete.Filter
              filter={() => true}
              inputValue={value}
              onInputChange={(next) => {
                onChange(next);
                setDismissed(false);
                setSearchFocused(true);
              }}
            >
              <SearchField fullWidth name={name} variant="secondary">
                <Label className="sr-only">{searchLabel}</Label>
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    className="w-full"
                    placeholder={placeholder}
                    onFocus={() => setSearchFocused(true)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setDismissed(true);
                    }}
                  />
                  <SearchField.ClearButton aria-label={clearAriaLabel} />
                </SearchField.Group>
              </SearchField>
              <Autocomplete.Popover>
                <ListBox
                  renderEmptyState={() => (
                    <EmptyState>没有匹配的建议</EmptyState>
                  )}
                  onAction={(key) => chooseSuggestion(key)}
                >
                  {suggestions.map((item) => (
                    <ListBox.Item
                      key={item.id}
                      id={item.id}
                      textValue={item.title}
                    >
                      <Label>
                        {item.kind === "fuzzy" ? `可能是：${item.title}` : item.title}
                      </Label>
                      {item.detail ? (
                        <Description>{item.detail}</Description>
                      ) : null}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Autocomplete.Popover>
            </Autocomplete.Filter>
          </Autocomplete>
        </div>
      </div>
    </header>
  );
}
