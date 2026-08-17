/**
 * PROTOTYPE — review-recognition (throwaway; not production-ready).
 *
 * Question (issue #74, 承接 #70): 任课评价文字流条目（#71 冻结结构）的
 * footer 上，「认可」低强度信号的按钮位置、强调程度、登录提示、pending
 * 与失败恢复如何表达？
 *
 * 内存 stub，不调用生产接口；无 dislike / 负向状态 / 按认可排序；
 * 历史评价与纯评分记录不显示认可控件（统一匿名流不标注来源）。
 * 即使视觉冻结，也需等普通用户认证、唯一约束与幂等 API 就绪后
 * 另开 frontend/backend Issue 才进入生产。
 *
 * A — footer 右置：发布时间居左，认可 Button（含计数）居右端
 * B — footer 左置：认可 Button（含计数）居左，发布时间以 · 跟随
 * C — 动作与计数分离：Button 只含「认可」动作，计数为独立 muted 文本
 *
 * 控件用标准 Button（issue 明确要求）而非 ToggleButton：isPending 在
 * ToggleButton 上无官方对应；selected 状态经 aria-pressed 暴露。
 * 条目结构沿用 #71 文字流（身份 · 学期 · 总体评分 / 正文 / footer），
 * 认可控件只加入 footer，不改条目其余部分。
 *
 * Mounted via CourseDetailPage when ?module=review-recognition&variant=A|B|C (DEV only).
 */
import { Button, Separator, Spinner } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RouterAriaLink } from "../components/RouterAriaLink";

export type ReviewRecognitionVariantKey = "A" | "B" | "C";

const KEYS: ReviewRecognitionVariantKey[] = ["A", "B", "C"];

export function isReviewRecognitionVariantKey(
  key: string,
): key is ReviewRecognitionVariantKey {
  return (KEYS as string[]).includes(key);
}

export type ReviewRecognitionModel = {
  /** Host entity label for a11y / state dump */
  hostLabel: string;
};

type Persona = "user" | "guest";

/** ok = 约 0.7s 后确认；fail-create = 建立总是失败并回滚；never = 慢网络永不返回。 */
type StubBehavior = "ok" | "fail-create" | "never";

type DemoEntry = {
  id: number;
  teacherId: number | null;
  teacherName: string;
  term: string | null;
  /** 总体评分（#66 展示契约，1-5，0.5 步进）；null 表示该评价无评分 */
  score: number | null;
  publishedAt: string | null;
  note: string;
  initialCount: number;
  initialEndorsed: boolean;
  behavior: StubBehavior;
};

type RecognitionState = {
  /** Displayed count — optimistic while pending, server-confirmed otherwise. */
  count: number;
  endorsed: boolean;
  pending: "create" | "withdraw" | null;
  error: string | null;
  loginPrompted: boolean;
};

const STUB_LATENCY_MS = 700;

const VARIANT_HINT: Record<
  ReviewRecognitionVariantKey,
  { title: string; lookFor: string }
> = {
  A: {
    title: "A — footer 右置",
    lookFor:
      "发布时间居左，认可 Button（ghost · 含计数）居 footer 右端；动作区与元信息两端分离",
  },
  B: {
    title: "B — footer 左置",
    lookFor:
      "认可 Button（ghost · 含计数）居左，发布时间以 · 跟随；动作区成为 footer 起点",
  },
  C: {
    title: "C — 动作与计数分离",
    lookFor:
      "Button 只含「认可 / 已认可」动作；计数为独立 muted 文本「N 人认可」，居左",
  },
};

/**
 * DEMO — wipe after visual freeze (#74).
 * 每条 note 自述演示目的；计数两两不同，便于 smoke 按可访问名唯一定位。
 */
