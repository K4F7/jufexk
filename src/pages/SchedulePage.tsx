/**
 * 排课模拟 /schedule：教务驱动选课流程。
 * 协议闸门失败：只导入/导出版本化 DTO，页面加载不访问教务（Issue #540）。
 * 只做电脑端；窄屏进入弹一次告示（Issue #565）。
 */
import { Alert, Typography } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { JwxtCourseBrowser } from "../components/JwxtCourseBrowser";
import { JwxtRefreshPanel } from "../components/JwxtRefreshPanel";
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
  mergeEnrolledRefresh,
  removeItem,
  savePlan,
  setIncluded,
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
          const first = merged[0];
          if (interactionVersion.current === startedAtVersion && first) {
            setSnapshot((current) => current ?? first);
            setPlan((current) => mergeEnrolledRefresh(current, first));
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

  function applySnapshot(next: JwxtSnapshotV1) {
    setSnapshot(next);
    setPlan((current) => mergeEnrolledRefresh(current, next));
  }

  function handleFilters(patch: Partial<Pick<JwxtSnapshotV1, "term" | "educationLevel" | "grade" | "major">>) {
    if (!snapshot) return;
    interactionVersion.current += 1;
    const selection = { ...snapshot, ...patch };
    const cached = snapshotsRef.current.find(
      (item) => snapshotSelectionKey(item) === snapshotSelectionKey(selection),
    );
    applySnapshot(cached ?? {
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

  function handleSave() {
    if (!canEdit) return;
    savePlan(plan);
    setNotice("课表已保存到本机。");
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

      <div className="flex flex-col gap-8">
        <div className="min-w-0">
          {cacheReady && !snapshot ? (
            <p className="text-sm text-muted" role="status">
              还没有教务数据。点「刷新教务数据」后，先选择年级和专业，再从选课列表处理课程。
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
              onRemove={(item) => setPlan(removeItem(plan, item.key, item.termId))}
              onSave={handleSave}
            />
          ) : (
            <p className="text-sm text-muted" role="status">
              正在读取本机缓存…
            </p>
          )}
        </div>

        <ScheduleTimetable courses={staged} />
      </div>
    </section>
  );
}
