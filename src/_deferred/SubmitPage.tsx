import { Button, Input, TextArea } from "@heroui/react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { TurnstileBox } from "../components/TurnstileBox";
import { api } from "../lib/api";
import { reviewFieldsForCategory, reviewFieldNames } from "../lib/review-fields";
import type {
  CourseOption,
  Offering,
  Paginated,
  SiteConfig,
  Teacher,
} from "../lib/types";

const steps = ["评价对象", "总体评价", "课堂与考核", "确认提交"];
const COURSE_OPTIONS_PAGE_SIZE = 20;
const SEARCH_DELAY = 320;

export function SubmitPage({ config }: { config: SiteConfig | null }) {
  const [step, setStep] = useState(1);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [courseOptions, setCourseOptions] =
    useState<Paginated<CourseOption> | null>(null);
  const [courseQueryDraft, setCourseQueryDraft] = useState("");
  const [courseQuery, setCourseQuery] = useState("");
  const [courseOptionsPage, setCourseOptionsPage] = useState(1);
  const [courseOptionsLoading, setCourseOptionsLoading] = useState(true);
  const [selectedCourseOption, setSelectedCourseOption] =
    useState<CourseOption | null>(null);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [courseId, setCourseId] = useState("");
  const [offeringId, setOfferingId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [overall, setOverall] = useState("");
  const [term, setTerm] = useState("");
  const [comment, setComment] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(!config?.turnstileSiteKey);
  const [submitting, setSubmitting] = useState(false);
  const widgetRef = useRef<string | number | null>(null);

  const selectedCourse = useMemo(
    () =>
      selectedCourseOption ||
      courses.find((c) => String(c.id) === courseId) ||
      null,
    [courses, courseId, selectedCourseOption],
  );
  const visibleCourses = useMemo(() => {
    if (
      !selectedCourseOption ||
      courses.some((course) => course.id === selectedCourseOption.id)
    ) {
      return courses;
    }
    return [selectedCourseOption, ...courses];
  }, [courses, selectedCourseOption]);
  const dynamicFields = reviewFieldsForCategory(selectedCourse?.category || "major");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCourseQuery(courseQueryDraft.trim());
      setCourseOptionsPage(1);
    }, SEARCH_DELAY);
    return () => window.clearTimeout(timer);
  }, [courseQueryDraft]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const query = new URLSearchParams({
      page: String(courseOptionsPage),
      pageSize: String(COURSE_OPTIONS_PAGE_SIZE),
    });
    if (courseQuery) query.set("q", courseQuery);

    setCourseOptionsLoading(true);
    api<Paginated<CourseOption>>(`/api/courses/options?${query}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (cancelled) return;
        setCourseOptions(result);
        setCourses(result.items);
      })
      .catch((e) => {
        if (!cancelled) setMsg((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setCourseOptionsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [courseOptionsPage, courseQuery]);

  useEffect(() => {
    if (!courseId) {
      setOfferings([]);
      setTeachers([]);
      setOfferingId("");
      setTeacherId("");
      return;
    }
    (async () => {
      const [offs, detail] = await Promise.all([
        api<Offering[]>(`/api/offerings?courseId=${courseId}`),
        api<{ course: { teachers: Teacher[] } }>(`/api/courses/${courseId}`),
      ]);
      setOfferings(offs);
      setTeachers(detail.course.teachers || []);
      setOfferingId("");
      setTeacherId("");
      setFields({});
    })().catch((e) => setMsg(e.message));
  }, [courseId]);

  useEffect(() => {
    if (!offeringId) return;
    (async () => {
      const d = await api<{ offering: Offering; teachers: Teacher[] }>(
        `/api/offerings/${offeringId}`,
      );
      setTeachers(d.teachers || []);
      if (!term && d.offering.term) setTerm(d.offering.term);
    })().catch((e) => setMsg(e.message));
  }, [offeringId]);

  function validateStep() {
    if (step === 1) {
      if (!courseId || !teacherId) {
        setMsg("请选择课程和任课教师");
        return false;
      }
    }
    if (step === 2 && !overall) {
      setMsg("请选择总体推荐度");
      return false;
    }
    setMsg("");
    return true;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validateStep()) return;
    setSubmitting(true);
    setMsg("");
    try {
      let turnstileToken = "";
      if (config?.turnstileSiteKey) {
        turnstileToken = window.turnstile?.getResponse(widgetRef.current ?? undefined) || "";
        if (!turnstileToken || !ready) {
          throw new Error("请等待人机验证重新完成后再提交");
        }
      }
      const body: Record<string, unknown> = {
        courseId,
        teacherId,
        offeringId: offeringId || undefined,
        overall,
        term,
        comment,
        website: "",
        turnstileToken,
        ...fields,
      };
      for (const name of reviewFieldNames()) {
        if (!(name in body)) body[name] = fields[name] || "";
      }
      const d = await api<{ message: string }>("/api/reviews", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setMsg(d.message);
      setStep(1);
      setCourseId("");
      setSelectedCourseOption(null);
      setOfferingId("");
      setTeacherId("");
      setOverall("");
      setTerm("");
      setComment("");
      setFields({});
      if (widgetRef.current != null) {
        window.turnstile?.reset(widgetRef.current);
        setReady(false);
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-[720px]">
      <h1 className="mb-1 text-2xl font-bold">写评价</h1>
      <p className="mb-4 mt-0 text-muted">
        评价必须绑定具体任课教师，投稿经审核后公开。只有课程、任课教师和总体推荐度是必填。
      </p>

      <ol className="mb-4 flex list-none gap-1.5 p-0 text-xs text-muted">
        {steps.map((label, i) => {
          const n = i + 1;
          return (
            <li
              key={label}
              className={
                "flex-1 overflow-hidden border-t-[3px] pt-1.5 text-ellipsis whitespace-nowrap " +
                (n === step
                  ? "border-accent font-bold text-foreground"
                  : n < step
                    ? "border-muted"
                    : "border-border")
              }
            >
              {label}
            </li>
          );
        })}
      </ol>

      {config?.turnstileSiteKey ? (
        <div className="mb-4">
          <TurnstileBox
            siteKey={config.turnstileSiteKey}
            widgetRef={widgetRef}
            onReadyChange={(r) => setReady(r)}
          />
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="grid gap-3.5 rounded border border-border bg-surface p-5"
      >
        {step === 1 ? (
          <>
            <label className="field-label">
              搜索课程
              <Input
                fullWidth
                placeholder="输入课程名称、课号或教师"
                value={courseQueryDraft}
                onChange={(e) => setCourseQueryDraft(e.target.value)}
              />
            </label>
            <label className="field-label">
              课程
              <select
                className="field-control"
                required
                value={courseId}
                disabled={courseOptionsLoading && !courses.length}
                onChange={(e) => {
                  const nextCourseId = e.target.value;
                  setCourseId(nextCourseId);
                  setSelectedCourseOption(
                    visibleCourses.find(
                      (course) => String(course.id) === nextCourseId,
                    ) ||
                      null,
                  );
                }}
              >
                <option value="">请选择课程</option>
                {visibleCourses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name} · {c.teachers || "教师待补充"}
                  </option>
                ))}
              </select>
            </label>
            {courseOptions ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
                <span>
                  共 {courseOptions.total} 门课程，当前第 {courseOptions.page}/
                  {courseOptions.pages || 1} 页
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    isDisabled={
                      courseOptionsLoading || courseOptionsPage <= 1
                    }
                    onPress={() => setCourseOptionsPage((page) => page - 1)}
                  >
                    上一页
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    isDisabled={
                      courseOptionsLoading ||
                      courseOptionsPage >= (courseOptions.pages || 1)
                    }
                    onPress={() => setCourseOptionsPage((page) => page + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            ) : null}
            <label className="field-label">
              开课班（选填）
              <select
                className="field-control"
                value={offeringId}
                onChange={(e) => setOfferingId(e.target.value)}
              >
                <option value="">不指定</option>
                {offerings.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.term || "学期未标注"} · {o.section || "默认班"}
                    {o.campus ? ` · ${o.campus}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              任课教师
              <select
                className="field-control"
                required
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
              >
                <option value="">{courseId ? "请选择任课教师" : "请先选择课程"}</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.department}
                  </option>
                ))}
              </select>
            </label>
            <p className="m-0 text-[13px] text-muted">
              找不到你的课程或教师？
              <Link to="/catalog-request" className="underline underline-offset-4">
                提交补充申请
              </Link>
            </p>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <label className="field-label">
              总体推荐度
              <select
                className="field-control"
                required
                value={overall}
                onChange={(e) => setOverall(e.target.value)}
              >
                <option value="">请选择</option>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {selectedCourse?.category === "general" ? (
              <p className="m-0 text-[13px] text-muted">
                请评价这门公共选修课本身的体验。
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {dynamicFields.map((field) =>
                field.kind === "score" ? (
                  <label key={field.name} className="field-label">
                    {field.label}
                    <select
                      className="field-control"
                      value={fields[field.name] || ""}
                      onChange={(e) =>
                        setFields((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                    >
                      <option value="">未评价</option>
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : field.multiline ? (
                  <label key={field.name} className="field-label sm:col-span-2">
                    {field.label}
                    <TextArea
                      fullWidth
                      value={fields[field.name] || ""}
                      onChange={(e) =>
                        setFields((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                    />
                  </label>
                ) : (
                  <label key={field.name} className="field-label">
                    {field.label}
                    <Input
                      fullWidth
                      value={fields[field.name] || ""}
                      onChange={(e) =>
                        setFields((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                    />
                  </label>
                ),
              )}
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <label className="field-label">
              学期（选填）
              <Input
                fullWidth
                placeholder="2025 秋"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </label>
            <label className="field-label">
              补充说明（选填）
              <TextArea
                fullWidth
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <p className="m-0 text-[13px] text-muted">
              投稿匿名提交，经管理员审核后公开；请确认内容真实、不含人身攻击。
            </p>
            <input className="trap" name="website" tabIndex={-1} autoComplete="off" />
          </>
        ) : null}

        <div className="flex justify-end gap-2.5 border-t border-border pt-3.5">
          {step > 1 ? (
            <Button type="button" variant="outline" onPress={() => setStep((s) => s - 1)}>
              上一页
            </Button>
          ) : null}
          {step < 4 ? (
            <Button
              type="button"
              onPress={() => {
                if (validateStep()) setStep((s) => s + 1);
              }}
            >
              下一页
            </Button>
          ) : (
            <Button
              type="submit"
              isDisabled={Boolean(config?.turnstileSiteKey) && !ready}
              isPending={submitting}
            >
              提交审核
            </Button>
          )}
        </div>
        {msg ? <p className="m-0 text-sm text-muted">{msg}</p> : null}
      </form>
    </section>
  );
}
