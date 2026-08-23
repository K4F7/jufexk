/**
 * Catalog secondary filters — visually frozen: prototype D (A+C), with the
 * Issue #203 follow-ups:
 * Row 1 under search: 院系 Select (hidden when the catalog has no department
 * options) · 任课教师 ComboBox (single control: type to search all teachers,
 * pick to filter) · 排序 Select · 清空
 * Row 2: 类别 Button secondary/ghost shortcuts
 *
 * Future: 收藏 / 本专业 chips can join the category bar trailing slot
 * (not implemented this batch — do not ship disabled “即将” affordances).
 */
import {
  Button,
  ComboBox,
  Input,
  Label,
  ListBox,
  Select,
  Tag,
  TagGroup,
  type Key,
} from "@heroui/react";
import { categoryLabel } from "../lib/labels";
import type { Teacher } from "../lib/types";

const ALL_VALUE = "__all__";

const CATEGORY_OPTIONS = [
  { id: "", label: "全部" },
  { id: "major", label: "专业课" },
  { id: "public_basic", label: "公共课" },
  { id: "sports", label: "体育课" },
  { id: "english", label: "英语课" },
  { id: "ideology", label: "思政课" },
  { id: "math", label: "数学课" },
  { id: "mooc", label: "网课" },
] as const;

const SORT_OPTIONS = [
  { id: "reviews", label: "投稿数优先", defaultMark: "（默认）" },
  { id: "name", label: "课名", defaultMark: "" },
] as const;

export function isPublicCategoryFilter(value: string) {
  return CATEGORY_OPTIONS.some((opt) => opt.id !== "" && opt.id === value);
}

export type CatalogFilterTagId =
  | "query"
  | "category"
  | "department"
  | "teacher"
  | "teacherQuery";

export type CatalogActiveFilter = {
  id: CatalogFilterTagId;
  label: string;
};

/** Human-readable labels for the active filters, shared by the 当前筛选
 * chips and the empty-state copy so both name the same filters (Issue #276). */
export function catalogActiveFilters({
  queryDraft,
  category,
  departmentDraft,
  teacherId,
  teacherIdStatus,
  teacherQueryDraft,
  selectedTeacherName,
}: {
  queryDraft: string;
  category: string;
  departmentDraft: string;
  teacherId: string;
  teacherIdStatus: "pending" | "found" | "missing";
  teacherQueryDraft: string;
  selectedTeacherName?: string;
}): CatalogActiveFilter[] {
  const tags: CatalogActiveFilter[] = [];
  const query = queryDraft.trim();
  if (query) tags.push({ id: "query", label: `关键词“${query}”` });
  if (category) {
    const option = CATEGORY_OPTIONS.find((opt) => opt.id === category);
    tags.push({
      id: "category",
      label: option?.label ?? categoryLabel(category),
    });
  }
  const department = departmentDraft.trim();
  if (department) tags.push({ id: "department", label: `院系“${department}”` });
  if (teacherId) {
    tags.push({
      id: "teacher",
      label: selectedTeacherName
        ? `教师“${selectedTeacherName}”`
        : teacherIdStatus === "missing"
          ? `教师不存在（${teacherId}）`
          : "教师载入中…",
    });
  } else if (teacherQueryDraft.trim()) {
    tags.push({
      id: "teacherQuery",
      label: `教师搜索“${teacherQueryDraft.trim()}”`,
    });
  }
  return tags;
}

