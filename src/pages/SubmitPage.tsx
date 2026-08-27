import {
  Button,
  Card,
  Checkbox,
  ComboBox,
  Description,
  ErrorMessage,
  FieldError,
  Form,
  Input,
  Label,
  ListBox,
  Radio,
  RadioGroup,
  Select,
  Tag,
  TagGroup,
  TextArea,
  TextField,
  type Key,
} from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { StarGlyph, starFill } from "../components/Stars";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";
import { backTargetFrom } from "../lib/back-target";
import { isDevAtlasSession } from "../lib/dev-preview";
import {
  clearReviewDraft,
  loadReviewDraft,
  saveReviewDraft,
} from "../lib/review-draft";
import { plainTextToReviewNoteHtml } from "../lib/review-note-html";
import { overallCaption } from "../lib/review-overall";
import {
  COMMON_CORE_QUESTIONS,
  REVIEW_NOTE_MAX_LENGTH,
  REVIEW_NOTE_MIN_LENGTH,
} from "../lib/review-schemes";
import type {
  ApplicableQuestion,
  CourseOption,
  CourseReviewScheme,
  Paginated,
  SiteConfig,
  Teacher,
} from "../lib/types";

const SEARCH_DELAY = 320;

function firstSelectedKey(keys: Iterable<Key>): string | undefined {
  const [key] = keys;
  return key == null ? undefined : String(key);
}

type SchemeCourse = CourseOption &
  CourseReviewScheme & {
    teachers: Teacher[];
  };

/**
 * 三档题：HeroUI TagGroup + Tag（selectionMode="single"）。
 * 选项用题目自带的中文档位文案（简单/中等/困难…），不再是裸 1/2/3。
 */
