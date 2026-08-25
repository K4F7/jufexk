/**
 * 排课模拟 /schedule：教务驱动选课流程。
 * 协议闸门失败：只导入/导出版本化 DTO，页面加载不访问教务（Issue #540）。
 * 只做电脑端；窄屏进入弹一次告示（Issue #565）。
 */
import { Alert, Button, Card, Typography } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { relationDetailHref } from "../components/CourseRelationRow";
import { JwxtCourseBrowser } from "../components/JwxtCourseBrowser";
import { JwxtRefreshPanel } from "../components/JwxtRefreshPanel";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { ScheduleMobileNotice } from "../components/ScheduleMobileNotice";
import { ScheduleTimetable } from "../components/ScheduleTimetable";
import { useViewer } from "../hooks/useViewer";
import {
  loadSnapshotCaches,
} from "../lib/jwxt-cache";
import type { JwxtOffering } from "../lib/jwxt-offering";
import {
  includedItems,
  itemToStaged,
  itemsOf,
  joinOffering,
  loadPlan,
  removeItem,
  savePlan,
  setIncluded,
  type PlannedItem,
  type SchedulePlanV2,
} from "../lib/jwxt-plan";
import {
  mergeSnapshots,
  snapshotSelectionKey,
  type JwxtSnapshotV1,
} from "../lib/jwxt-snapshot";
import { conflictMessage, listConflicts } from "../lib/schedule-plan";

function upsertSnapshotList(current: JwxtSnapshotV1[], incoming: JwxtSnapshotV1): {
  snapshots: JwxtSnapshotV1[];
  merged: JwxtSnapshotV1;
} {
  const key = snapshotSelectionKey(incoming);
  const cached = current.find((item) => snapshotSelectionKey(item) === key);
  const merged = cached ? mergeSnapshots(cached, incoming) : incoming;
  return {
    snapshots: [...current.filter((item) => snapshotSelectionKey(item) !== key), merged],
    merged,
  };
}

function PlanCard({
  item,
  canEdit,
  onExclude,
  onRemove,
}: {
  item: PlannedItem;
  canEdit: boolean;
  onExclude: () => void;
  onRemove: () => void;
}) {
  const title = item.teacherName ? `${item.courseName}（${item.teacherName}）` : item.courseName;
  const href = item.courseId > 0 ? relationDetailHref({ course_id: item.courseId, teacher_id: item.teacherId }) : "";
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
          {item.courseCode || "无课号"}
          {item.section ? ` · 班${item.section}` : ""}
          {item.origin === "enrolled" ? " · 已选" : item.origin === "public" ? " · 公选" : item.origin === "legacy" ? " · 旧计划" : " · 计划内"}
          {item.included ? "" : " · 已排除"}
        </Card.Description>
      </Card.Header>
      <Card.Footer className="flex flex-wrap gap-2">
        {item.origin === "enrolled" ? (
          <Button size="sm" variant="ghost" onPress={() => canEdit && onExclude()}>
            {item.included ? "排除" : "恢复"}
          </Button>
        ) : (
          <Button size="sm" variant="danger" onPress={() => canEdit && onRemove()}>
            移出课表
          </Button>
        )}
      </Card.Footer>
    </Card>
  );
}

