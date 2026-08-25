import {
  Button,
  Card,
  Checkbox,
  ComboBox,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  ListBox,
  Radio,
  RadioGroup,
  Select,
  TextArea,
  TextField,
  Typography,
  type Key,
} from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { StarGlyph, starFill } from "../components/Stars";
import { TurnstileBox } from "../components/TurnstileBox";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";
import { backTargetFrom } from "../lib/back-target";
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
import { recentTerms } from "../lib/review-terms";
import type {
  ApplicableQuestion,
  CourseOption,
  CourseReviewScheme,
  Paginated,
  SiteConfig,
  Teacher,
} from "../lib/types";

const SEARCH_DELAY = 320;
const TERM_OPTIONS = recentTerms();
/**
 * Grace period before a not-ready Turnstile widget is revealed in form mode:
 * `refresh-expired: auto` renewals and the fresh challenge on form entry
 * normally complete well under this, so the widget only appears when the
 * user actually has to interact with it again.
 */
const WIDGET_REVEAL_DELAY = 2500;

type SchemeCourse = CourseOption &
  CourseReviewScheme & {
    teachers: Teacher[];
  };

/**
 * 单档题 Radio 组（Issue #402）：选项用题目自带的中文档位文案
 * （简单/中等/困难…），不再是裸 1/2/3。档位说明与选项重复，不另写 Description。
 */
function ScaleRadios({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <RadioGroup
      isRequired
      aria-label={label}
      name={name}
      orientation="horizontal"
      value={value}
      onChange={onChange}
    >
      <Label>{label}</Label>
      {options.map((option) => (
        <Radio key={option.value} value={option.value}>
          <Radio.Content>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            {option.label}
          </Radio.Content>
        </Radio>
      ))}
      <FieldError>请选择{label}</FieldError>
    </RadioGroup>
  );
}

