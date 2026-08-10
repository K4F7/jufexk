/**
 * PROTOTYPE — catalog-filters variants (throwaway; not production-ready).
 *
 * Question: 筛选条件的布局与主操作路径？
 *
 * 主搜索已冻结为 catalog-search C，本模块只改类别 / 院系 / 教师 / 清空。
 * 官方优先：Select · Input · SearchField · Button（类别快捷用 Button secondary/ghost）。
 *
 * A — 单行高密度：类别 Select + 院系 + 教师搜索 + 教师 Select + 清空，同一行
 * B — 左侧筛选栏：条件垂直左侧，结果区在右
 * C — 分层：类别 Button 快捷条在上；院系/教师收进「高级筛选」
 * D — A+C 组合：院系/教师行紧贴搜索框；类别 Button 快捷条在其下 — **视觉冻结胜出**
 *     生产：`src/components/CatalogFilters.tsx`（无 disabled「即将」按钮）
 *     后续「收藏本专业课程/教师」本批不做实现
 *
 * Mounted via CoursesPage when ?module=catalog-filters&variant=A|B|C|D (DEV only).
 */
import {
  Button,
  Input,
  Label,
  ListBox,
  SearchField,
  Select,
} from "@heroui/react";
import { useState, type ReactNode } from "react";
import { categoryLabel } from "../lib/labels";
import type { Teacher } from "../lib/types";

export type CatalogFiltersVariantKey = "A" | "B" | "C" | "D";

const KEYS: CatalogFiltersVariantKey[] = ["A", "B", "C", "D"];

export function isCatalogFiltersVariantKey(
  key: string,
): key is CatalogFiltersVariantKey {
  return (KEYS as string[]).includes(key);
}

const ALL_VALUE = "__all__";

const CATEGORY_OPTIONS = [
  { id: "", label: "全部" },
  { id: "major", label: "专业课" },
  { id: "pe", label: "体育课" },
  { id: "sports", label: "体育课（sports）" },
  { id: "general", label: "公共选修" },
] as const;

export type CatalogFiltersModel = {
  queryDraft: string;
  category: string;
  departmentDraft: string;
  teacherQueryDraft: string;
  teacherId: string;
  teachers: Teacher[];
  teacherLoading: boolean;
  teacherError: string;
  teacherQuery: string;
  hasFilters: boolean;
  setCategory: (value: string) => void;
  setDepartmentDraft: (value: string) => void;
  setTeacherQueryDraft: (value: string) => void;
  setTeacherId: (value: string) => void;
  clearFilters: () => void;
};

function CategorySelect({
  category,
  setCategory,
  className,
}: {
  category: string;
  setCategory: (value: string) => void;
  className?: string;
}) {
  return (
    <Select
      className={className ?? "w-full"}
      name="course-category"
      value={category || ALL_VALUE}
      onChange={(value) =>
        setCategory(value === ALL_VALUE ? "" : String(value || ""))
      }
    >
      <Label>课程类型</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id={ALL_VALUE} textValue="所有课程">
            所有课程
            <ListBox.ItemIndicator />
          </ListBox.Item>
          <ListBox.Item id="major" textValue="专业课">
            专业课
            <ListBox.ItemIndicator />
          </ListBox.Item>
          <ListBox.Item id="pe" textValue="体育课">
            体育课
            <ListBox.ItemIndicator />
          </ListBox.Item>
          <ListBox.Item id="sports" textValue="体育课（远端枚举）">
            体育课（sports）
            <ListBox.ItemIndicator />
          </ListBox.Item>
          <ListBox.Item id="general" textValue="公共选修">
            公共选修
            <ListBox.ItemIndicator />
          </ListBox.Item>
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function DepartmentInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      aria-label="按院系筛选"
      className="w-full"
      placeholder="院系"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function TeacherSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <SearchField fullWidth name="teacher-search" value={value} onChange={onChange}>
      <Label className="sr-only">搜索任课教师</Label>
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input
          className="w-full"
          placeholder="搜索任课教师姓名或院系"
        />
        <SearchField.ClearButton aria-label="清空教师搜索" />
      </SearchField.Group>
    </SearchField>
  );
}

