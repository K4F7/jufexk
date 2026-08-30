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
  Skeleton,
  Tag,
  TagGroup,
  TextArea,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from "@heroui/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { StarGlyph, starFill } from "../components/Stars";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";
import { backTargetFrom } from "../lib/back-target";
import {
  isDevAtlasSession,
  previewFilledSubmitCourse,
  previewFilledSubmitDraft,
  readDevPreviewOrFilled,
} from "../lib/dev-preview";
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
import {
  keepCurrentSchemaScores,
  questionsForSubmitForm,
} from "../lib/submit-questionnaire";
import type {
  CourseOption,
  CourseReviewScheme,
  Paginated,
  SiteConfig,
  Teacher,
} from "../lib/types";

const SEARCH_DELAY = 320;

/** Official Label required mark: `after:ms-0.5 after:content-['*']`. */
const REQUIRED_MARK_RESERVE = "after:ms-0.5 after:content-['*']";

function firstSelectedKey(keys: Iterable<Key>): string | undefined {
  const [key] = keys;
  return key == null ? undefined : String(key);
}

type SchemeCourse = CourseOption &
  CourseReviewScheme & {
    teachers: Teacher[];
  };

/**
 * 三档题：窄屏用 detached `size="sm"` ToggleButton（与目录 全部/通识 同款 chip）；
 * `sm+` 仍用 TagGroup + Tag。选项是题目自带的中文档位文案，不是裸 1/2/3。
 */
