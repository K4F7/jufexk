import {
  Alert,
  Button,
  Form,
  Label,
  ListBox,
  Select,
  Table,
  TextField,
  Input,
} from "@heroui/react";
import { useCallback, useEffect, useRef, useState, type Key } from "react";
import { DetailLoadingStatus } from "../../components/DetailFeedback";
import { api } from "../../lib/api";
import { categoryLabel } from "../../lib/labels";
import { PE_SKILL_FAMILIES } from "../../lib/public-course-presentation";
import type { CatalogRequest, Paginated } from "../../lib/types";
import { AdminLayout } from "./AdminGate";

const STATUSES = [
  { id: "pending", label: "待审核" },
  { id: "approved", label: "已通过" },
  { id: "rejected", label: "已驳回" },
  { id: "all", label: "全部" },
] as const;

function selectKey(value: Key | Key[] | null): string {
  if (value == null || Array.isArray(value)) return "";
  return String(value);
}

export function AdminCatalogRequestsPage() {
  return (
    <AdminLayout
      title="目录补充申请"
      description="批准后才会写入课程目录。体育伞形课必须指定具体专项；专项课名按课名自动映射。"
    >
      <CatalogRequestsEditor />
    </AdminLayout>
  );
}

function CatalogRequestsEditor() {
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState<Paginated<CatalogRequest> | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [specializations, setSpecializations] = useState<Record<number, string>>({});
  const [rejectNotes, setRejectNotes] = useState<Record<number, string>>({});
  const loadRequest = useRef(0);

  const load = useCallback(async (next = status) => {
    const request = ++loadRequest.current;
    const listed = await api<Paginated<CatalogRequest>>(
      `/api/admin/catalog-requests?status=${encodeURIComponent(next)}`,
    );
    if (request === loadRequest.current) setData(listed);
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((caught) => {
        if (!cancelled) setError((caught as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const approve = async (row: CatalogRequest) => {
    setError("");
    setMessage("");
    setPending(true);
    try {
      await api(`/api/admin/catalog-requests/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "approved",
          peSpecialization: specializations[row.id] || row.suggestedSpecialization || "",
        }),
      });
      setMessage("已批准并写入目录");
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  };

  const reject = async (row: CatalogRequest) => {
    const note = (rejectNotes[row.id] || "").trim();
    if (!note) {
      setError("驳回必须填写理由");
      return;
    }
    setError("");
    setMessage("");
    setPending(true);
    try {
      await api(`/api/admin/catalog-requests/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "rejected", note }),
      });
      setMessage("已驳回");
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  };

  if (loading) return <DetailLoadingStatus label="目录补充申请加载中…" />;

  return (
    <div className="grid gap-4">
      <Form className="flex flex-wrap items-end gap-3">
        <Select
          className="w-[180px]"
          value={status}
          variant="secondary"
          onChange={(key) => setStatus(selectKey(key) || "pending")}
        >
          <Label>筛选</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {STATUSES.map((item) => (
                <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                  {item.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <span className="text-sm text-muted">共 {data?.total ?? 0} 条</span>
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

      {data?.items?.length ? (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="目录补充申请" className="min-w-[720px]">
              <Table.Header>
                <Table.Column isRowHeader>申请</Table.Column>
                <Table.Column>课号 / 类别</Table.Column>
                <Table.Column>教师</Table.Column>
                <Table.Column>审核</Table.Column>
              </Table.Header>
              <Table.Body>
                {data.items.map((row) => (
                  <Table.Row id={String(row.id)} key={row.id}>
                    <Table.Cell>
                      {row.kind === "course" ? "课程" : "教师"} ·{" "}
                      {row.course_name || row.teacher_name}
                      {row.note ? ` · ${row.note}` : ""}
                    </Table.Cell>
                    <Table.Cell>
                      {row.course_code || "—"} / {categoryLabel(row.category)}
                    </Table.Cell>
                    <Table.Cell>{row.teacher_name || "—"}</Table.Cell>
                    <Table.Cell>
                      {row.status === "pending" ? (
                        <Form
                          className="flex flex-col gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void approve(row);
                          }}
                        >
                          {row.peSourceKind === "umbrella" ? (
                            <Select
                              isRequired
                              className="min-w-[140px]"
                              placeholder="具体专项"
                              value={specializations[row.id] || null}
                              variant="secondary"
                              onChange={(key) =>
                                setSpecializations((current) => ({
                                  ...current,
                                  [row.id]: selectKey(key),
                                }))
                              }
                            >
                              <Label>具体专项</Label>
                              <Select.Trigger>
                                <Select.Value />
                                <Select.Indicator />
                              </Select.Trigger>
                              <Select.Popover>
                                <ListBox>
                                  {PE_SKILL_FAMILIES.map((family) => (
                                    <ListBox.Item
                                      key={family.label}
                                      id={family.label}
                                      textValue={family.label}
                                    >
                                      {family.label}
                                      <ListBox.ItemIndicator />
                                    </ListBox.Item>
                                  ))}
                                </ListBox>
                              </Select.Popover>
                            </Select>
                          ) : row.peSourceKind === "direct_skill" ? (
                            <span className="text-sm text-muted">
                              将映射为 {row.suggestedSpecialization}
                            </span>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <Button isPending={pending} type="submit" variant="primary">
                              批准
                            </Button>
                          </div>
                          <TextField
                            name={`reject-${row.id}`}
                            value={rejectNotes[row.id] || ""}
                            onChange={(value) =>
                              setRejectNotes((current) => ({
                                ...current,
                                [row.id]: value,
                              }))
                            }
                          >
                            <Label>驳回理由</Label>
                            <Input />
                          </TextField>
                          <Button
                            isPending={pending}
                            type="button"
                            variant="danger"
                            onPress={() => void reject(row)}
                          >
                            驳回
                          </Button>
                        </Form>
                      ) : (
                        <span className="text-sm text-muted">
                          {row.status === "approved" ? "已通过" : "已驳回"}
                          {row.moderator_note ? ` · ${row.moderator_note}` : ""}
                        </span>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      ) : (
        <p className="m-0 text-sm text-muted">没有补充申请。</p>
      )}
    </div>
  );
}
