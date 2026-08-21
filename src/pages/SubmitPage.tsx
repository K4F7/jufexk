import {
  Button,
  Card,
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
import { TurnstileBox } from "../components/TurnstileBox";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";
import { backTargetFrom } from "../lib/back-target";
import { COMMON_CORE_QUESTIONS } from "../lib/review-schemes";
import type {
  ApplicableQuestion,
  CourseOption,
  CourseReviewScheme,
  Paginated,
  SiteConfig,
  Teacher,
} from "../lib/types";

const SEARCH_DELAY = 320;
const SCALE = ["1", "2", "3", "4", "5"] as const;
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

function ScaleRadios({
  name,
  label,
  description,
  value,
  onChange,
}: {
  name: string;
  label: string;
  description: string;
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
      {SCALE.map((score) => (
        <Radio key={score} value={score}>
          <Radio.Content>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            {score}
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
  const [scores, setScores] = useState<Record<string, string>>({});
  const [overall, setOverall] = useState("");
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(!config?.turnstileSiteKey);
  const [revealWidget, setRevealWidget] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const widgetRef = useRef<string | number | null>(null);
  const onReadyChange = useCallback((nextReady: boolean) => {
    setReady(nextReady);
  }, []);

  const questions: ApplicableQuestion[] =
    selectedCourse?.applicableQuestions ?? COMMON_CORE_QUESTIONS;
  const teachers = selectedCourse?.teachers ?? [];
  const hiddenCoreLabels = selectedCourse?.tags.includes("mooc")
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
      const result = await api<{ message: string }>("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          courseId: selectedCourse.id,
          teacherId: Number(teacherId),
          overall: Number(overall),
          scores: payloadScores,
          comment,
          website: "",
          turnstileToken,
        }),
      });
      setSelectedCourse(null);
      setTeacherId("");
      setScores({});
      setOverall("");
      setComment("");
      setCourseQueryDraft("");
      // The consumed token cannot be reused; the gate widget remounts and
      // re-verifies automatically, re-enabling the entry button.
      setReady(!config?.turnstileSiteKey);
      setMsg(result.message);
      setPhase("gate");
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
                ? "评价必须绑定已有任课关系：进入表单后先搜索选择课程，再选择任课教师，然后按该课适用的评价规则答完全部评分题；补充说明选填。开始填写前请先完成下方人机验证。"
                : "评价必须绑定已有任课关系：进入表单后先搜索选择课程，再选择任课教师，然后按该课适用的评价规则答完全部评分题；补充说明选填。"}
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
    <section className="mx-auto max-w-[720px]">
      <Typography className="mb-1 text-2xl font-bold" type="h1">
        写评价
      </Typography>
      <p className="mb-4 mt-0 text-muted">
        评价必须绑定已有任课关系。选好课程和教师后，按该课本次适用的评价规则答题；补充说明选填。
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
          value={overall}
          onChange={setOverall}
        />
        <TextField name="comment">
          <Label>补充说明</Label>
          <Description>选填。不写补充说明也可以提交有效评分</Description>
          <TextArea
            fullWidth
            rows={4}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </TextField>

        {config?.turnstileSiteKey ? (
          <TurnstileBox
            collapsed={!revealWidget}
            siteKey={config.turnstileSiteKey}
            widgetRef={widgetRef}
            onReadyChange={onReadyChange}
          />
        ) : null}

        <Button isPending={submitting} type="submit">
          提交评价
        </Button>
        <StatusMessage msg={msg} />
      </Form>
    </section>
  );
}