const DEMO_ENTRIES: DemoEntry[] = [
  {
    id: -301,
    teacherId: 1,
    teacherName: "林晓雯",
    term: "2024-2025-2",
    score: 4.6,
    publishedAt: "2025-06-18T10:20:00Z",
    note: "（演示 · 零计数）例题扎实，作业量适中。这条评价还没有人认可：按钮不显示计数，也不带任何负面视觉。",
    initialCount: 0,
    initialEndorsed: false,
    behavior: "ok",
  },
  {
    id: -302,
    teacherId: 2,
    teacherName: "陈启明",
    term: "2024-2025-1",
    score: 4,
    publishedAt: "2025-01-09T08:00:00Z",
    note: "（演示 · 非零计数）节奏偏快，建议提前预习。点「认可」后计数乐观 +1，stub 约 0.7 秒后确认；再点一次撤回。",
    initialCount: 3,
    initialEndorsed: false,
    behavior: "ok",
  },
  {
    id: -303,
    teacherId: 3,
    teacherName: "王若舟",
    term: "2023-2024-2",
    score: 5,
    publishedAt: "2024-07-02T14:30:00Z",
    note: "（演示 · 已认可）课堂案例多、板书清晰。我已认可这条评价：按钮呈按下态；再点一次进入撤回中，stub 确认后恢复未认可。",
    initialCount: 5,
    initialEndorsed: true,
    behavior: "ok",
  },
  {
    id: -304,
    teacherId: 4,
    teacherName: "赵敏",
    term: "2022-2023-1",
    score: 3,
    publishedAt: "2023-01-15T09:00:00Z",
    note: "（演示 · 大计数）三位数认可用于检查 footer 对齐与折行；计数原样显示，不引入缩写或封顶。",
    initialCount: 128,
    initialEndorsed: false,
    behavior: "ok",
  },
  {
    id: -305,
    teacherId: 7,
    teacherName: "何清",
    term: "2022-2023-1",
    score: 4,
    publishedAt: "2023-02-20T09:00:00Z",
    note: "（演示 · 失败恢复）这条的 stub 建立总是失败：点「认可」先乐观 +1，随后恢复服务器确认的计数并给出错误提示。",
    initialCount: 2,
    initialEndorsed: false,
    behavior: "fail-create",
  },
  {
    id: -306,
    teacherId: 6,
    teacherName: "周慧",
    term: "2024-2025-1",
    score: 4.5,
    publishedAt: "2025-03-20T11:00:00Z",
    note: "（演示 · 慢网络建立中）这条的 stub 永不返回：点「认可」后一直停在建立中，按钮保持禁用，无法重复激活。",
    initialCount: 1,
    initialEndorsed: false,
    behavior: "never",
  },
  {
    id: -307,
    teacherId: 8,
    teacherName: "吴桐",
    term: "2024-2025-1",
    score: null,
    publishedAt: "2025-04-02T09:30:00Z",
    note: "（演示 · 慢网络撤回中）我已认可且 stub 永不返回：点「已认可」后一直停在撤回中。",
    initialCount: 4,
    initialEndorsed: true,
    behavior: "never",
  },
];