export type CatalogFiltersProps = {
  queryDraft: string;
  category: string;
  departmentDraft: string;
  /** Distinct non-empty departments; the selected deep-linked value is
   * merged in by the page when it is missing from the catalog list. */
  departments: string[];
  departmentsLoading: boolean;
  teacherQueryDraft: string;
  teacherId: string;
  /** Deep-linked teacher resolution: while "pending" the summary chip shows a
   *  loading label instead of the raw id; "missing" means the id does not
   *  exist (Issue #213). */
  teacherIdStatus: "pending" | "found" | "missing";
  teachers: Teacher[];
  teacherLoading: boolean;
  teacherError: string;
  sort: string;
  /** True when the result list is empty: sorting nothing reads as if the
   *  empty list had been re-ordered, so the control is disabled (Issue #278).
   *  The deep-linked sort value is kept and applies once results exist. */
  sortDisabled?: boolean;
  hasFilters: boolean;
  onCategoryChange: (value: string) => void;
  onDepartmentDraftChange: (value: string) => void;
  onTeacherQueryDraftChange: (value: string) => void;
  onTeacherIdChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onQueryClear: () => void;
  onClear: () => void;
};

export function CatalogFilters({
  queryDraft,
  category,
  departmentDraft,
  departments,
  departmentsLoading,
  teacherQueryDraft,
  teacherId,
  teacherIdStatus,
  teachers,
  teacherLoading,
  teacherError,
  sort,
  sortDisabled = false,
  hasFilters,
  onCategoryChange,
  onDepartmentDraftChange,
  onTeacherQueryDraftChange,
  onTeacherIdChange,
  onSortChange,
  onQueryClear,
  onClear,
}: CatalogFiltersProps) {
  const selectedTeacher = teachers.find((t) => String(t.id) === teacherId);
  const showDepartment = departmentsLoading || departments.length > 0;

  const handleTeacherInputChange = (value: string) => {
    onTeacherQueryDraftChange(value);
    // 选中后继续输入（含清空）视为放弃当前教师筛选。
    if (teacherId && value !== (selectedTeacher?.name ?? "")) {
      onTeacherIdChange("");
    }
  };

  const handleTeacherSelectionChange = (key: Key | null) => {
    if (key == null || String(key) === ALL_VALUE) {
      onTeacherIdChange("");
      onTeacherQueryDraftChange("");
      return;
    }
    const teacher = teachers.find((t) => String(t.id) === String(key));
    onTeacherIdChange(String(key));
    onTeacherQueryDraftChange(teacher?.name ?? "");
  };

  return (
    <>
      <div
        aria-label="课程目录筛选"
        className="-mt-1 mb-2.5 grid gap-2"
        role="search"
      >
        <div
          className={
            showDepartment
              ? "grid gap-2 sm:grid-cols-[minmax(140px,0.8fr)_minmax(200px,1.1fr)_minmax(150px,0.8fr)_auto] sm:items-end"
              : "grid gap-2 sm:grid-cols-[minmax(200px,1.1fr)_minmax(150px,0.8fr)_auto] sm:items-end"
          }
        >
          {showDepartment ? (
            <Select
              className="w-full"
              isDisabled={departmentsLoading && !departments.length}
              name="course-department"
              value={departmentDraft || ALL_VALUE}
              onChange={(value) =>
                onDepartmentDraftChange(
                  value === ALL_VALUE ? "" : String(value || ""),
                )
              }
            >
              <Label>院系</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id={ALL_VALUE} textValue="所有院系">
                    所有院系
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  {departments.map((department) => (
                    <ListBox.Item
                      key={department}
                      id={department}
                      textValue={department}
                    >
                      {department}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          ) : null}

          <ComboBox
            className="w-full"
            selectedKey={teacherId || null}
            inputValue={teacherQueryDraft}
            onInputChange={handleTeacherInputChange}
            onSelectionChange={handleTeacherSelectionChange}
            defaultFilter={() => true}
            allowsEmptyCollection
            isDisabled={!teachers.length && Boolean(teacherError)}
            name="course-teacher"
          >
            <Label>任课教师</Label>
            <ComboBox.InputGroup>
              <Input placeholder="搜索并选择任课教师" />
              <ComboBox.Trigger />
            </ComboBox.InputGroup>
            <ComboBox.Popover>
              <ListBox
                renderEmptyState={() => (
                  <div className="py-4 text-center text-sm text-muted">
                    {teacherLoading ? "搜索中…" : "没有匹配的教师"}
                  </div>
                )}
              >
                <ListBox.Item id={ALL_VALUE} textValue="所有教师">
                  所有教师
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {teachers.map((teacher) => (
                  <ListBox.Item
                    key={teacher.id}
                    id={String(teacher.id)}
                    textValue={teacher.name}
                  >
                    {teacher.name}
                    {teacher.department ? (
                      <span className="text-muted"> · {teacher.department}</span>
                    ) : null}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </ComboBox.Popover>
          </ComboBox>

          <Select
            className="w-full"
            isDisabled={sortDisabled}
            name="course-sort"
            value={sort || "reviews"}
            onChange={(value) => onSortChange(String(value || "reviews"))}
          >
            <Label>排序</Label>
            <Select.Trigger>
              <Select.Value>
                {({ selectedText }) => selectedText}
              </Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {SORT_OPTIONS.map((opt) => (
                  <ListBox.Item
                    key={opt.id}
                    id={opt.id}
                    textValue={opt.label}
                  >
                    {opt.label}
                    {opt.defaultMark}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <Button
            className="w-full sm:w-auto"
            isDisabled={!hasFilters}
            onPress={onClear}
            size="sm"
            variant="ghost"
          >
            清空筛选
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted">类别</span>
          {CATEGORY_OPTIONS.map((opt) => {
            const active = (category || "") === opt.id;
            return (
              <Button
                key={opt.id || "all"}
                size="sm"
                variant={active ? "secondary" : "ghost"}
                onPress={() => onCategoryChange(opt.id)}
              >
                {opt.label}
              </Button>
            );
          })}
        </div>
      </div>

      {hasFilters ? (
        <FilterSummary
          queryDraft={queryDraft}
          category={category}
          departmentDraft={departmentDraft}
          teacherId={teacherId}
          teacherIdStatus={teacherIdStatus}
          teacherQueryDraft={teacherQueryDraft}
          selectedTeacherName={selectedTeacher?.name}
          onRemove={(key) => {
            if (key === "query") onQueryClear();
            if (key === "category") onCategoryChange("");
            if (key === "department") onDepartmentDraftChange("");
            if (key === "teacher") {
              onTeacherIdChange("");
              onTeacherQueryDraftChange("");
            }
            if (key === "teacherQuery") onTeacherQueryDraftChange("");
          }}
        />
      ) : null}

      {teacherError ? (
        <p className="mb-2 text-sm text-muted" role="status">
          {teacherError}，可先使用关键词或院系筛选。
        </p>
      ) : null}
    </>
  );
}

function FilterSummary({
  queryDraft,
  category,
  departmentDraft,
  teacherId,
  teacherIdStatus,
  teacherQueryDraft,
  selectedTeacherName,
  onRemove,
}: {
  queryDraft: string;
  category: string;
  departmentDraft: string;
  teacherId: string;
  teacherIdStatus: "pending" | "found" | "missing";
  teacherQueryDraft: string;
  selectedTeacherName?: string;
  onRemove: (key: CatalogFilterTagId) => void;
}) {
  const tags = catalogActiveFilters({
    queryDraft,
    category,
    departmentDraft,
    teacherId,
    teacherIdStatus,
    teacherQueryDraft,
    selectedTeacherName,
  });

  if (!tags.length) return null;

  return (
    <TagGroup
      aria-label="当前筛选"
      className="mb-2"
      size="sm"
      onRemove={(keys) => {
        for (const key of keys) onRemove(String(key) as CatalogFilterTagId);
      }}
    >
      <Label>当前筛选</Label>
      <TagGroup.List>
        {tags.map((tag) => (
          <Tag key={tag.id} id={tag.id} textValue={tag.label}>
            {tag.label}
            <Tag.RemoveButton aria-label={`移除${tag.label}`} />
          </Tag>
        ))}
      </TagGroup.List>
    </TagGroup>
  );
}