function ScaleRadios({
  name,
  label,
  options,
  required = true,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const [invalid, setInvalid] = useState(false);
  const errorId = `${name}-error`;
  return (
    <>
      <TagGroup
        selectedKeys={value ? new Set([value]) : new Set()}
        selectionMode="single"
        onSelectionChange={(keys) => {
          if (keys === "all") return;
          const next = firstSelectedKey(keys);
          if (next == null) return;
          setInvalid(false);
          onChange(next);
        }}
      >
        <Label isRequired={required}>{label}</Label>
        <TagGroup.List>
          {options.map((option) => (
            <Tag key={option.value} id={option.value} textValue={option.label}>
              {option.label}
            </Tag>
          ))}
        </TagGroup.List>
        {invalid ? (
          <ErrorMessage id={errorId}>请选择{label}</ErrorMessage>
        ) : null}
      </TagGroup>
      {required ? (
        <input
          required
          aria-describedby={invalid ? errorId : undefined}
          aria-invalid={invalid || undefined}
          aria-label={label}
          className="sr-only"
          name={name}
          tabIndex={-1}
          value={value}
          onChange={() => {}}
          onInvalid={(event) => {
            event.preventDefault();
            setInvalid(true);
          }}
        />
      ) : null}
    </>
  );
}

function OverallStarRating({
  required = true,
  value,
  onChange,
}: {
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const shown = preview ?? value;
  const selected = Number(shown) || 0;
  const caption = overallCaption(shown);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RadioGroup
        isRequired={required}
        className="flex-col gap-1"
        name="overall"
        orientation="horizontal"
        value={value}
        onChange={onChange}
      >
        <div className="flex items-center gap-3">
          <Label isRequired={required} className="m-0 leading-6">
            推荐度
          </Label>
          <div
            className="inline-flex h-6 items-center"
            onPointerLeave={() => setPreview(null)}
          >
          {[1, 2, 3, 4, 5].map((star) => {
            const leftValue = star === 1 ? "" : String(star - 0.5);
            const rightValue = String(star);
            return (
              <span key={star} className="relative inline-flex size-6 items-center justify-center text-accent">
                <StarGlyph
                  className="pointer-events-none !size-6"
                  fill={starFill(selected || null, star)}
                />
                {leftValue ? (
                  <Radio
                    className="absolute inset-y-0 left-0 w-1/2"
                    value={leftValue}
                  >
                    <Radio.Content
                      className="size-full"
                      onPointerEnter={() => setPreview(leftValue)}
                    >
                      <span className="sr-only">{leftValue} 星</span>
                    </Radio.Content>
                  </Radio>
                ) : null}
                <Radio
                  className={
                    leftValue
                      ? "absolute inset-y-0 right-0 w-1/2"
                      : "absolute inset-0"
                  }
                  value={rightValue}
                >
                  <Radio.Content
                    className="size-full"
                    onPointerEnter={() => setPreview(rightValue)}
                  >
                    <span className="sr-only">{rightValue} 星</span>
                  </Radio.Content>
                </Radio>
              </span>
            );
          })}
        </div>
        </div>
        <FieldError>请选择推荐度</FieldError>
      </RadioGroup>
      {caption ? (
        <p className="m-0 text-sm text-muted" aria-live="polite">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

/** API still requires headline (#444); derive it from the note so the field can stay off the form. */
function headlineFromNote(text: string) {
  return text.trim().replace(/\s+/g, " ").slice(0, 80);
}

/** Keep scores for questions that still apply; drop the rest (issue #361). */
function keepApplicable(
  scores: Record<string, string>,
  questions: readonly ApplicableQuestion[],
) {
  const applicable = new Set(questions.map((question) => question.id));
  return Object.fromEntries(
    Object.entries(scores).filter(([id]) => applicable.has(id)),
  );
}

function StatusMessage({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <p className="m-0 text-sm" role="status">
      {msg}
    </p>
  );
}

function ReviewSubjectHeader({
  headingId,
  courseName,
  teacherName,
  code,
}: {
  headingId?: string;
  courseName: string;
  teacherName: string;
  code?: string;
}) {
  const codeText = code?.trim() ?? "";
  return (
    <Card.Header className="gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <Card.Title className="text-xl font-bold text-accent" id={headingId}>
          点评 · {courseName}（{teacherName}）
        </Card.Title>
        {codeText ? (
          <Card.Description className="m-0 shrink-0">
            课程号：{codeText}
          </Card.Description>
        ) : null}
      </div>
    </Card.Header>
  );
}

export function SubmitPage({ config: _config }: { config: SiteConfig | null }) {
  const { viewer, ready: viewerReady } = useViewer();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [courseQueryDraft, setCourseQueryDraft] = useState("");
  const [courseQuery, setCourseQuery] = useState("");
  const [courseOptions, setCourseOptions] = useState<CourseOption[]>([]);
  const [courseLoading, setCourseLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState<SchemeCourse | null>(
    null,
  );
  const [teacherId, setTeacherId] = useState("");
  const [scores, setScores] = useState<Record<string, string>>({});
  const [overall, setOverall] = useState("");
  const [grade, setGrade] = useState("");
  const [loginOnly, setLoginOnly] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const [msg, setMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const restoredDraftKey = useRef("");

  /** 字数门槛按纯文本计算，与服务端 validateReviewNote 去标签后的口径一致。 */
  const validateNote = useCallback((value: string) => {
    const length = value.trim().length;
    if (length < REVIEW_NOTE_MIN_LENGTH) return "字数不够";
    if (length > REVIEW_NOTE_MAX_LENGTH)
      return `详细评价不能超过 ${REVIEW_NOTE_MAX_LENGTH} 字`;
    return "";
  }, []);

  const onNoteChange = useCallback(
    (value: string) => {
      setNote(value);
      setNoteError((current) => (current ? validateNote(value) : current));
    },
    [validateNote],
  );

  const questions: ApplicableQuestion[] =
    selectedCourse?.applicableQuestions ?? COMMON_CORE_QUESTIONS;
  const teachers = selectedCourse?.teachers ?? [];
  const presetCourseId = Number(searchParams.get("courseId"));
  const presetTeacherId = searchParams.get("teacherId") ?? "";
  const courseLocked =
    Number.isSafeInteger(presetCourseId) &&
    presetCourseId >= 1 &&
    selectedCourse?.id === presetCourseId;
  const selectedTeacher =
    teachers.find((teacher) => String(teacher.id) === teacherId) ?? null;
  const teacherLocked = Boolean(
    courseLocked &&
      presetTeacherId &&
      selectedTeacher &&
      String(selectedTeacher.id) === presetTeacherId,
  );
  const hiddenCoreLabels = (selectedCourse?.tags ?? []).includes("mooc")
    ? COMMON_CORE_QUESTIONS.filter(
        (core) => !questions.some((question) => question.id === core.id),
      ).map((core) => core.label)
    : [];

  useEffect(() => {
    if (!viewerReady || viewer.authenticated) return;
    if (isDevAtlasSession(searchParams)) return;
    const from = backTargetFrom(`${location.pathname}${location.search}`);
    navigate(
      `${viewer.loginPath}?from=${encodeURIComponent(from)}`,
      { replace: true },
    );
  }, [
    viewerReady,
    viewer.authenticated,
    viewer.loginPath,
    location.pathname,
    location.search,
    navigate,
    searchParams,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCourseQuery(courseQueryDraft.trim());
    }, SEARCH_DELAY);
    return () => window.clearTimeout(timer);
  }, [courseQueryDraft]);

  useEffect(() => {
    if (courseLocked) return;
    const controller = new AbortController();
    let cancelled = false;
    const query = new URLSearchParams({ page: "1", pageSize: "20" });
    if (courseQuery) query.set("q", courseQuery);
    setCourseLoading(true);
    api<Paginated<CourseOption>>(`/api/courses/options?${query}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) setCourseOptions(result.items);
      })
      .catch((error) => {
        if (!cancelled) setMsg((error as Error).message);
      })
      .finally(() => {
        if (!cancelled) setCourseLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [courseQuery, courseLocked]);

  useEffect(() => {
    if (!selectedCourse || !teacherId) return;
    const key = `${selectedCourse.id}:${teacherId}`;
    if (restoredDraftKey.current === key) return;
    const draft = loadReviewDraft(selectedCourse.id, teacherId);
    restoredDraftKey.current = key;
    if (!draft) return;
    setScores(draft.scores);
    setOverall(draft.overall);
    setNote(draft.note);
    setGrade(draft.grade);
    setLoginOnly(draft.loginOnly);
    setReviewOnly(draft.reviewOnly);
  }, [selectedCourse, teacherId]);

  const loadCourse = useCallback(async (id: number) => {
    const detail = await api<{ course: SchemeCourse }>(`/api/courses/${id}`);
    setSelectedCourse(detail.course);
    setCourseQueryDraft(detail.course.name);
    return detail.course;
  }, []);

  useEffect(() => {
    const preset = Number(searchParams.get("courseId"));
    if (!Number.isSafeInteger(preset) || preset < 1) return;
    let cancelled = false;
    loadCourse(preset)
      .then((course) => {
        if (cancelled) return;
        const presetTeacher = searchParams.get("teacherId");
        if (
          presetTeacher &&
          course.teachers.some((teacher) => String(teacher.id) === presetTeacher)
        ) {
          setTeacherId(presetTeacher);
        }
      })
      .catch((error) => {
        if (!cancelled) setMsg((error as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [loadCourse, searchParams]);

  async function onCourseChange(key: Key | null) {
    restoredDraftKey.current = "";
    if (key == null) {
      setSelectedCourse(null);
      setTeacherId("");
      setScores((current) => keepApplicable(current, COMMON_CORE_QUESTIONS));
      return;
    }
    try {
      const course = await loadCourse(Number(key));
      setTeacherId("");
      setScores((current) =>
        keepApplicable(current, course.applicableQuestions),
      );
      setMsg("");
    } catch (error) {
      setMsg((error as Error).message);
    }
  }

  function saveDraft() {
    if (!selectedCourse || !teacherId) {
      setMsg("请先确定课程和任课教师再保存");
      return;
    }
    saveReviewDraft(selectedCourse.id, teacherId, {
      scores,
      overall,
      note,
      grade,
      loginOnly,
      reviewOnly,
    });
    setMsg("已保存，可稍后继续填写");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCourse || !teacherId) {
      setMsg("请选择课程和任课教师");
      return;
    }
    if (!reviewOnly && !overall) {
      setMsg("请选择推荐度");
      return;
    }
    if (!reviewOnly && questions.some((question) => !scores[question.id])) {
      setMsg("请答完本次适用的评分题");
      return;
    }
    const nextNoteError = validateNote(note);
    if (nextNoteError) {
      setNoteError(nextNoteError);
      setMsg("");
      return;
    }
    setSubmitting(true);
    setMsg("");
    try {
      const payloadScores = Object.fromEntries(
        questions.map((question) => [question.id, Number(scores[question.id])]),
      );
      await api<{ message: string }>("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          courseId: selectedCourse.id,
          teacherId: Number(teacherId),
          overall: overall ? Number(overall) : null,
          scores: reviewOnly ? null : payloadScores,
          headline: headlineFromNote(note),
          grade: grade.trim(),
          loginOnly,
          reviewOnly,
          comment: plainTextToReviewNoteHtml(note),
          website: "",
        }),
      });
      clearReviewDraft(selectedCourse.id, teacherId);
      // 发布即公开：回到该 课程×教师 的详情页并展示提交成功条（Issue #402）。
      navigate(
        `/courses/${selectedCourse.id}?teacher=${teacherId}`,
        { state: { submitted: true } },
      );
    } catch (error) {
      setMsg((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // 会话仍在解析时不播报：此时无法区分「已确认访客将跳转登录」与
  // 「已登录用户在等会话」，提前断言「正在前往登录」对后者是假状态消息。
  // DEV atlas 会话可绕过，便于本机预览已登录页。
  if (!viewerReady && !isDevAtlasSession(searchParams)) {
    return null;
  }

  if (!viewer.authenticated && !isDevAtlasSession(searchParams)) {
    return (
      <p className="sr-only" role="status">
        正在前往登录…
      </p>
    );
  }

  const subjectKnown = Boolean(selectedCourse && selectedTeacher);

  return (
    <section className="mx-auto my-auto w-full max-w-[800px]">
      <Form
        aria-labelledby="submit-review-heading"
        validationBehavior="native"
        onSubmit={onSubmit}
      >
        <Card
          className="gap-6"
          role="region"
          aria-labelledby="submit-review-heading"
        >
          {subjectKnown && selectedCourse && selectedTeacher ? (
            <ReviewSubjectHeader
              headingId="submit-review-heading"
              courseName={selectedCourse.name}
              teacherName={selectedTeacher.name}
              code={selectedCourse.code}
            />
          ) : (
            <Card.Header className="gap-1">
              <Card.Title
                className="text-xl font-bold text-accent"
                id="submit-review-heading"
              >
                写评价
              </Card.Title>
              {courseLocked && selectedCourse ? (
                <Card.Description>{selectedCourse.name}</Card.Description>
              ) : null}
            </Card.Header>
          )}

          <Card.Content className="gap-8">
            {teacherLocked ? null : (
              <>
                {courseLocked && selectedCourse ? null : (
                  <ComboBox
                    isRequired
                    allowsEmptyCollection
                    className="w-full"
                    defaultFilter={() => true}
                    variant="secondary"
                    inputValue={courseQueryDraft}
                    name="courseId"
                    selectedKey={
                      selectedCourse ? String(selectedCourse.id) : null
                    }
                    onInputChange={setCourseQueryDraft}
                    onSelectionChange={onCourseChange}
                  >
                    <Label>课程</Label>
                    <Description>
                      可以搜索课名、老师或课号，再选出对应的课。
                    </Description>
                    <ComboBox.InputGroup>
                      <Input placeholder="搜索课程" variant="secondary" />
                      <ComboBox.Trigger />
                    </ComboBox.InputGroup>
                    <ComboBox.Popover>
                      <ListBox
                        renderEmptyState={() => (
                          <div className="py-4 text-center text-sm text-muted">
                            {courseLoading ? "搜索中…" : "没有匹配的课程"}
                          </div>
                        )}
                      >
                        {courseOptions.map((course) => (
                          <ListBox.Item
                            key={course.id}
                            id={String(course.id)}
                            textValue={`${course.name} ${course.code}`}
                          >
                            {course.name}
                            {course.code ? (
                              <span className="text-muted"> · {course.code}</span>
                            ) : null}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </ComboBox.Popover>
                  </ComboBox>
                )}

                <Select
                  isRequired
                  isDisabled={!selectedCourse}
                  className="w-full"
                  name="teacherId"
                  placeholder="请选择"
                  variant="secondary"
                  value={teacherId || null}
                  onChange={(value) =>
                    setTeacherId(value ? String(value) : "")
                  }
                >
                  <Label>任课教师</Label>
                  <Description>选择这门课的任课老师</Description>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {teachers.map((teacher) => (
                        <ListBox.Item
                          key={teacher.id}
                          id={String(teacher.id)}
                          textValue={teacher.name}
                        >
                          {teacher.name}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                  <FieldError>请选择任课教师</FieldError>
                </Select>
              </>
            )}

            {hiddenCoreLabels.length ? (
              <p className="m-0 text-sm text-muted">
                该课程为网课（MOOC），
                {hiddenCoreLabels.map((label) => `「${label}」`).join("、")}
                等仅线下适用的题目无需作答。
              </p>
            ) : null}

            <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
              {questions.map((question) => (
                <ScaleRadios
                  key={question.id}
                  name={`score-${question.id}`}
                  label={question.prompt}
                  options={question.options.map((option) => ({
                    value: String(option.value),
                    label: option.label,
                  }))}
                  required={!reviewOnly}
                  value={scores[question.id] || ""}
                  onChange={(value) =>
                    setScores((current) => ({
                      ...current,
                      [question.id]: value,
                    }))
                  }
                />
              ))}
            </div>
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <OverallStarRating
                required={!reviewOnly}
                value={overall}
                onChange={setOverall}
              />
              <Checkbox
                className="ml-auto"
                isSelected={reviewOnly}
                name="reviewOnly"
                variant="secondary"
                onChange={setReviewOnly}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  只写点评不评分
                </Checkbox.Content>
              </Checkbox>
            </div>
            <TextField
              isInvalid={!!noteError}
              isRequired
              name="comment"
              value={note}
              variant="secondary"
              onChange={onNoteChange}
            >
              <Label>详细评价</Label>
              <TextArea className="w-full" rows={10} variant="secondary" />
              {noteError ? <FieldError>{noteError}</FieldError> : null}
            </TextField>
            <TextField
              name="grade"
              value={grade}
              variant="secondary"
              onChange={(value) =>
                setGrade(value.replace(/\D/g, "").slice(0, 3))
              }
            >
              <Label>你的成绩</Label>
              <Input
                inputMode="numeric"
                maxLength={3}
                placeholder="选填"
                variant="secondary"
              />
              <Description>选填。分享成绩，方便同学们综合判断。</Description>
            </TextField>

            <Checkbox
              isSelected={loginOnly}
              name="loginOnly"
              variant="secondary"
              onChange={setLoginOnly}
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                仅限登录用户查看
              </Checkbox.Content>
              <Description>勾选后，未登录的访客看不到这条点评</Description>
            </Checkbox>
            <StatusMessage msg={msg} />
          </Card.Content>

          <Card.Footer className="flex-wrap gap-2">
            <Button
              isDisabled={!selectedCourse || !teacherId}
              type="button"
              variant="secondary"
              onPress={saveDraft}
            >
              保存
            </Button>
            <Button isPending={submitting} type="submit" variant="primary">
              发布
            </Button>
          </Card.Footer>
        </Card>
      </Form>
    </section>
  );
}
