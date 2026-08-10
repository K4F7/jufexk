import {
  Button,
  Input,
  Label,
  ListBox,
  SearchField,
  Select,
  Spinner,
  Table,
} from "@heroui/react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { EmptyBox } from "../components/EmptyBox";
import { SectionHead } from "../components/SectionHead";
import { api } from "../lib/api";
import { categoryLabel, scoreText } from "../lib/labels";
import type { Course, Paginated, Teacher } from "../lib/types";

const ALL_VALUE = "__all__";
const FILTER_DELAY = 320;

export function CoursesPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const q = params.get("q") || "";
  const category = params.get("category") || "";
  const department = params.get("department") || "";
  const teacherId = params.get("teacherId") || "";
  const parsedPage = Number(params.get("page") || "1");
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [queryDraft, setQueryDraft] = useState(q);
  const [departmentDraft, setDepartmentDraft] = useState(department);
  const [teacherQueryDraft, setTeacherQueryDraft] = useState("");
  const [teacherQuery, setTeacherQuery] = useState("");
  const [data, setData] = useState<Paginated<Course> | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [error, setError] = useState("");
  const [teacherError, setTeacherError] = useState("");
  const [loading, setLoading] = useState(true);
  const [teacherLoading, setTeacherLoading] = useState(true);

  useEffect(() => setQueryDraft(q), [q]);
  useEffect(() => setDepartmentDraft(department), [department]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setTeacherQuery(teacherQueryDraft.trim()),
      FILTER_DELAY,
    );
    return () => window.clearTimeout(timer);
  }, [teacherQueryDraft]);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (category) sp.set("category", category);
    if (department) sp.set("department", department);
    if (teacherId) sp.set("teacherId", teacherId);
    sp.set("page", String(page));
    return sp.toString();
  }, [q, category, department, teacherId, page]);

  useEffect(() => {
    const nextQ = queryDraft.trim();
    const nextDepartment = departmentDraft.trim();
    if (nextQ === q && nextDepartment === department) return;

    const timer = window.setTimeout(() => {
      const sp = new URLSearchParams(params);
      if (nextQ) sp.set("q", nextQ);
      else sp.delete("q");
      if (nextDepartment) sp.set("department", nextDepartment);
      else sp.delete("department");
      sp.set("page", "1");
      setParams(sp, { replace: true });
    }, FILTER_DELAY);

    return () => window.clearTimeout(timer);
  }, [queryDraft, departmentDraft, q, department, params, setParams]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setLoading(true);
    setError("");
    api<Paginated<Course>>(`/api/courses?${queryString}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError((reason as Error).message || "课程目录加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [queryString]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const query = new URLSearchParams({ page: "1", pageSize: "50" });
    if (teacherQuery) query.set("q", teacherQuery);

    setTeacherLoading(true);
    setTeacherError("");
    api<Paginated<Teacher>>(`/api/teachers?${query}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) setTeachers(result.items);
      })
      .catch((reason) => {
        if (!cancelled) {
          setTeacherError((reason as Error).message || "教师筛选暂时不可用");
        }
      })
      .finally(() => {
        if (!cancelled) setTeacherLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [teacherQuery]);

  function update(next: Record<string, string>, replace = false) {
    const sp = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (!value) sp.delete(key);
      else sp.set(key, value);
    }
    if (!("page" in next)) sp.set("page", "1");
    setParams(sp, { replace });
  }

  const hasFilters = Boolean(
    queryDraft.trim() ||
      q ||
      category ||
      departmentDraft.trim() ||
      department ||
      teacherId ||
      teacherQueryDraft.trim() ||
      teacherQuery,
  );
  const currentPage = data?.pages ? Math.min(data.page, data.pages) : 1;
  const totalPages = data?.pages || 1;

  function clearFilters() {
    setQueryDraft("");
    setDepartmentDraft("");
    setTeacherQueryDraft("");
    update(
      { q: "", category: "", department: "", teacherId: "", page: "1" },
      true,
    );
  }

  return (
    <section>
      <div
        aria-label="课程目录筛选"
        className="mb-2.5 grid gap-2 sm:grid-cols-[minmax(220px,1fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)_minmax(190px,0.9fr)_minmax(190px,0.9fr)_auto] sm:items-end"
        role="search"
      >
        <SearchField
          fullWidth
          name="course-search"
          value={queryDraft}
          onChange={setQueryDraft}
        >
          <Label className="sr-only">搜索课程</Label>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input
              className="w-full"
              placeholder="搜索课程、课号或教师"
            />
            <SearchField.ClearButton aria-label="清空课程搜索" />
          </SearchField.Group>
        </SearchField>

        <Select
          className="w-full"
          name="course-category"
          value={category || ALL_VALUE}
          onChange={(value) =>
            update({ category: value === ALL_VALUE ? "" : String(value || "") })
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
              <ListBox.Item id="general" textValue="公共选修">
                公共选修
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>

        <Input
          aria-label="按院系筛选"
          className="w-full"
          placeholder="院系"
          value={departmentDraft}
          onChange={(event) => setDepartmentDraft(event.target.value)}
        />

        <SearchField
          fullWidth
          name="teacher-search"
          value={teacherQueryDraft}
          onChange={setTeacherQueryDraft}
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
          isDisabled={teacherLoading || (!teachers.length && Boolean(teacherError))}
          name="course-teacher"
          value={teacherId || ALL_VALUE}
          onChange={(value) =>
            update({ teacherId: value === ALL_VALUE ? "" : String(value || "") })
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
          onPress={clearFilters}
          size="sm"
          variant="ghost"
        >
          清空筛选
        </Button>
      </div>

      {hasFilters ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>当前筛选：</span>
          {queryDraft.trim() ? <span>关键词“{queryDraft.trim()}”</span> : null}
          {category ? <span>{categoryLabel(category)}</span> : null}
          {departmentDraft.trim() ? (
            <span>院系“{departmentDraft.trim()}”</span>
          ) : null}
          {teacherQueryDraft.trim() ? (
            <span>教师搜索“{teacherQueryDraft.trim()}”</span>
          ) : null}
          {teacherId
            ? (() => {
                const teacher = teachers.find(
                  (item) => String(item.id) === teacherId,
                );
                return <span>教师“{teacher?.name || teacherId}”</span>;
              })()
            : null}
        </div>
      ) : null}

      <SectionHead title="课程目录" meta={data ? `${data.total} 门课程` : ""} />

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
      {error ? <EmptyBox role="alert">{error}</EmptyBox> : null}
      {loading && !data ? <EmptyBox role="status">加载中…</EmptyBox> : null}
      {loading && data ? (
        <div
          aria-live="polite"
          className="mb-2 flex items-center gap-2 text-sm text-muted"
          role="status"
        >
          <Spinner size="sm" />
          正在更新课程目录…
        </div>
      ) : null}

      {data ? (
        <div aria-busy={loading}>
          <Table className="dense-table">
            <Table.ScrollContainer>
              <Table.Content aria-label="课程目录" className="min-w-[860px]">
                <Table.Header>
                  <Table.Column isRowHeader>课号</Table.Column>
                  <Table.Column>课程</Table.Column>
                  <Table.Column>类别</Table.Column>
                  <Table.Column>教师</Table.Column>
                  <Table.Column>院系</Table.Column>
                  <Table.Column>评分</Table.Column>
                  <Table.Column>评价</Table.Column>
                </Table.Header>
                <Table.Body
                  items={data.items}
                  renderEmptyState={() => (
                    <div className="py-8 text-center text-muted" role="status">
                      {q ? `没有找到匹配“${q}”的课程` : "没有课程数据"}
                    </div>
                  )}
                >
                  {(course) => (
                    <Table.Row
                      id={String(course.id)}
                      key={course.id}
                      href={`/courses/${course.id}${location.search}`}
                      className="cursor-pointer"
                    >
                      <Table.Cell>
                        <span className="tabular text-[13px] text-muted">
                          {course.code}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="font-semibold">{course.name}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="text-[13px] text-muted">
                          {categoryLabel(course.category)}
                        </span>
                      </Table.Cell>
                      <Table.Cell>{course.teachers || "待补充"}</Table.Cell>
                      <Table.Cell>
                        <span className="text-muted">{course.department}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="tabular font-semibold text-accent">
                          {scoreText(course.rating)}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="tabular font-semibold text-accent">
                          {course.review_count}
                        </span>
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>

          <div className="mt-3 flex items-center justify-center gap-3 text-[13px] text-muted">
            <Button
              size="sm"
              variant="outline"
              isDisabled={loading || currentPage <= 1}
              onPress={() => update({ page: String(currentPage - 1) })}
            >
              上一页
            </Button>
            <span aria-live="polite">
              {currentPage}/{totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              isDisabled={loading || currentPage >= totalPages}
              onPress={() => update({ page: String(currentPage + 1) })}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
