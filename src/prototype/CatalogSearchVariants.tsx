/**
 * PROTOTYPE — catalog-search variants (throwaway; not production-ready).
 *
 * Question: 课程目录标题与搜索的信息层级？
 *
 * 只比较标题 + 主搜索的结构/层级；类别/院系/教师筛选留给 catalog-filters。
 * 官方优先：HeroUI SearchField（primary / secondary）+ Label / Description / Surface。
 *
 * A — 标题优先工具头：h1 课程目录 + 计数在上，搜索在下（primary）
 * B — 搜索优先：宽搜索为第一操作（primary + Description），标题降为辅助行
 * C — 同行工具条：标题与 secondary SearchField 同一行（紧凑）— **视觉冻结胜出**
 *
 * 生产 Default：`src/components/CatalogSearchHeader.tsx` 对齐 C。
 * Mounted via CoursesPage when ?module=catalog-search&variant=A|B|C (DEV only).
 */
import { Description, Label, SearchField, Surface } from "@heroui/react";

export type CatalogSearchVariantKey = "A" | "B" | "C";

const KEYS: CatalogSearchVariantKey[] = ["A", "B", "C"];

export function isCatalogSearchVariantKey(
  key: string,
): key is CatalogSearchVariantKey {
  return (KEYS as string[]).includes(key);
}

export type CatalogSearchProps = {
  variant: CatalogSearchVariantKey;
  value: string;
  onChange: (value: string) => void;
  /** e.g. "12840 门课程" — empty while loading first page */
  meta?: string;
};

const PLACEHOLDER = "搜索课程、课号或教师";

function SearchControl({
  value,
  onChange,
  variant,
  fullWidth = true,
  showLabel = true,
  showDescription = false,
}: {
  value: string;
  onChange: (value: string) => void;
  variant: "primary" | "secondary";
  fullWidth?: boolean;
  showLabel?: boolean;
  showDescription?: boolean;
}) {
  return (
    <SearchField
      fullWidth={fullWidth}
      name="course-search"
      value={value}
      variant={variant}
      onChange={onChange}
    >
      <Label className={showLabel ? undefined : "sr-only"}>搜索课程</Label>
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input className="w-full" placeholder={PLACEHOLDER} />
        <SearchField.ClearButton aria-label="清空课程搜索" />
      </SearchField.Group>
      {showDescription ? (
        <Description>匹配课程名、课号或任课教师名</Description>
      ) : null}
    </SearchField>
  );
}

/** A — title-first tool header */
function VariantA({ value, onChange, meta }: Omit<CatalogSearchProps, "variant">) {
  return (
    <header className="mb-3" aria-label="目录标题与搜索">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h1 className="m-0 text-xl font-bold tracking-tight text-foreground">
          课程目录
        </h1>
        {meta ? (
          <span className="shrink-0 text-sm text-muted" aria-live="polite">
            {meta}
          </span>
        ) : null}
      </div>
      <SearchControl value={value} onChange={onChange} variant="primary" />
    </header>
  );
}

/** B — search-first hierarchy */
function VariantB({ value, onChange, meta }: Omit<CatalogSearchProps, "variant">) {
  return (
    <header className="mb-3" aria-label="目录标题与搜索">
      <Surface
        className="rounded-3xl border border-border p-4 sm:p-5"
        variant="default"
      >
        <SearchControl
          value={value}
          onChange={onChange}
          variant="primary"
          showDescription
        />
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-separator pt-3">
          <p className="m-0 text-sm text-muted">
            <span className="font-semibold text-foreground">课程目录</span>
            <span className="mx-1.5 text-border" aria-hidden>
              ·
            </span>
            按投稿与课程名排序
          </p>
          {meta ? (
            <span className="shrink-0 text-sm tabular text-muted" aria-live="polite">
              {meta}
            </span>
          ) : null}
        </div>
      </Surface>
    </header>
  );
}

/** C — title + search on one dense toolbar row */
function VariantC({ value, onChange, meta }: Omit<CatalogSearchProps, "variant">) {
  return (
    <header className="mb-3" aria-label="目录标题与搜索">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 sm:flex-nowrap">
        <div className="min-w-0 shrink-0">
          <h1 className="m-0 text-lg font-bold leading-tight tracking-tight text-foreground">
            课程目录
          </h1>
          {meta ? (
            <p className="m-0 mt-0.5 text-xs text-muted" aria-live="polite">
              {meta}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 flex-1 basis-[min(100%,18rem)]">
          <SearchControl
            value={value}
            onChange={onChange}
            variant="secondary"
            showLabel={false}
          />
        </div>
      </div>
    </header>
  );
}

export function CatalogSearchHeader(props: CatalogSearchProps) {
  switch (props.variant) {
    case "A":
      return <VariantA {...props} />;
    case "B":
      return <VariantB {...props} />;
    case "C":
      return <VariantC {...props} />;
  }
}
