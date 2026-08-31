import { Alert, Card, Table, Typography } from "@heroui/react";
import { useEffect, useState } from "react";
import { DetailLoadingStatus } from "../../components/DetailFeedback";
import { api } from "../../lib/api";
import type { AdminBiPayload } from "../../lib/admin-bi";
import { AdminLayout } from "./AdminGate";

const EVENT_LABELS: Record<string, string> = {
  review_view: "课评浏览",
  review_dwell: "课评停留",
  login_view: "打开登录页",
  login_submit: "尝试登录",
  login_success: "登录成功",
  login_fail: "登录失败",
};

/**
 * 站内产品分析（#814）：注册增长来自 D1，课评浏览/停留/登录来自 Analytics Engine。
 */
export function AdminBiPage() {
  return (
    <AdminLayout
      title="数据"
      description="注册用户来自站内账号表；课评浏览、停留和登录尝试来自 Cloudflare Analytics Engine。游客 UV 仍可在 Web Analytics 对照。"
    >
      <BiDashboard />
    </AdminLayout>
  );
}

function BiDashboard() {
  const [data, setData] = useState<AdminBiPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api<AdminBiPayload>("/api/admin/bi")
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((caught) => {
        if (!cancelled) setError((caught as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <DetailLoadingStatus label="加载数据…" />;
  if (error) {
    return (
      <Alert role="alert" status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>无法加载</Alert.Title>
          <Alert.Description>{error}</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }
  if (!data) return null;

  return (
    <div className="grid gap-3">
      <Card>
        <Card.Header>
          <Card.Title>注册用户</Card.Title>
          <Card.Description>累计 {data.total_users} 人（不含保留号）</Card.Description>
        </Card.Header>
        <Card.Content>
          {data.days.length === 0 ? (
            <Typography className="text-sm text-muted">还没有注册用户。</Typography>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label="注册用户日增长">
                  <Table.Header>
                    <Table.Column isRowHeader>日期</Table.Column>
                    <Table.Column>新增</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {data.days.map((row) => (
                      <Table.Row key={row.day} id={row.day}>
                        <Table.Cell>{row.day}</Table.Cell>
                        <Table.Cell>{row.new_users}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          )}
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>课评浏览与登录</Card.Title>
          <Card.Description>
            {data.events.range
              ? `近 ${data.events.range.days} 天的 Analytics Engine 事件`
              : "需要配置 BI_ANALYTICS_READ_TOKEN 后才会显示"}
          </Card.Description>
        </Card.Header>
        <Card.Content className="grid gap-3">
          {!data.events.configured ? (
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>尚未配置读取令牌</Alert.Title>
                <Alert.Description>
                  生产 Worker 设置 Account Analytics Read 的 BI_ANALYTICS_READ_TOKEN 后，这里会显示课评浏览、平均停留和登录尝试。
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : data.events.error ? (
            <Alert role="alert" status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Analytics Engine 暂时读不到</Alert.Title>
                <Alert.Description>注册曲线仍可用。稍后刷新本页。</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : (data.events.by_event || []).length === 0 ? (
            <Typography className="text-sm text-muted">还没有课评或登录事件。</Typography>
          ) : (
            <>
              <Table>
                <Table.ScrollContainer>
                  <Table.Content aria-label="课评与登录事件">
                    <Table.Header>
                      <Table.Column isRowHeader>事件</Table.Column>
                      <Table.Column>身份</Table.Column>
                      <Table.Column>次数</Table.Column>
                      <Table.Column>平均停留</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {(data.events.by_event || []).map((row) => (
                        <Table.Row
                          key={`${row.event}:${row.actor}`}
                          id={`${row.event}:${row.actor}`}
                        >
                          <Table.Cell>{EVENT_LABELS[row.event] || row.event}</Table.Cell>
                          <Table.Cell>{row.actor === "user" ? "登录用户" : "游客"}</Table.Cell>
                          <Table.Cell>{row.n}</Table.Cell>
                          <Table.Cell>
                            {row.event === "review_dwell" && row.avg_ms != null
                              ? `${Math.round(row.avg_ms / 1000)} 秒`
                              : "—"}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
              {(data.events.top_relations || []).length > 0 ? (
                <Table>
                  <Table.ScrollContainer>
                    <Table.Content aria-label="课评浏览排行">
                      <Table.Header>
                        <Table.Column isRowHeader>课程</Table.Column>
                        <Table.Column>教师</Table.Column>
                        <Table.Column>浏览</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {(data.events.top_relations || []).map((row) => (
                          <Table.Row
                            key={`${row.course_id}:${row.teacher_id}`}
                            id={`${row.course_id}:${row.teacher_id}`}
                          >
                            <Table.Cell>{row.course_id}</Table.Cell>
                            <Table.Cell>{row.teacher_id || "—"}</Table.Cell>
                            <Table.Cell>{row.views}</Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              ) : null}
            </>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
