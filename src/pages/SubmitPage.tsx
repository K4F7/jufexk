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
  TextField,
  Typography,
  type Key,
} from "@heroui/react";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ReviewNoteEditor,
  type ReviewNoteValue,
} from "../components/ReviewNoteEditor";
import { TurnstileBox } from "../components/TurnstileBox";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";
import { backTargetFrom } from "../lib/back-target";
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
const OVERALL_SCALE = ["1", "2", "3", "4", "5"] as const;
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
 * （简单/中等/困难…），不再是裸 1/2/3；推荐度仍是 1–5 数字档。
 */
function ScaleRadios({
  name,
  label,
  description,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  description: string;
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
      <Description>{description}</Description>
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
  const [headline, setHeadline] = useState("");
  const [grade, setGrade] = useState("");
  const [note, setNote] = useState<ReviewNoteValue>({ html: "", text: "" });
  const [noteError, setNoteError] = useState("");
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(!config?.turnstileSiteKey);
  const [revealWidget, setRevealWidget] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const widgetRef = useRef<string | number | null>(null);
  const noteEditorRef = useRef<Editor | null>(null);
  const onReadyChange = useCallback((nextReady: boolean) => {
    setReady(nextReady);
  }, []);

  /** 字数门槛按去标签后的纯文本计算，与服务端 validateReviewNote 一致。 */
  const validateNote = useCallback((value: ReviewNoteValue) => {
    const length = value.text.trim().length;
    if (length < REVIEW_NOTE_MIN_LENGTH)
      return `请填写至少 ${REVIEW_NOTE_MIN_LENGTH} 字详细评价`;
    if (length > REVIEW_NOTE_MAX_LENGTH)
      return `详细评价不能超过 ${REVIEW_NOTE_MAX_LENGTH} 字`;
    return "";
  }, []);

  const onNoteChange = useCallback(
    (value: ReviewNoteValue) => {
      setNote(value);
      setNoteError((current) => (current ? validateNote(value) : current));
    },
    [validateNote],
  );

  const questions: ApplicableQuestion[] =
    selectedCourse?.applicableQuestions ?? COMMON_CORE_QUESTIONS;
  const teachers = selectedCourse?.teachers ?? [];
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
  }, [courseQuery]);

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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCourse || !teacherId) {
      setMsg("请选择课程和任课教师");
      return;
    }
    if (questions.some((question) => !scores[question.id]) || !overall) {
      setMsg("请答完本次适用的评分题");
      return;
    }
    // 原生必填已拦截空串；这里兜底纯空白（服务端 trim 后同样拒绝）。
    if (!headline.trim()) {
      setMsg("请填写一句话总结本课");
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
          overall: Number(overall),
          scores: payloadScores,
          headline: headline.trim(),
          grade: grade.trim(),
          comment: note.html,
          term,
          website: "",
          turnstileToken,
        }),
      });
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
        className="mx-auto max-w-xl py-8"
      >
        <Card role="article" aria-labelledby="submit-gate-heading">
          <Card.Header>
            <Card.Title id="submit-gate-heading">写评价</Card.Title>
            <Card.Description>
              {config?.turnstileSiteKey
                ? "评价必须绑定已有任课关系：进入表单后先搜索选择课程，再选择任课教师，然后按该课适用的评价规则答完全部评分题，并填写至少 10 字详细评价。开始填写前请先完成下方人机验证。"
                : "评价必须绑定已有任课关系：进入表单后先搜索选择课程，再选择任课教师，然后按该课适用的评价规则答完全部评分题，并填写至少 10 字详细评价。"}
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="flex flex-col gap-4">
              <StatusMessage msg={msg} />
              {config?.turnstileSiteKey ? (
                <TurnstileBox
                  siteKey={config.turnstileSiteKey}
                  widgetRef={widgetRef}
                  onReadyChange={onReadyChange}
                />
              ) : null}
              <Button isDisabled={!ready} onPress={enterForm}>
                开始填写
              </Button>
            </div>
          </Card.Content>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-[800px]">
      <Typography className="mb-1 text-2xl font-bold" type="h1">
        写评价
      </Typography>
      <p className="mb-4 mt-0 text-muted">
        评价必须绑定已有任课关系。选好课程和教师后，按该课本次适用的评价规则答题；详细评价必填（至少 10 字）。
      </p>

      <Form
        aria-labelledby="submit-review-heading"
        className="flex flex-col gap-5"
        validationBehavior="native"
        onSubmit={onSubmit}
      >
        <span className="sr-only" id="submit-review-heading">
          写评价
        </span>
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
          <Description>搜索课名、课号或教师，再选择要评价的课</Description>
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

        <Select
          isRequired
          isDisabled={!selectedCourse}
          className="w-full"
          name="teacherId"
          value={teacherId || null}
          onChange={(value) => setTeacherId(value ? String(value) : "")}
        >
          <Label>任课教师</Label>
          <Description>
            {selectedCourse
              ? "评价必须绑定具体任课教师"
              : "先选择课程，再选择任课教师"}
          </Description>
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

        <Select
          isRequired
          className="w-full"
          name="term"
          placeholder="请选择学期"
          value={term || null}
          onChange={(value) => setTerm(value ? String(value) : "")}
        >
          <Label>学期</Label>
          <Description>如果不记得了，可以随便选一个 :)</Description>
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
          <FieldError>请选择学期</FieldError>
        </Select>

        {hiddenCoreLabels.length ? (
          <p className="m-0 text-sm text-muted">
            该课程为网课（MOOC），
            {hiddenCoreLabels.map((label) => `「${label}」`).join("、")}
            等仅线下适用的题目无需作答。
          </p>
        ) : null}

        {questions.map((question) => (
          <ScaleRadios
            key={question.id}
            name={`score-${question.id}`}
            label={question.prompt}
            description={question.scale}
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
        <ScaleRadios
          name="overall"
          label="本次推荐度"
          description="1 到 5，分数越高表示越推荐"
          options={OVERALL_SCALE.map((score) => ({ value: score, label: score }))}
          value={overall}
          onChange={setOverall}
        />
        <TextField
          isRequired
          name="headline"
          value={headline}
          onChange={setHeadline}
        >
          <Label>一句话总结本课</Label>
          <Input maxLength={80} />
          <FieldError>请填写一句话总结本课</FieldError>
        </TextField>
        <TextField isInvalid={!!noteError} isRequired name="comment">
          <Label>详细评价</Label>
          <ReviewNoteEditor
            ariaLabel="详细评价"
            editorRef={noteEditorRef}
            isInvalid={!!noteError}
            placeholder={"课程听感:\n作业/任务量:\n关于考试:"}
            onChange={onNoteChange}
          />
          {noteError ? (
            <FieldError>{noteError}</FieldError>
          ) : (
            <Description>
              必填。按纯文本计算 10 到 1200
              字；支持加粗、斜体、链接、列表和引用，多余标签会被丢弃。
            </Description>
          )}
        </TextField>
        <TextField name="grade" value={grade} onChange={setGrade}>
          <Label>你的成绩</Label>
          <Input maxLength={20} placeholder="选填，退课请填W" />
          <Description>
            可选. 分享你的成绩有助于同学们进行更全面的判断.
          </Description>
        </TextField>

        <Checkbox defaultSelected isDisabled name="anonymous">
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            匿名发布
          </Checkbox.Content>
          <Description>评价匿名公开，不展示任何身份信息</Description>
        </Checkbox>

        {config?.turnstileSiteKey ? (
          <TurnstileBox
            collapsed={!revealWidget}
            siteKey={config.turnstileSiteKey}
            widgetRef={widgetRef}
            onReadyChange={onReadyChange}
          />
        ) : null}

        <Button isPending={submitting} type="submit">
          发布
        </Button>
        <StatusMessage msg={msg} />
      </Form>
    </section>
  );
}
