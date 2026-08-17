/**
 * Catalog secondary filters — visually frozen: prototype D (A+C).
 * Row 1 under search: 院系 · 教师搜索 · 教师 Select · 清空
 * Row 2: 类别 Button secondary/ghost shortcuts
 *
 * Future: 收藏 / 本专业 chips can join the category bar trailing slot
 * (not implemented this batch — do not ship disabled “即将” affordances).
 */
import {
  Button,
  Input,
  Label,
  ListBox,
  SearchField,
  Select,
} from "@heroui/react";
import { categoryLabel } from "../lib/labels";
import type { Teacher } from "../lib/types";

const ALL_VALUE = "__all__";

const CATEGORY_OPTIONS = [
  { id: "", label: "全部" },
  { id: "sports", label: "体育课" },
] as const;

export function isPublicCategoryFilter(value: string) {
  return CATEGORY_OPTIONS.some((opt) => opt.id !== "" && opt.id === value);
}

export type CatalogFiltersProps = {
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
  onCategoryChange: (value: string) => void;
  onDepartmentDraftChange: (value: string) => void;
  onTeacherQueryDraftChange: (value: string) => void;
  onTeacherIdChange: (value: string) => void;
  onClear: () => void;
};

export function CatalogFilters({
  queryDraft,
  category,
  departmentDraft,
  teacherQueryDraft,
  teacherId,
  teachers,
  teacherLoading,
  teacherError,
  teacherQuery,
  hasFilters,
  onCategoryChange,
  onDepartmentDraftChange,
  onTeacherQueryDraftChange,
  onTeacherIdChange,
  onClear,
}: CatalogFiltersProps) {
  const selectedTeacher = teachers.find((t) => String(t.id) === teacherId);

  return (
    <>
      <div
        aria-label="课程目录筛选"
        className="-mt-1 mb-2.5 grid gap-2"
        role="search"
      >
        <div className="grid gap-2 sm:grid-cols-[minmax(150px,0.8fr)_minmax(190px,1fr)_minmax(190px,1fr)_auto] sm:items-end">
          <div className="grid gap-1">
            <Label className="text-sm">院系</Label>
            <Input
              aria-label="按院系筛选"
              className="w-full"
              placeholder="院系"
              value={departmentDraft}
              onChange={(event) => onDepartmentDraftChange(event.target.value)}
            />
          </div>

          <SearchField
            fullWidth
            name="teacher-search"
            value={teacherQueryDraft}
            onChange={onTeacherQueryDraftChange}
          >
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

          <Select
            className="w-full"
            isDisabled={
              teacherLoading || (!teachers.length && Boolean(teacherError))
            }
            name="course-teacher"
            value={teacherId || ALL_VALUE}
            onChange={(value) =>
              onTeacherIdChange(
                value === ALL_VALUE ? "" : String(value || ""),
              )
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
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>当前筛选：</span>
          {queryDraft.trim() ? (
            <span>关键词“{queryDraft.trim()}”</span>
          ) : null}
          {category ? <span>{categoryLabel(category)}</span> : null}
          {departmentDraft.trim() ? (
            <span>院系“{departmentDraft.trim()}”</span>
          ) : null}
          {teacherQueryDraft.trim() ? (
            <span>教师搜索“{teacherQueryDraft.trim()}”</span>
          ) : null}
          {teacherId ? (
            <span>教师“{selectedTeacher?.name || teacherId}”</span>
          ) : null}
        </div>
      ) : null}

      {teacherError ? (
        <p className="mb-2 text-sm text-muted" role="status">
          {teacherError}，可先使用关键词或院系筛选。
        </p>
      ) : null}
      {!teacherError && !teacherQuery && teachers.length >= 50 ? (
        <p className="mb-2 text-sm text-muted" role="status">
          教师筛选默认显示前 50 位，请输入姓名或院系搜索更多教师。
        </p>
      ) : null}
    </>
  );
}