function formatPublishedAt(iso: string | null): string {
  if (!iso) return "发布时间未标注";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "发布时间未标注";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 与 #71 文字流一致：整数不带小数点，半分保留一位。 */
function formatScore(score: number | null): string | null {
  if (score === null || score === undefined || Number.isNaN(Number(score))) {
    return null;
  }
  const n = Number(score);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function buttonText(state: RecognitionState): string {
  if (state.pending === "create") return "认可中…";
  if (state.pending === "withdraw") return "撤回中…";
  return state.endorsed ? "已认可" : "认可";
}

/** 动作 + 状态 + 计数全部进入可访问名（含 pending）；可见文本保持「认可」术语。 */
function buttonAriaLabel(state: RecognitionState): string {
  if (state.pending === "create") {
    return `正在建立认可，当前 ${state.count} 人认可`;
  }
  if (state.pending === "withdraw") {
    return `正在撤回认可，当前 ${state.count} 人认可`;
  }
  if (state.endorsed) {
    return `已认可，按下可撤回我的认可，当前 ${state.count} 人认可`;
  }
  return state.count > 0
    ? `认可这条评价，当前 ${state.count} 人认可`
    : "认可这条评价，还没有人认可";
}

function useRecognitionStubs(entries: DemoEntry[]) {
  const [states, setStates] = useState<Record<number, RecognitionState>>(
    () =>
      Object.fromEntries(
        entries.map((e) => [
          e.id,
          {
            count: e.initialCount,
            endorsed: e.initialEndorsed,
            pending: null,
            error: null,
            loginPrompted: false,
          },
        ]),
      ) as Record<number, RecognitionState>,
  );
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const clearLoginPrompts = useCallback(() => {
    setStates((prev) => {
      const next: Record<number, RecognitionState> = { ...prev };
      for (const id of Object.keys(next)) {
        const s = next[Number(id)];
        if (s.loginPrompted) next[Number(id)] = { ...s, loginPrompted: false };
      }
      return next;
    });
  }, []);

  const press = useCallback(
    (entry: DemoEntry, persona: Persona) => {
      const s = states[entry.id];
      if (!s || s.pending) return;

      if (persona === "guest") {
        setStates((prev) => ({
          ...prev,
          [entry.id]: { ...prev[entry.id], loginPrompted: true },
        }));
        return;
      }

      const action: "create" | "withdraw" = s.endorsed ? "withdraw" : "create";
      /** 服务器确认快照 — 失败时恢复，页面不留下错误计数。 */
      const confirmed = { count: s.count, endorsed: s.endorsed };

      setStates((prev) => ({
        ...prev,
        [entry.id]: {
          ...prev[entry.id],
          endorsed: action === "create",
          count: s.count + (action === "create" ? 1 : -1),
          pending: action,
          error: null,
          loginPrompted: false,
        },
      }));

      if (entry.behavior === "never") return;
      const timer = setTimeout(() => {
        timers.current.delete(entry.id);
        setStates((prev) => {
          const cur = prev[entry.id];
          if (!cur) return prev;
          if (entry.behavior === "fail-create" && action === "create") {
            return {
              ...prev,
              [entry.id]: {
                ...cur,
                endorsed: confirmed.endorsed,
                count: confirmed.count,
                pending: null,
                error: "认可失败，已恢复服务器确认的计数。请重试。",
              },
            };
          }
          return { ...prev, [entry.id]: { ...cur, pending: null } };
        });
      }, STUB_LATENCY_MS);
      timers.current.set(entry.id, timer);
    },
    [states],
  );

  return { states, press, clearLoginPrompts };
}

/**
 * 认可 Button — HeroUI v3 低强调 ghost Button（标准 Button，键盘可预测）。
 * selected 经 aria-pressed 暴露；pending 经 isPending 自动禁用避免重复激活；
 * 零计数不显示数字（无负面视觉）。
 */
function RecognitionControl({
  state,
  countPlacement,
  onPress,
}: {
  state: RecognitionState;
  countPlacement: "inside" | "split";
  onPress: () => void;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button
        size="sm"
        variant="ghost"
        isPending={state.pending !== null}
        aria-pressed={state.endorsed}
        aria-label={buttonAriaLabel(state)}
        className="aria-pressed:bg-accent-soft aria-pressed:text-accent"
        onPress={onPress}
      >
        {({ isPending }) => (
          <>
            {isPending ? <Spinner color="current" size="sm" /> : null}
            {buttonText(state)}
            {countPlacement === "inside" && state.count > 0 ? (
              <span className="tabular">· {state.count}</span>
            ) : null}
          </>
        )}
      </Button>
      {countPlacement === "split" && state.count > 0 ? (
        <span className="tabular text-xs text-muted">
          {state.count} 人认可
        </span>
      ) : null}
    </span>
  );
}

function EntryFooter({
  variant,
  entry,
  state,
  onPress,
}: {
  variant: ReviewRecognitionVariantKey;
  entry: DemoEntry;
  state: RecognitionState;
  onPress: () => void;
}) {
  const published = formatPublishedAt(entry.publishedAt);
  const time = (
    <time
      dateTime={entry.publishedAt || undefined}
      aria-label={`发布时间 ${published}`}
      className="text-xs text-muted"
    >
      {published}
    </time>
  );
  const control = (
    <RecognitionControl
      state={state}
      countPlacement={variant === "C" ? "split" : "inside"}
      onPress={onPress}
    />
  );

  return (
    <>
      {variant === "A" ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {time}
          {control}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          {control}
          <span className="text-muted" aria-hidden>
            ·
          </span>
          {time}
        </div>
      )}
      {state.error ? (
        <p role="alert" className="mb-0 mt-1.5 text-xs text-danger">
          {state.error}
        </p>
      ) : null}
      {state.loginPrompted ? (
        <p role="status" className="mb-0 mt-1.5 text-xs text-muted">
          登录后才能认可评价（原型不模拟登录流程）。
        </p>
      ) : null}
    </>
  );
}

function RecognitionEntry({
  variant,
  entry,
  state,
  onPress,
}: {
  variant: ReviewRecognitionVariantKey;
  entry: DemoEntry;
  state: RecognitionState;
  onPress: () => void;
}) {
  const term = entry.term || "学期未标注";
  const scoreLabel = formatScore(entry.score);
  const ariaParts = [
    "任课评价",
    entry.teacherName,
    term,
    scoreLabel ? `总体评分 ${scoreLabel}` : null,
  ].filter(Boolean);

  return (
    <article className="py-4" aria-label={ariaParts.join(" · ")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        {entry.teacherId ? (
          <RouterAriaLink
            to={`/teachers/${entry.teacherId}`}
            className="font-semibold text-foreground underline-offset-4 hover:underline"
          >
            {entry.teacherName}
          </RouterAriaLink>
        ) : (
          <span className="font-semibold text-foreground">
            {entry.teacherName}
          </span>
        )}
        <span className="text-muted" aria-hidden>
          ·
        </span>
        <span className="text-muted">{term}</span>
        {scoreLabel ? (
          <>
            <span className="text-muted" aria-hidden>
              ·
            </span>
            <span className="tabular font-semibold text-accent">
              {scoreLabel}
              <span className="text-xs font-normal text-muted">/5</span>
            </span>
          </>
        ) : null}
      </div>
      <p className="my-2 text-sm leading-relaxed text-foreground">
        {entry.note}
      </p>
      <EntryFooter
        variant={variant}
        entry={entry}
        state={state}
        onPress={onPress}
      />
    </article>
  );
}

function PrototypeBanner({
  variant,
  persona,
  onPersona,
  stateLine,
}: {
  variant: ReviewRecognitionVariantKey;
  persona: Persona;
  onPersona: (p: Persona) => void;
  stateLine: string;
}) {
  const hint = VARIANT_HINT[variant];
  return (
    <div
      className="mb-4 rounded-lg border border-dashed border-accent/40 bg-accent-soft/40 px-3 py-2 text-xs text-muted"
      role="note"
    >
      <div>
        <strong className="text-foreground">{hint.title}</strong>
        <span className="mx-1.5 text-border">·</span>
        看：{hint.lookFor}
      </div>
      <div className="mt-1.5 text-[11px] text-muted">
        内存 stub（约 0.7s 确认 / 建立失败回滚 / 慢网络永不返回）·
        不调用生产接口 · 零计数不显示数字（无负面视觉）· 无 dislike /
        负向状态 / 按认可排序 · 历史评价与纯评分不带认可控件（数据规则，
        统一匿名流不标注来源，此处不作演示）
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-muted">身份</span>
        <Button
          size="sm"
          variant={persona === "user" ? "secondary" : "ghost"}
          onPress={() => onPersona("user")}
        >
          登录用户
        </Button>
        <Button
          size="sm"
          variant={persona === "guest" ? "secondary" : "ghost"}
          onPress={() => onPersona("guest")}
        >
          未登录访客
        </Button>
        <span className="text-[11px] text-muted">
          访客点「认可」得到诚实登录提示，不产生任何状态变化
        </span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-foreground/80">
        state: {stateLine}
      </div>
    </div>
  );
}

export function ReviewRecognitionPrototype({
  variant,
  model,
}: {
  variant: ReviewRecognitionVariantKey;
  model: ReviewRecognitionModel;
}) {
  const [persona, setPersona] = useState<Persona>("user");
  const { states, press, clearLoginPrompts } = useRecognitionStubs(DEMO_ENTRIES);

  useEffect(() => {
    clearLoginPrompts();
  }, [persona, clearLoginPrompts]);

  const endorsedCount = DEMO_ENTRIES.filter((e) => states[e.id]?.endorsed).length;
  const pendingCount = DEMO_ENTRIES.filter((e) => states[e.id]?.pending).length;
  const stateLine = [
    `variant=${variant}`,
    `persona=${persona}`,
    `entries=${DEMO_ENTRIES.length}`,
    `endorsed=${endorsedCount}`,
    `pending=${pendingCount}`,
  ].join(" · ");

  return (
    <div
      data-prototype="review-recognition"
      data-variant={variant}
      data-persona={persona}
    >
      <PrototypeBanner
        variant={variant}
        persona={persona}
        onPersona={setPersona}
        stateLine={stateLine}
      />
      <section aria-labelledby="review-recognition-heading">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="review-recognition-heading"
            className="m-0 text-[17px] font-bold leading-snug"
          >
            任课评价
          </h2>
          <p className="m-0 text-[13px] text-muted">
            认可原型 · {DEMO_ENTRIES.length} 条演示评价
          </p>
        </div>
        <div role="list" aria-label="任课评价列表（认可原型）">
          {DEMO_ENTRIES.map((e, i) => (
            <div key={e.id} role="listitem">
              {i > 0 ? <Separator /> : null}
              <RecognitionEntry
                variant={variant}
                entry={e}
                state={states[e.id]}
                onPress={() => press(e, persona)}
              />
            </div>
          ))}
        </div>
      </section>
      <p className="sr-only" aria-live="polite">
        变体 {variant} · 身份 {persona === "user" ? "登录用户" : "未登录访客"} ·
        已认可 {endorsedCount} 条 · 宿主 {model.hostLabel}
      </p>
    </div>
  );
}