function OverallStarRating({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = Number(value) || 0;
  const caption = overallCaption(value);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <RadioGroup
        isRequired
        aria-label="本次推荐度"
        name="overall"
        orientation="horizontal"
        value={value}
        onChange={onChange}
      >
        <Label>本次推荐度</Label>
        <div className="flex items-center">
          {[1, 2, 3, 4, 5].map((star) => {
            const leftValue = star === 1 ? "" : String(star - 0.5);
            const rightValue = String(star);
            return (
              <span key={star} className="relative inline-flex size-6 text-accent">
                <StarGlyph
                  className="pointer-events-none size-5"
                  fill={starFill(selected || null, star)}
                />
                {leftValue ? (
                  <Radio
                    className="absolute inset-y-0 left-0 w-1/2"
                    value={leftValue}
                  >
                    <Radio.Content className="size-full">
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
                  <Radio.Content className="size-full">
                    <span className="sr-only">{rightValue} 星</span>
                  </Radio.Content>
                </Radio>
              </span>
            );
          })}
        </div>
        <FieldError>请选择本次推荐度</FieldError>
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
  term,
  code,
}: {
  headingId?: string;
  courseName: string;
  teacherName: string;
  term?: string;
  code?: string;
}) {
  const termText = term?.trim() ?? "";
  const codeText = code?.trim() ?? "";
  return (
    <Card.Header className="gap-1">
      <Card.Title className="text-xl font-bold text-accent" id={headingId}>
        点评 · {courseName}（{teacherName}）
      </Card.Title>
      {termText || codeText ? (
        <Card.Description>
          <span className="flex flex-wrap gap-x-6">
            {termText ? <span>学期：{termText}</span> : null}
            {codeText ? <span>课程号：{codeText}</span> : null}
          </span>
        </Card.Description>
      ) : null}
    </Card.Header>
  );
}

export function SubmitPage({ config }: { config: SiteConfig | null }) {
  const { viewer, ready: viewerReady } = useViewer();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState<"gate" | "form">("gate");
  const [courseQueryDraft, setCourseQueryDraft] = useState("");
  const [courseQuery, setCourseQuery] = useState("");
  const [courseOptions, setCourseOptions] = useState<CourseOption[]>([]);
  const [courseLoading, setCourseLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState<SchemeCourse | null>(
    null,
  );
  const [teacherId, setTeacherId] = useState("");
  const [term, setTerm] = useState("");
  const [scores, setScores] = useState<Record<string, string>>({});
  const [overall, setOverall] = useState("");
  const [grade, setGrade] = useState("");
  const [loginOnly, setLoginOnly] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(!config?.turnstileSiteKey);
  const [revealWidget, setRevealWidget] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const widgetRef = useRef<string | number | null>(null);
  const restoredDraftKey = useRef("");
  const onReadyChange = useCallback((nextReady: boolean) => {
    setReady(nextReady);
  }, []);

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
    setTerm(draft.term);
    setScores(draft.scores);
    setOverall(draft.overall);
    setNote(draft.note);
    setGrade(draft.grade);
    setLoginOnly(draft.loginOnly);
    setReviewOnly(draft.reviewOnly);
  }, [selectedCourse, teacherId]);

  useEffect(() => {
    if (ready || phase !== "form") {
      setRevealWidget(false);
      return;
    }
    const timer = window.setTimeout(
      () => setRevealWidget(true),
      WIDGET_REVEAL_DELAY,
    );
    return () => window.clearTimeout(timer);
  }, [ready, phase]);

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

  function enterForm() {
    setMsg("");
    setPhase("form");
  }

  function saveDraft() {
    if (!selectedCourse || !teacherId) {
      setMsg("请先确定课程和任课教师再保存");
      return;
    }
    saveReviewDraft(selectedCourse.id, teacherId, {
      term,
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
    if (
      !reviewOnly &&
      (questions.some((question) => !scores[question.id]) || !overall)
    ) {
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
      let turnstileToken = "";
      if (config?.turnstileSiteKey) {
        turnstileToken =
          window.turnstile?.getResponse(widgetRef.current ?? undefined) || "";
        if (!turnstileToken || !ready) {
          throw new Error("请等待人机验证重新完成后再提交");
        }
      }
      const payloadScores = Object.fromEntries(
        questions.map((question) => [question.id, Number(scores[question.id])]),
      );
      await api<{ message: string }>("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          courseId: selectedCourse.id,
          teacherId: Number(teacherId),
          overall: reviewOnly ? null : Number(overall),
          scores: reviewOnly ? null : payloadScores,
          headline: headlineFromNote(note),
          grade: grade.trim(),
          loginOnly,
          reviewOnly,
          comment: plainTextToReviewNoteHtml(note),
          term,
          website: "",
          turnstileToken,
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

  if (!viewerReady || !viewer.authenticated) {
    return null;
  }

  if (phase === "gate") {
    return (
      <section
        aria-labelledby="submit-gate-heading"
        className="mx-auto max-w-md py-8"
      >
        <Card role="article" aria-labelledby="submit-gate-heading">
          {selectedCourse && selectedTeacher ? (
            <ReviewSubjectHeader
              headingId="submit-gate-heading"
              courseName={selectedCourse.name}
              teacherName={selectedTeacher.name}
              code={selectedCourse.code}
            />
          ) : (
            <Card.Header>
              <Card.Title id="submit-gate-heading">写评价</Card.Title>
            </Card.Header>
          )}
          <Card.Content>
            <StatusMessage msg={msg} />
            {config?.turnstileSiteKey ? (
              <TurnstileBox
                siteKey={config.turnstileSiteKey}
                widgetRef={widgetRef}
                onReadyChange={onReadyChange}
              />
            ) : null}
          </Card.Content>
          <Card.Footer>
            <Button isDisabled={!ready} variant="primary" onPress={enterForm}>
              开始填写
            </Button>
          </Card.Footer>
        </Card>
      </section>
    );
  }

  const subjectKnown = Boolean(selectedCourse && selectedTeacher);

  return (
    <section className="mx-auto max-w-[800px]">
      {subjectKnown && selectedCourse && selectedTeacher ? (
        <Card className="mb-5" role="region" aria-labelledby="submit-review-heading">
          <ReviewSubjectHeader
            headingId="submit-review-heading"
            courseName={selectedCourse.name}
            teacherName={selectedTeacher.name}
            term={term}
            code={selectedCourse.code}
          />
        </Card>
      ) : (
        <Typography
          className="mb-4 text-2xl font-bold"
          id="submit-review-heading"
          type="h1"
        >
          写评价
        </Typography>
      )}

      <Form
        aria-labelledby="submit-review-heading"
        className="flex flex-col gap-5"
        validationBehavior="native"
        onSubmit={onSubmit}
      >
        {teacherLocked ? null : (
          <>
            {courseLocked && selectedCourse ? (
              subjectKnown ? null : (
                <Card role="region" aria-label="评价对象">
                  <Card.Header>
                    <Card.Title>{selectedCourse.name}</Card.Title>
                  </Card.Header>
                </Card>
              )
            ) : (
              <ComboBox
                isRequired
                allowsEmptyCollection
                className="w-full"
                defaultFilter={() => true}
                inputValue={courseQueryDraft}
                name="courseId"
                selectedKey={selectedCourse ? String(selectedCourse.id) : null}
                onInputChange={setCourseQueryDraft}
                onSelectionChange={onCourseChange}
              >
                <Label>课程</Label>
                <Description>
                  可以搜索课名、老师或课号，再选出对应的课。
                </Description>
                <ComboBox.InputGroup>
                  <Input placeholder="搜索课程" />
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
              value={teacherId || null}
              onChange={(value) => setTeacherId(value ? String(value) : "")}
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

        <Select
          className="w-full"
          name="term"
          placeholder="选填"
          value={term || null}
          onChange={(value) => setTerm(value ? String(value) : "")}
        >
          <Label>学期</Label>
          <Description>选填</Description>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {TERM_OPTIONS.map((termOption) => (
                <ListBox.Item
                  key={termOption}
                  id={termOption}
                  textValue={termOption}
                >
                  {termOption}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        {reviewOnly ? null : hiddenCoreLabels.length ? (
          <p className="m-0 text-sm text-muted">
            该课程为网课（MOOC），
            {hiddenCoreLabels.map((label) => `「${label}」`).join("、")}
            等仅线下适用的题目无需作答。
          </p>
        ) : null}

        {reviewOnly
          ? null
          : questions.map((question) => (
              <ScaleRadios
                key={question.id}
                name={`score-${question.id}`}
                label={question.prompt}
                options={question.options.map((option) => ({
                  value: String(option.value),
                  label: option.label,
                }))}
                value={scores[question.id] || ""}
                onChange={(value) =>
                  setScores((current) => ({ ...current, [question.id]: value }))
                }
              />
            ))}
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          {reviewOnly ? null : (
            <OverallStarRating value={overall} onChange={setOverall} />
          )}
          <Checkbox
            isSelected={reviewOnly}
            name="reviewOnly"
            onChange={setReviewOnly}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              只写点评不评分
            </Checkbox.Content>
            <Description>
              建议尽量评分，方便同学比较选课。勾选后本次可不填推荐度和三档题。
            </Description>
          </Checkbox>
        </div>
        <TextField
          isInvalid={!!noteError}
          isRequired
          name="comment"
          value={note}
          onChange={onNoteChange}
        >
          <Label>详细评价</Label>
          <TextArea className="w-full" rows={6} />
          {noteError ? <FieldError>{noteError}</FieldError> : null}
        </TextField>
        <TextField
          name="grade"
          value={grade}
          onChange={(value) => setGrade(value.replace(/\D/g, "").slice(0, 3))}
        >
          <Label>你的成绩</Label>
          <Input inputMode="numeric" maxLength={3} placeholder="选填" />
          <Description>选填。分享成绩，方便同学们综合判断。</Description>
        </TextField>

        {config?.turnstileSiteKey ? (
          <TurnstileBox
            collapsed={!revealWidget}
            siteKey={config.turnstileSiteKey}
            widgetRef={widgetRef}
            onReadyChange={onReadyChange}
          />
        ) : null}

        <Checkbox
          isSelected={loginOnly}
          name="loginOnly"
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

        <div className="flex flex-wrap gap-2">
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
        </div>
        <StatusMessage msg={msg} />
      </Form>
    </section>
  );
}
