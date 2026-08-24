/**
 * 排课模拟 /schedule：从公开任课关系检索课程×教师，本机编排周课表并标冲突。
 * 不做开课班目录或教务课表镜像（Issue #486）。
 * 本科教务导入只在学生浏览器读表，Cookie 不进本站（Issue #488）。
 * 访客可看课表；加入、排上、导入需登录（Issue #494）。
 */
import {
  Alert,
  Button,
  Card,
  Label,
  ListBox,
  SearchField,
  Select,
  Typography,
} from "@heroui/react";
import { useEffect, useMemo, useState } from "react";
import { relationDetailHref } from "../components/CourseRelationRow";
import { DetailErrorAlert } from "../components/DetailFeedback";
import { JwxtScheduleImport } from "../components/JwxtScheduleImport";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { ScheduleTimetable } from "../components/ScheduleTimetable";
import { Stars } from "../components/Stars";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";
import {
  mergeImportedCourses,
  stagedCoursesFromJwxtImport,
} from "../lib/jwxt-schedule-import";
import {
  readJwxtImportHash,
  stashPendingJwxtImport,
  takePendingJwxtImport,
  type JwxtImportRow,
} from "../lib/jwxt-schedule-text";
import {
  conflictMessage,
  defaultWeeks,
  formatSlotLabel,
  JUFE_PERIODS,
  listConflicts,
  loadSchedulePlan,
  normalizeSlot,
  saveSchedulePlan,
  slotIdFor,
  stagedCourseId,
  stagedCourseName,
  WEEKDAYS,
  type StagedCourse,
} from "../lib/schedule-plan";
import type { CourseRelation, Paginated } from "../lib/types";

function PeriodSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      className="min-w-28"
      variant="secondary"
      value={value}
      onChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {JUFE_PERIODS.map((period) => (
            <ListBox.Item
              key={period.period}
              id={String(period.period)}
              textValue={`第${period.period}节`}
            >
              第{period.period}节
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function StagedCourseCard({
  course,
  canEdit,
  onAddSlot,
  onRemoveSlot,
  onRemove,
}: {
  course: StagedCourse;
  canEdit: boolean;
  onAddSlot: (weekday: number, startPeriod: number, endPeriod: number) => void;
  onRemoveSlot: (slotId: string) => void;
  onRemove: () => void;
}) {
  const [weekday, setWeekday] = useState("1");
  const [startPeriod, setStartPeriod] = useState("1");
  const [endPeriod, setEndPeriod] = useState("2");
  const title = stagedCourseName(course);
  const href =
    course.courseId > 0
      ? relationDetailHref({
          course_id: course.courseId,
          teacher_id: course.teacherId,
        })
      : "";

  return (
    <Card className="mb-3">
      <Card.Header>
        <Card.Title className="text-base">
          {href ? (
            <RouterAriaLink className="text-accent" to={href}>
              {title}
            </RouterAriaLink>
          ) : (
            title
          )}
        </Card.Title>
        <Card.Description>
          {course.courseCode}
          {course.reviewCount > 0
            ? ` · ${course.reviewCount} 条评价`
            : " · 暂无评价"}
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Select
            className="min-w-24"
            variant="secondary"
            value={weekday}
            onChange={(next) => {
              if (typeof next === "string") setWeekday(next);
            }}
          >
            <Label>星期</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {WEEKDAYS.map((day) => (
                  <ListBox.Item key={day.day} id={String(day.day)} textValue={day.label}>
                    {day.label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <PeriodSelect
            label="开始节次"
            value={startPeriod}
            onChange={setStartPeriod}
          />
          <PeriodSelect
            label="结束节次"
            value={endPeriod}
            onChange={setEndPeriod}
          />
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              if (!canEdit) return;
              onAddSlot(Number(weekday), Number(startPeriod), Number(endPeriod));
            }}
          >
            排上
          </Button>
        </div>
        {course.slots.length > 0 ? (
          <ul className="m-0 list-none space-y-1 p-0 text-sm">
            {course.slots.map((slot) => (
              <li key={slot.id} className="flex items-center justify-between gap-2">
                <span>{formatSlotLabel(slot)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => {
                    if (!canEdit) return;
                    onRemoveSlot(slot.id);
                  }}
                >
                  移除时段
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-muted">
            选择星期和节次后点「排上」。未改时是周一第1–2节。
          </p>
        )}
      </Card.Content>
      <Card.Footer>
        <Button
          size="sm"
          variant="danger"
          onPress={() => {
            if (!canEdit) return;
            onRemove();
          }}
        >
          移出课表
        </Button>
      </Card.Footer>
    </Card>
  );
}

export function SchedulePage() {
  const { viewer, ready } = useViewer();
  const canEdit = viewer.authenticated;
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [results, setResults] = useState<CourseRelation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [courses, setCourses] = useState<StagedCourse[]>(() => loadSchedulePlan());
  const [importNotice, setImportNotice] = useState("");

  useEffect(() => {
    saveSchedulePlan(courses);
  }, [courses]);

  async function applyJwxtImport(rows: JwxtImportRow[]) {
    const names = [...new Set(rows.map((row) => row.courseName).filter(Boolean))];
    const relations: CourseRelation[] = [];
    for (const name of names) {
      try {
        const page = await api<Paginated<CourseRelation>>(
          `/api/courses?view=relations&q=${encodeURIComponent(name)}&page=1&pageSize=20`,
        );
        relations.push(...page.items);
      } catch {
        // 对不上公开目录时仍写入本机条目。
      }
    }
    const { courses: incoming, skipped } = stagedCoursesFromJwxtImport(rows, relations);
    if (incoming.length === 0) {
      setImportNotice("没有解析到可排的上课时间。");
      return;
    }
    setCourses((current) => mergeImportedCourses(current, incoming));
    setImportNotice(
      skipped
        ? `已导入 ${incoming.length} 门课，另有 ${skipped} 行没有可识别的上课时间。`
        : `已从本科教务导入 ${incoming.length} 门课。Cookie 没有离开你的浏览器。`,
    );
  }

  useEffect(() => {
    const payload = readJwxtImportHash(window.location.hash);
    if (!payload) return;
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    stashPendingJwxtImport(payload);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const pending = takePendingJwxtImport();
    if (!pending) return;
    if (!viewer.authenticated) {
      stashPendingJwxtImport(pending);
      return;
    }
    void applyJwxtImport(pending.rows);
  }, [ready, viewer.authenticated]);

  useEffect(() => {
    const q = submitted.trim();
    if (!q) {
      setResults([]);
      setError("");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      view: "relations",
      q,
      page: "1",
      pageSize: "20",
    });
    api<Paginated<CourseRelation>>(`/api/courses?${params}`, {
      signal: controller.signal,
    })
      .then((page) => {
        if (!cancelled) setResults(page.items);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError((reason as Error).message || "课程搜索失败");
          setResults([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [submitted]);

  const conflicts = useMemo(() => listConflicts(courses), [courses]);

  function addCourse(relation: CourseRelation) {
    const id = stagedCourseId(relation.course_id, relation.teacher_id);
    setCourses((current) => {
      if (current.some((item) => item.id === id)) return current;
      return [
        ...current,
        {
          id,
          courseId: relation.course_id,
          courseCode: relation.code,
          courseName: relation.name,
          teacherId: relation.teacher_id,
          teacherName: relation.teacher_name,
          rating: relation.rating,
          reviewCount: relation.review_count,
          slots: [],
        },
      ];
    });
  }

  function addSlot(
    courseId: string,
    weekday: number,
    startPeriod: number,
    endPeriod: number,
  ) {
    setCourses((current) =>
      current.map((course) => {
        if (course.id !== courseId) return course;
        const slot = normalizeSlot({
          id: slotIdFor(course.id, {
            weekday,
            startPeriod,
            endPeriod,
            weeks: defaultWeeks(),
          }),
          weekday,
          startPeriod,
          endPeriod,
          weeks: defaultWeeks(),
        });
        if (course.slots.some((item) => item.id === slot.id)) return course;
        return { ...course, slots: [...course.slots, slot] };
      }),
    );
  }

  return (
    <section>
      <header aria-label="排课模拟标题" className="mb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Typography
              className="m-0 text-lg font-bold leading-tight tracking-tight text-foreground"
              type="h1"
            >
              排课模拟
            </Typography>
            <p className="mb-0 mt-1 text-sm text-muted">
              提前处理掉早八刺客
            </p>
          </div>
          <JwxtScheduleImport
            canEdit={canEdit}
            loginHref={`${viewer.loginPath}?from=${encodeURIComponent("/schedule")}`}
            onImport={(rows) => void applyJwxtImport(rows)}
          />
        </div>
      </header>

      {importNotice ? (
        <Alert className="mb-4" role="status">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>本科教务导入</Alert.Title>
            <Alert.Description>{importNotice}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {conflicts.length > 0 ? (
        <Alert className="mb-4" role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>课表有时间冲突</Alert.Title>
            <Alert.Description>
              {conflicts.map((conflict) => conflictMessage(conflict)).join("；")}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div>
          <SearchField
            aria-label="搜索要排的课程"
            className="mb-3 w-full"
            name="schedule-course-search"
            value={query}
            variant="secondary"
            onChange={(value) => {
              setQuery(value);
              if (!value.trim()) setSubmitted("");
            }}
            onSubmit={(value) => setSubmitted(value.trim())}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="搜索课程、老师" />
              <SearchField.ClearButton aria-label="清空排课搜索" />
            </SearchField.Group>
          </SearchField>

          {error ? (
            <DetailErrorAlert title="课程搜索失败" message={error} />
          ) : loading ? (
            <p className="text-sm text-muted" role="status">
              正在搜索…
            </p>
          ) : submitted && results.length === 0 ? (
            <p className="text-sm text-muted" role="status">
              没有找到匹配「{submitted}」的任课关系。
            </p>
          ) : results.length > 0 ? (
            <ul
              aria-label="搜索结果"
              className="mb-6 list-none space-y-3 p-0"
            >
              {results.map((relation) => {
                const id = stagedCourseId(relation.course_id, relation.teacher_id);
                const added = courses.some((item) => item.id === id);
                return (
                  <li
                    key={id}
                    className="border-b border-separator pb-3 last:border-b-0"
                  >
                    <div className="font-medium">
                      <RouterAriaLink
                        className="text-accent"
                        to={relationDetailHref(relation)}
                      >
                        {relation.name}
                        {relation.teacher_name ? (
                          <span className="font-normal">
                            （{relation.teacher_name}）
                          </span>
                        ) : (
                          <span className="text-sm font-normal text-muted">
                            {" "}
                            教师待补充
                          </span>
                        )}
                      </RouterAriaLink>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Stars rating={relation.rating} />
                      <span className="text-[calc(12/15*1rem)] text-muted">
                        {relation.review_count > 0
                          ? `${relation.review_count} 条评价`
                          : "暂无评价"}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        isDisabled={added}
                        onPress={() => {
                          if (!canEdit) return;
                          addCourse(relation);
                        }}
                      >
                        {added ? "已加入" : "加入课表"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <Typography
            className="mb-2 text-sm font-semibold"
            type="h2"
          >
            已选课程
          </Typography>
          {courses.length === 0 ? (
            <p className="text-sm text-muted" role="status">
              还没有课程。先搜索再加入。
            </p>
          ) : (
            <div aria-label="已选课程" role="region">
              {courses.map((course) => (
                <StagedCourseCard
                  key={course.id}
                  course={course}
                  canEdit={canEdit}
                  onAddSlot={(weekday, startPeriod, endPeriod) =>
                    addSlot(course.id, weekday, startPeriod, endPeriod)
                  }
                  onRemoveSlot={(slotId) =>
                    setCourses((current) =>
                      current.map((item) =>
                        item.id === course.id
                          ? {
                              ...item,
                              slots: item.slots.filter((slot) => slot.id !== slotId),
                            }
                          : item,
                      ),
                    )
                  }
                  onRemove={() =>
                    setCourses((current) =>
                      current.filter((item) => item.id !== course.id),
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>

        <ScheduleTimetable courses={courses} />
      </div>
    </section>
  );
}
