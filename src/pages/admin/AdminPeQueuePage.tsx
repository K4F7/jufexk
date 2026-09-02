import {
  Alert,
  Button,
  Card,
  Description,
  Form,
  Label,
  ListBox,
  Select,
  Table,
  TextField,
  Input,
} from "@heroui/react";
import { useCallback, useEffect, useState, type Key } from "react";
import { DetailLoadingStatus } from "../../components/DetailFeedback";
import { api } from "../../lib/api";
import type { PeQueueCloseoutCounts, PeQueueRow } from "../../lib/types";
import { HISTORICAL_WITHHOLD_REASON } from "../../lib/pe-queue-closeout";
import { PE_SKILL_FAMILIES } from "../../lib/public-course-presentation";
import { AdminLayout } from "./AdminGate";

const FILTERS = [
  { id: "open", label: "未处置" },
  { id: "mapped", label: "已映射" },
  { id: "withheld_permanent_exception", label: "暂不公开" },
  { id: "conflict_recapture", label: "冲突" },
  { id: "all", label: "全部" },
] as const;

const DISPOSITIONS = [
  { id: "mapped", label: "映射到专项" },
  { id: "withheld_permanent_exception", label: "暂不公开" },
  { id: "conflict_recapture", label: "冲突待重采" },
] as const;

function selectKey(value: Key | Key[] | null): string {
  if (value == null || Array.isArray(value)) return "";
  return String(value);
}

function dispositionLabel(value: string | null): string {
  if (value === "mapped") return "已映射";
  if (value === "withheld_permanent_exception") return "暂不公开";
  if (value === "conflict_recapture") return "冲突";
  return "未处置";
}

function SpecializationSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      className="min-w-[140px]"
      placeholder="专项"
      value={value || null}
      variant="secondary"
      onChange={(key) => onChange(selectKey(key))}
    >
      <Label>专项</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {PE_SKILL_FAMILIES.map((family) => (
            <ListBox.Item key={family.label} id={family.label} textValue={family.label}>
              {family.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function AdminPeQueuePage() {
  return (
    <AdminLayout
      title="体育专项收口"
      description="历史未映射伞形课一次性处置：明确映射、暂不公开永久例外，或标记冲突。暂不公开与冲突可再次处置；已映射不直接改写。"
    >
      <PeQueueEditor />
    </AdminLayout>
  );
}

function PeQueueEditor() {
  const [status, setStatus] = useState("open");
  const [items, setItems] = useState<PeQueueRow[] | null>(null);
  const [counts, setCounts] = useState<PeQueueCloseoutCounts | null>(null);
  const [frozen, setFrozen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<
    Record<string, { disposition: string; specialization: string; reason: string }>
  >({});

  const load = useCallback(async (next = status) => {
    const [listed, report] = await Promise.all([
      api<{
        items: PeQueueRow[];
        liveEnqueueEnabled: boolean;
        total: number;
      }>(`/api/admin/pe-specialization-queue?status=${encodeURIComponent(next)}`),
      api<{ counts: PeQueueCloseoutCounts; liveEnqueueEnabled: boolean }>(
        "/api/admin/pe-specialization-queue/report",
      ),
    ]);
    setItems(listed.items);
    setFrozen(!listed.liveEnqueueEnabled);
    setCounts(report.counts);
  }, [status]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setLoading(false));
  }, [load]);

  const draftKey = (row: PeQueueRow) => `${row.courseId}:${row.teacherId}`;
  const draftOf = (row: PeQueueRow) =>
    drafts[draftKey(row)] ?? {
      disposition: row.disposition ?? "withheld_permanent_exception",
      specialization: "",
      reason: row.dispositionReason || HISTORICAL_WITHHOLD_REASON,
    };
  const canRedispose = (row: PeQueueRow) => row.disposition !== "mapped";

  const applyOne = async (row: PeQueueRow) => {
    const draft = draftOf(row);
    setError("");
    setMessage("");
    setPending(true);
    try {
      await api("/api/admin/pe-specialization-queue/dispositions", {
        method: row.disposition ? "PATCH" : "POST",
        body: JSON.stringify({
          items: [
            {
              courseId: row.courseId,
              teacherId: row.teacherId,
              disposition: draft.disposition,
              specialization: draft.specialization,
              reason: draft.reason,
            },
          ],
        }),
      });
      setMessage("已写入处置");
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  };

  const closeout = async () => {
    setError("");
    setMessage("");
    setPending(true);
    try {
      const result = await api<{
        counts: PeQueueCloseoutCounts;
        allDisposed: boolean;
      }>("/api/admin/pe-specialization-queue/closeout", { method: "POST" });
      setMessage(
        `已按证据规则收口：映射 ${result.counts.mapped}，暂不公开 ${result.counts.withheld}，冲突 ${result.counts.conflict}`,
      );
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  };

  if (loading) return <DetailLoadingStatus label="体育专项队列加载中…" />;

  return (
    <div className="grid gap-4">
      <Card>
        <Card.Header>
          <Card.Title>收口状态</Card.Title>
          <Card.Description>
            {frozen ? "长期映射队列已冻结，仅保留历史记录。" : "队列仍可入队。"}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <p className="m-0 text-sm">
            已映射 {counts?.mapped ?? 0} · 暂不公开 {counts?.withheld ?? 0} · 冲突{" "}
            {counts?.conflict ?? 0} · 未处置 {counts?.open ?? 0}
          </p>
        </Card.Content>
        <Card.Footer>
          <Button isPending={pending} variant="primary" onPress={() => void closeout()}>
            按证据规则一次性收口
          </Button>
        </Card.Footer>
      </Card>

      <Form className="flex flex-wrap items-end gap-3">
        <Select
          className="w-[180px]"
          value={status}
          variant="secondary"
          onChange={(key) => {
            const next = selectKey(key) || "open";
            setStatus(next);
          }}
        >
          <Label>筛选</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {FILTERS.map((filter) => (
                <ListBox.Item key={filter.id} id={filter.id} textValue={filter.label}>
                  {filter.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </Form>

      {message ? (
        <Alert role="status" status="success">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>已更新</Alert.Title>
            <Alert.Description>{message}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {error ? (
        <Alert role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>操作失败</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {items && items.length > 0 ? (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="体育专项处置队列" className="min-w-[720px]">
              <Table.Header>
                <Table.Column isRowHeader>课号</Table.Column>
                <Table.Column>课名</Table.Column>
                <Table.Column>来源教师名</Table.Column>
                <Table.Column>状态</Table.Column>
                <Table.Column>处置</Table.Column>
              </Table.Header>
              <Table.Body>
                {items.map((row) => {
                  const draft = draftOf(row);
                  return (
                    <Table.Row
                      id={`${row.courseId}-${row.teacherId}`}
                      key={`${row.courseId}-${row.teacherId}`}
                    >
                      <Table.Cell>{row.courseCode}</Table.Cell>
                      <Table.Cell>{row.courseName}</Table.Cell>
                      <Table.Cell>{row.sourceTeacherLabel}</Table.Cell>
                      <Table.Cell>
                        {dispositionLabel(row.disposition)}
                        {row.dispositionReason ? ` · ${row.dispositionReason}` : ""}
                      </Table.Cell>
                      <Table.Cell>
                        {canRedispose(row) ? (
                          <Form
                            className="flex flex-col gap-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void applyOne(row);
                            }}
                          >
                            <Select
                              className="min-w-[160px]"
                              value={draft.disposition}
                              variant="secondary"
                              onChange={(key) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [draftKey(row)]: {
                                    ...draft,
                                    disposition: selectKey(key) || draft.disposition,
                                  },
                                }))
                              }
                            >
                              <Label>处置</Label>
                              <Select.Trigger>
                                <Select.Value />
                                <Select.Indicator />
                              </Select.Trigger>
                              <Select.Popover>
                                <ListBox>
                                  {DISPOSITIONS.map((item) => (
                                    <ListBox.Item
                                      key={item.id}
                                      id={item.id}
                                      textValue={item.label}
                                    >
                                      {item.label}
                                      <ListBox.ItemIndicator />
                                    </ListBox.Item>
                                  ))}
                                </ListBox>
                              </Select.Popover>
                            </Select>
                            {draft.disposition === "mapped" ? (
                              <SpecializationSelect
                                value={draft.specialization}
                                onChange={(specialization) =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [draftKey(row)]: { ...draft, specialization },
                                  }))
                                }
                              />
                            ) : null}
                            <TextField
                              name="reason"
                              value={draft.reason}
                              onChange={(reason) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [draftKey(row)]: { ...draft, reason },
                                }))
                              }
                            >
                              <Label>原因</Label>
                              <Input />
                              <Description>
                                暂不公开与冲突可再次写入；已映射记录不能从本页直接改写。
                              </Description>
                            </TextField>
                            <Button isPending={pending} type="submit" variant="secondary">
                              写入
                            </Button>
                          </Form>
                        ) : (
                          row.disposedAt || "—"
                        )}
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      ) : (
        <p className="m-0 text-sm text-muted">没有符合筛选的队列记录。</p>
      )}
    </div>
  );
}