function ScaleRadios({
  name,
  label,
  options,
  required = true,
  disabled = false,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  required?: boolean;
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const [invalid, setInvalid] = useState(false);
  const errorId = `${name}-error`;
  const selectedKeys = value ? new Set([value]) : new Set<Key>();

  function handleSelection(keys: "all" | Iterable<Key>) {
    if (disabled || keys === "all") return;
    const next = firstSelectedKey(keys);
    if (next == null) return;
    setInvalid(false);
    onChange(next);
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1.5 sm:hidden">
        <Label isDisabled={disabled} isRequired={required}>
          {label}
        </Label>
        <ToggleButtonGroup
          aria-label={label}
          className="inline-flex max-w-full flex-wrap"
          isDetached
          isDisabled={disabled}
          selectedKeys={selectedKeys}
          selectionMode="single"
          size="sm"
          onSelectionChange={handleSelection}
        >
          {options.map((option) => (
            <ToggleButton key={option.value} id={option.value}>
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>
      <TagGroup
        className="max-sm:hidden"
        selectedKeys={selectedKeys}
        selectionMode="single"
        onSelectionChange={handleSelection}
      >
        <Label isDisabled={disabled} isRequired={required}>
          {label}
        </Label>
        <TagGroup.List className="flex-wrap">
          {options.map((option) => (
            <Tag
              key={option.value}
              id={option.value}
              isDisabled={disabled}
              textValue={option.label}
            >
              {option.label}
            </Tag>
          ))}
        </TagGroup.List>
      </TagGroup>
      {invalid ? (
        <ErrorMessage id={errorId}>请选择{label}</ErrorMessage>
      ) : null}
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
  disabled = false,
  value,
  onChange,
  accessory,
}: {
  required?: boolean;
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  accessory?: React.ReactNode;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const shown = disabled ? value : (preview ?? value);
  const selected = Number(shown) || 0;
  const caption = overallCaption(shown);
  return (
    <div className="flex min-w-0 w-full flex-wrap items-center gap-3">
      <div className="flex w-full flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
        <RadioGroup
          isDisabled={disabled}
          isRequired={required}
          className="min-w-0 flex-1 flex-col gap-1"
          name="overall"
          orientation="horizontal"
          value={value}
          onChange={onChange}
        >
          <div className="flex w-full flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
            <Label
              isDisabled={disabled}
              isRequired={required}
              className={
                required
                  ? "m-0 leading-6"
                  : `m-0 leading-6 ${REQUIRED_MARK_RESERVE} after:invisible`
              }
            >
              推荐度
            </Label>
            <div className="flex w-full max-w-full flex-row flex-wrap items-center gap-1 sm:contents">
              <div
                className="inline-flex h-6 items-center max-sm:h-11"
                onPointerLeave={() => {
                  if (!disabled) setPreview(null);
                }}
              >
                {[1, 2, 3, 4, 5].map((star) => {
                  const leftValue = String(star - 0.5);
                  const rightValue = String(star);
                  return (
                    <span
                      key={star}
                      className="relative inline-flex size-6 items-center justify-center text-accent max-sm:size-11"
                    >
                      <StarGlyph
                        className="pointer-events-none !size-6"
                        fill={starFill(selected || null, star)}
                      />
                      <Radio
                        className="absolute inset-y-0 left-0 w-1/2"
                        value={leftValue}
                      >
                        <Radio.Content
                          className="size-full"
                          onPointerEnter={() => {
                            if (!disabled) setPreview(leftValue);
                          }}
                        >
                          <span className="sr-only">{leftValue} 星</span>
                        </Radio.Content>
                      </Radio>
                      <Radio
                        className="absolute inset-y-0 right-0 w-1/2"
                        value={rightValue}
                      >
                        <Radio.Content
                          className="size-full"
                          onPointerEnter={() => {
                            if (!disabled) setPreview(rightValue);
                          }}
                        >
                          <span className="sr-only">{rightValue} 星</span>
                        </Radio.Content>
                      </Radio>
                    </span>
                  );
                })}
              </div>
              {caption ? (
                <p
                  className="m-0 whitespace-nowrap text-sm text-muted"
                  aria-live="polite"
                >
                  {caption}
                </p>
              ) : (
                <p className="sr-only" aria-live="polite" />
              )}
            </div>
          </div>
          <FieldError>请选择推荐度</FieldError>
        </RadioGroup>
        {accessory}
      </div>
    </div>
  );
}

/** API still requires headline (#444); derive it from the note so the field can stay off the form. */
function headlineFromNote(text: string) {
  return text.trim().replace(/\s+/g, " ").slice(0, 80);
}

function QuestionnaireSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-x-6 gap-y-5"
      aria-busy="true"
      aria-label="问卷加载中"
      role="status"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="space-y-3">
          <Skeleton className="h-4 w-24 rounded" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-14 rounded-full" />
            <Skeleton className="h-8 w-14 rounded-full" />
            <Skeleton className="h-8 w-14 rounded-full" />
          </div>
        </div>
      ))}
    </div>
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
    <Card.Header className="min-w-0 gap-1">
      <div className="flex min-w-0 flex-row items-baseline justify-between gap-3">
        <div className="min-w-0">
          <Card.Title
            className="min-w-0 text-lg font-bold break-words text-accent [overflow-wrap:anywhere] sm:text-xl"
            id={headingId}
          >
            点评 · {courseName}
            <span className="whitespace-nowrap">（{teacherName}）</span>
          </Card.Title>
        </div>
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
  const preview = readDevPreviewOrFilled(searchParams);
  const filledPreview = preview === "filled";
  const [courseQueryDraft, setCourseQueryDraft] = useState(() =>
    filledPreview ? previewFilledSubmitCourse().name : "",
  );
  const [courseQuery, setCourseQuery] = useState("");
  const [courseOptions, setCourseOptions] = useState<CourseOption[]>(() =>
    filledPreview ? [previewFilledSubmitCourse()] : [],
  );
  const [courseLoading, setCourseLoading] = useState(!filledPreview);
  const [selectedCourse, setSelectedCourse] = useState<SchemeCourse | null>(
    () => (filledPreview ? previewFilledSubmitCourse() : null),
  );
  const [teacherId, setTeacherId] = useState(() =>
    filledPreview ? previewFilledSubmitDraft().teacherId : "",
  );
  const [scores, setScores] = useState<Record<string, string>>(() =>
    filledPreview ? previewFilledSubmitDraft().scores : {},
  );
  const [overall, setOverall] = useState(() =>
    filledPreview ? previewFilledSubmitDraft().overall : "",
  );
  const [grade, setGrade] = useState(() =>
    filledPreview ? previewFilledSubmitDraft().grade : "",
  );
  const [loginOnly, setLoginOnly] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [note, setNote] = useState(() =>
    filledPreview ? previewFilledSubmitDraft().note : "",
  );
  const [noteError, setNoteError] = useState("");
  const [msg, setMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [presetFailed, setPresetFailed] = useState(false);
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

  const presetCourseId = Number(searchParams.get("courseId"));
  const hasCoursePreset =
    Number.isSafeInteger(presetCourseId) && presetCourseId >= 1;
  const waitingForCourseScheme =
    hasCoursePreset && !selectedCourse && !presetFailed;
  const questions = questionsForSubmitForm(
    selectedCourse,
    waitingForCourseScheme,
  );
  const teachers = selectedCourse?.teachers ?? [];
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
    if (isDevAtlasSession(searchParams) || preview === "filled") return;
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
    preview,
    searchParams,
  ]);

  useEffect(() => {
    if (preview !== "filled") return;
    const course = previewFilledSubmitCourse();
    const draft = previewFilledSubmitDraft();
    setSelectedCourse(course);
    setCourseQueryDraft(course.name);
    setTeacherId(draft.teacherId);
    setScores(draft.scores);
    setOverall(draft.overall);
    setNote(draft.note);
    setGrade(draft.grade);
    setCourseLoading(false);
    setPresetFailed(false);
    setMsg("");
  }, [preview]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCourseQuery(courseQueryDraft.trim());
    }, SEARCH_DELAY);
    return () => window.clearTimeout(timer);
  }, [courseQueryDraft]);

  useEffect(() => {
    if (courseLocked) return;
    if (preview === "filled") {
      setCourseOptions([previewFilledSubmitCourse()]);
      setCourseLoading(false);
      return;
    }
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
  }, [courseQuery, courseLocked, preview]);

  useEffect(() => {
    if (preview === "filled") return;
    if (!selectedCourse || !teacherId) return;
    const key = `${selectedCourse.id}:${teacherId}`;
    if (restoredDraftKey.current === key) return;
    const draft = loadReviewDraft(selectedCourse.id, teacherId);
    restoredDraftKey.current = key;
    if (!draft) return;
    setNote(draft.note);
    setGrade(draft.grade);
    setLoginOnly(draft.loginOnly);
    setReviewOnly(draft.reviewOnly);
    if (draft.reviewOnly) {
      setScores({});
      setOverall("");
    } else {
      setScores(
        keepCurrentSchemaScores(
          draft.scores,
          selectedCourse.applicableQuestions,
        ),
      );
      setOverall(draft.overall);
    }
  }, [selectedCourse, teacherId, preview]);

  const loadCourse = useCallback(async (id: number) => {
    const detail = await api<{ course: SchemeCourse }>(`/api/courses/${id}`);
    setSelectedCourse(detail.course);
    setCourseQueryDraft(detail.course.name);
    return detail.course;
  }, []);

  useEffect(() => {
    if (preview === "filled") return;
    const preset = Number(searchParams.get("courseId"));
    if (!Number.isSafeInteger(preset) || preset < 1) {
      setPresetFailed(false);
      return;
    }
    let cancelled = false;
    setPresetFailed(false);
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
        if (cancelled) return;
        setMsg((error as Error).message);
        setPresetFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadCourse, searchParams, preview]);

  async function onCourseChange(key: Key | null) {
    restoredDraftKey.current = "";
    if (key == null) {
      setSelectedCourse(null);
      setTeacherId("");
      setScores((current) =>
        keepCurrentSchemaScores(current, COMMON_CORE_QUESTIONS),
      );
      return;
    }
    try {
      const course = await loadCourse(Number(key));
      setTeacherId("");
      setScores((current) =>
        keepCurrentSchemaScores(current, course.applicableQuestions),
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
    <section className="mx-auto my-auto w-full min-w-0 max-w-[800px] overflow-x-clip">
      <Form
        aria-labelledby="submit-review-heading"
        validationBehavior="native"
        onSubmit={onSubmit}
      >
        <Card
          className="min-w-0 gap-4 sm:gap-6"
          role="region"
          aria-labelledby="submit-review-heading"
        >
          {waitingForCourseScheme ? (
            <Card.Header className="gap-1">
              <span className="sr-only" id="submit-review-heading">
                写评价
              </span>
              <Skeleton className="h-7 w-64 max-w-full rounded" />
              <Skeleton className="h-4 w-28 rounded" />
            </Card.Header>
          ) : subjectKnown && selectedCourse && selectedTeacher ? (
            <ReviewSubjectHeader
              headingId="submit-review-heading"
              courseName={selectedCourse.name}
              teacherName={selectedTeacher.name}
              code={selectedCourse.code}
            />
          ) : (
            <Card.Header className="gap-1">
              <Card.Title
                className="text-lg font-bold text-accent sm:text-xl"
                id="submit-review-heading"
              >
                写评价
              </Card.Title>
              {courseLocked && selectedCourse ? (
                <Card.Description>{selectedCourse.name}</Card.Description>
              ) : null}
            </Card.Header>
          )}

          <Card.Content className="gap-5 sm:gap-8">
            {teacherLocked || waitingForCourseScheme ? null : (
              <>
                {courseLocked && selectedCourse ? null : (
                  <ComboBox
                    isRequired
                    allowsEmptyCollection
                    fullWidth
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
                    <ComboBox.InputGroup className="max-sm:min-h-11">
                      <Input
                        className="max-sm:min-h-11"
                        placeholder="搜索课程"
                        variant="secondary"
                      />
                      <ComboBox.Trigger />
                    </ComboBox.InputGroup>
                    <ComboBox.Popover className="w-[var(--trigger-width)] max-w-[calc(100vw-2rem)]">
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
                            className="max-sm:min-h-11"
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
                  fullWidth
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
                  <Select.Trigger className="max-sm:min-h-11">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover className="w-[var(--trigger-width)] max-w-[calc(100vw-2rem)]">
                    <ListBox>
                      {teachers.map((teacher) => (
                        <ListBox.Item
                          key={teacher.id}
                          className="max-sm:min-h-11"
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

            {waitingForCourseScheme ? (
              <QuestionnaireSkeleton />
            ) : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:gap-y-5">
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
                    disabled={reviewOnly}
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
            )}
            <OverallStarRating
              required={!reviewOnly}
              disabled={reviewOnly}
              value={overall}
              onChange={setOverall}
              accessory={
                <Checkbox
                  className="ml-auto shrink-0 scroll-mt-24"
                  isSelected={reviewOnly}
                  name="reviewOnly"
                  variant="secondary"
                  onChange={(selected) => {
                    setReviewOnly(selected);
                    if (!selected) return;
                    setScores({});
                    setOverall("");
                  }}
                >
                  <Checkbox.Content className="max-sm:min-h-11">
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    只写点评不评分
                  </Checkbox.Content>
                </Checkbox>
              }
            />
            <TextField
              fullWidth
              className="w-full"
              isInvalid={!!noteError}
              isRequired
              name="comment"
              value={note}
              variant="secondary"
              onChange={onNoteChange}
            >
              <Label>详细评价</Label>
              <TextArea
                className="w-full max-sm:h-36 max-sm:min-h-36"
                rows={10}
                variant="secondary"
              />
              <Description>
                请畅所欲言, 从讲课方式到作业考试都谈谈.
                <br />
                测评内容理想上应当富有事实且描述全面. 比如一门课讲得好但考试很难, 二者都说出来更有利于同学们做出全面的选择和判断. 学弟学妹(和挣扎的学长学姐)感谢你们.
              </Description>
              {noteError ? <FieldError>{noteError}</FieldError> : null}
            </TextField>
            <TextField
              fullWidth
              className="w-full"
              name="grade"
              value={grade}
              variant="secondary"
              onChange={(value) =>
                setGrade(value.replace(/\D/g, "").slice(0, 3))
              }
            >
              <Label>你的成绩</Label>
              <Input
                className="max-sm:min-h-11"
                inputMode="numeric"
                maxLength={3}
                placeholder="选填"
                variant="secondary"
              />
              <Description>
                可选. 分享你的成绩有助于同学们进行更全面的判断.
              </Description>
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

          <Card.Footer className="flex-row flex-wrap gap-2 max-sm:items-stretch">
            <Button
              className="min-w-0 flex-1 sm:w-auto sm:flex-none"
              isDisabled={!selectedCourse || !teacherId}
              type="button"
              variant="secondary"
              onPress={saveDraft}
            >
              保存
            </Button>
            <Button
              className="min-w-0 flex-[1.25] sm:w-auto sm:flex-none"
              isPending={submitting}
              type="submit"
              variant="primary"
            >
              发布
            </Button>
          </Card.Footer>
        </Card>
      </Form>
    </section>
  );
}