export function SchedulePage() {
  const { viewer } = useViewer();
  const canEdit = viewer.authenticated;
  const [plan, setPlan] = useState<SchedulePlanV2>(() => loadPlan());
  const [snapshot, setSnapshot] = useState<JwxtSnapshotV1 | null>(null);
  const [notice, setNotice] = useState("");
  const [joinError, setJoinError] = useState("");
  const [cacheReady, setCacheReady] = useState(false);
  const snapshotsRef = useRef<JwxtSnapshotV1[]>([]);
  const interactionVersion = useRef(0);

  useEffect(() => {
    savePlan(plan);
  }, [plan]);

  useEffect(() => {
    let cancelled = false;
    const startedAtVersion = interactionVersion.current;
    void loadSnapshotCaches()
      .then((cached) => {
        if (!cancelled) {
          let merged = snapshotsRef.current;
          for (const item of cached) merged = upsertSnapshotList(merged, item).snapshots;
          snapshotsRef.current = merged;
          if (interactionVersion.current === startedAtVersion) {
            setSnapshot((current) => current ?? merged[0] ?? null);
          }
        }
      })
      .catch(() => {
        if (!cancelled && interactionVersion.current === startedAtVersion) {
          setNotice("无法读取 IndexedDB 教务缓存；本次仍可在当前页面导入和查看。");
        }
      })
      .finally(() => {
        if (!cancelled) setCacheReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const termItems = itemsOf(plan, snapshot?.term.id || plan.activeTermId);
  const staged = useMemo(
    () => includedItems(plan, snapshot?.term.id || plan.activeTermId).map(itemToStaged),
    [plan, snapshot],
  );
  const conflicts = useMemo(() => listConflicts(staged), [staged]);

  function handleFilters(patch: Partial<Pick<JwxtSnapshotV1, "term" | "educationLevel" | "grade" | "major">>) {
    if (!snapshot) return;
    interactionVersion.current += 1;
    const selection = { ...snapshot, ...patch };
    const cached = snapshotsRef.current.find(
      (item) => snapshotSelectionKey(item) === snapshotSelectionKey(selection),
    );
    setSnapshot(cached ?? {
      ...selection,
      captured: [],
      enrolled: [],
      planned: [],
      publicElectives: [],
    });
  }

  function handleJoin(offering: JwxtOffering, origin: "planned" | "public") {
    if (!canEdit || !snapshot) return;
    const result = joinOffering({ ...plan, activeTermId: snapshot.term.id }, offering, origin, snapshot.term.id);
    if (!result.ok) {
      setJoinError(`${offering.courseName}与${result.collideName}时间冲突，未加入。`);
      return;
    }
    setJoinError("");
    setPlan(result.plan);
    setNotice(result.swapped ? `已将${offering.courseName}换到班${offering.section || "新班次"}。` : `已加入${offering.courseName}。`);
  }

  return (
    <section>
      <ScheduleMobileNotice />
      <header aria-label="排课模拟标题" className="mb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Typography
              className="m-0 text-lg font-bold leading-tight tracking-tight text-foreground"
              type="h1"
            >
              排课模拟
            </Typography>
            <p className="mb-0 mt-1 text-sm text-muted">提前处理掉早八刺客</p>
          </div>
          <JwxtRefreshPanel
            canEdit={canEdit}
            csrfToken={viewer.csrfToken || ""}
            loginHref={`${viewer.loginPath}?from=${encodeURIComponent("/schedule")}`}
          />
        </div>
      </header>

      {notice ? (
        <Alert className="mb-4" role="status">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>教务数据</Alert.Title>
            <Alert.Description>{notice}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {joinError ? (
        <Alert className="mb-4" role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>无法加入</Alert.Title>
            <Alert.Description>{joinError}</Alert.Description>
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

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          {cacheReady && !snapshot ? (
            <p className="text-sm text-muted" role="status">
              还没有教务数据。点「刷新教务数据」后，再按年级、专业浏览已选、计划内和公共选修。
            </p>
          ) : snapshot ? (
            <JwxtCourseBrowser
              snapshot={snapshot}
              planItems={termItems}
              canEdit={canEdit}
              onFilters={handleFilters}
              onJoin={handleJoin}
              onToggle={(item, included) =>
                setPlan(setIncluded(plan, item.key, included, item.termId))
              }
            />
          ) : (
            <p className="text-sm text-muted" role="status">
              正在读取本机缓存…
            </p>
          )}

          <Typography className="mb-2 mt-6 text-sm font-semibold" type="h2">
            本学期计划
          </Typography>
          {termItems.length === 0 ? (
            <p className="text-sm text-muted" role="status">
              计划还是空的。从已选或候选里加入开课班。
            </p>
          ) : (
            <div aria-label="本学期计划" role="region">
              {termItems.map((item) => (
                <PlanCard
                  key={item.key}
                  item={item}
                  canEdit={canEdit}
                  onExclude={() => setPlan(setIncluded(plan, item.key, !item.included, item.termId))}
                  onRemove={() => setPlan(removeItem(plan, item.key, item.termId))}
                />
              ))}
            </div>
          )}
        </div>

        <ScheduleTimetable courses={staged} />
      </div>
    </section>
  );
}