function TeacherSelect({
  model,
}: {
  model: CatalogFiltersModel;
}) {
  const {
    teachers,
    teacherId,
    teacherLoading,
    teacherError,
    setTeacherId,
  } = model;
  return (
    <Select
      className="w-full"
      isDisabled={teacherLoading || (!teachers.length && Boolean(teacherError))}
      name="course-teacher"
      value={teacherId || ALL_VALUE}
      onChange={(value) =>
        setTeacherId(value === ALL_VALUE ? "" : String(value || ""))
      }
    >
      <Label>任课教师</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id={ALL_VALUE} textValue="所有教师">
            所有教师
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {teachers.map((teacher) => (
            <ListBox.Item
              key={teacher.id}
              id={String(teacher.id)}
              textValue={`${teacher.name} ${teacher.department}`}
            >
              {teacher.name} · {teacher.department}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function ClearButton({
  model,
  className,
}: {
  model: CatalogFiltersModel;
  className?: string;
}) {
  return (
    <Button
      className={className ?? "w-full sm:w-auto"}
      isDisabled={!model.hasFilters}
      onPress={model.clearFilters}
      size="sm"
      variant="ghost"
    >
      清空筛选
    </Button>
  );
}

function ActiveFilterSummary({ model }: { model: CatalogFiltersModel }) {
  if (!model.hasFilters) return null;
  const teacher = model.teachers.find(
    (item) => String(item.id) === model.teacherId,
  );
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <span>当前筛选：</span>
      {model.queryDraft.trim() ? (
        <span>关键词“{model.queryDraft.trim()}”</span>
      ) : null}
      {model.category ? <span>{categoryLabel(model.category)}</span> : null}
      {model.departmentDraft.trim() ? (
        <span>院系“{model.departmentDraft.trim()}”</span>
      ) : null}
      {model.teacherQueryDraft.trim() ? (
        <span>教师搜索“{model.teacherQueryDraft.trim()}”</span>
      ) : null}
      {model.teacherId ? (
        <span>教师“{teacher?.name || model.teacherId}”</span>
      ) : null}
    </div>
  );
}

function TeacherHints({ model }: { model: CatalogFiltersModel }) {
  return (
    <>
      {model.teacherError ? (
        <p className="mb-2 text-sm text-muted" role="status">
          {model.teacherError}，可先使用关键词或院系筛选。
        </p>
      ) : null}
      {!model.teacherError &&
      !model.teacherQuery &&
      model.teachers.length >= 50 ? (
        <p className="mb-2 text-sm text-muted" role="status">
          教师筛选默认显示前 50 位，请输入姓名或院系搜索更多教师。
        </p>
      ) : null}
    </>
  );
}

/** A — single dense toolbar row */
function FiltersA({ model }: { model: CatalogFiltersModel }) {
  return (
    <div
      aria-label="课程目录筛选"
      className="mb-2.5 grid gap-2 sm:grid-cols-[minmax(150px,0.7fr)_minmax(150px,0.7fr)_minmax(190px,0.9fr)_minmax(190px,0.9fr)_auto] sm:items-end"
      role="search"
    >
      <CategorySelect category={model.category} setCategory={model.setCategory} />
      <DepartmentInput
        value={model.departmentDraft}
        onChange={model.setDepartmentDraft}
      />
      <TeacherSearch
        value={model.teacherQueryDraft}
        onChange={model.setTeacherQueryDraft}
      />
      <TeacherSelect model={model} />
      <ClearButton model={model} />
    </div>
  );
}

/** B — left sidebar stack */
function FiltersB({ model }: { model: CatalogFiltersModel }) {
  return (
    <div
      aria-label="课程目录筛选"
      className="flex flex-col gap-3"
      role="search"
    >
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-muted">
        筛选
      </p>
      <CategorySelect category={model.category} setCategory={model.setCategory} />
      <div className="grid gap-1">
        <Label className="text-sm">院系</Label>
        <DepartmentInput
          value={model.departmentDraft}
          onChange={model.setDepartmentDraft}
        />
      </div>
      <TeacherSearch
        value={model.teacherQueryDraft}
        onChange={model.setTeacherQueryDraft}
      />
      <TeacherSelect model={model} />
      <ClearButton model={model} className="w-full" />
    </div>
  );
}

function CategoryQuickBar({
  category,
  setCategory,
  trailing,
}: {
  category: string;
  setCategory: (value: string) => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted">类别</span>
      {CATEGORY_OPTIONS.map((opt) => {
        const active = (category || "") === opt.id;
        return (
          <Button
            key={opt.id || "all"}
            size="sm"
            variant={active ? "secondary" : "ghost"}
            onPress={() => setCategory(opt.id)}
          >
            {opt.label}
          </Button>
        );
      })}
      {trailing ? (
        <>
          <div className="flex-1" />
          {trailing}
        </>
      ) : null}
    </div>
  );
}

/** C — category chip row + advanced disclosure */
function FiltersC({ model }: { model: CatalogFiltersModel }) {
  const advancedOpen =
    Boolean(model.departmentDraft.trim()) ||
    Boolean(model.teacherQueryDraft.trim()) ||
    Boolean(model.teacherId);
  const [open, setOpen] = useState(advancedOpen);

  return (
    <div aria-label="课程目录筛选" className="mb-2.5 grid gap-2" role="search">
      <CategoryQuickBar
        category={model.category}
        setCategory={model.setCategory}
        trailing={
          <>
            <Button
              size="sm"
              variant="tertiary"
              onPress={() => setOpen((v) => !v)}
            >
              {open ? "收起高级" : "高级筛选"}
            </Button>
            <ClearButton model={model} className="w-auto" />
          </>
        }
      />

      {open ? (
        <div className="grid gap-2 rounded-2xl border border-border bg-surface p-3 sm:grid-cols-[minmax(160px,1fr)_minmax(180px,1.1fr)_minmax(180px,1.1fr)] sm:items-end">
          <div className="grid gap-1">
            <Label className="text-sm">院系</Label>
            <DepartmentInput
              value={model.departmentDraft}
              onChange={model.setDepartmentDraft}
            />
          </div>
          <TeacherSearch
            value={model.teacherQueryDraft}
            onChange={model.setTeacherQueryDraft}
          />
          <TeacherSelect model={model} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * D — A+C hybrid: dense dept/teacher row first (tucks under catalog search),
 * then category Button bar below. Placeholder for future 收藏 / 本专业.
 */
function FiltersD({ model }: { model: CatalogFiltersModel }) {
  return (
    <div
      aria-label="课程目录筛选"
      className="-mt-1 mb-2.5 grid gap-2"
      role="search"
    >
      {/* Row 1: sits tight under CatalogSearchHeader search field */}
      <div className="grid gap-2 sm:grid-cols-[minmax(150px,0.8fr)_minmax(190px,1fr)_minmax(190px,1fr)_auto] sm:items-end">
        <div className="grid gap-1">
          <Label className="text-sm">院系</Label>
          <DepartmentInput
            value={model.departmentDraft}
            onChange={model.setDepartmentDraft}
          />
        </div>
        <TeacherSearch
          value={model.teacherQueryDraft}
          onChange={model.setTeacherQueryDraft}
        />
        <TeacherSelect model={model} />
        <ClearButton model={model} className="w-full sm:w-auto" />
      </div>
      {/* Row 2: category shortcuts below secondary filters */}
      <CategoryQuickBar
        category={model.category}
        setCategory={model.setCategory}
        trailing={
          /* Future: 收藏课程 · 收藏教师 · 本专业 — local/account, not this batch */
          <Button size="sm" variant="ghost" isDisabled>
            收藏（即将）
          </Button>
        }
      />
    </div>
  );
}

export function CatalogFiltersPrototype({
  variant,
  model,
  children,
}: {
  variant: CatalogFiltersVariantKey;
  model: CatalogFiltersModel;
  children: ReactNode;
}) {
  if (variant === "B") {
    return (
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 rounded-2xl border border-border bg-surface p-3 lg:sticky lg:top-16 lg:w-56">
          <FiltersB model={model} />
        </aside>
        <div className="min-w-0 flex-1">
          <ActiveFilterSummary model={model} />
          <TeacherHints model={model} />
          {children}
        </div>
      </div>
    );
  }

  const filters =
    variant === "A" ? (
      <FiltersA model={model} />
    ) : variant === "C" ? (
      <FiltersC model={model} />
    ) : (
      <FiltersD model={model} />
    );

  return (
    <>
      {filters}
      <ActiveFilterSummary model={model} />
      <TeacherHints model={model} />
      {children}
    </>
  );
}
