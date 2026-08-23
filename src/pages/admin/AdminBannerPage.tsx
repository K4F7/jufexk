import {
  Alert,
  Button,
  Description,
  Form,
  Label,
  Table,
  TextArea,
  TextField,
  Typography,
} from "@heroui/react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { DetailLoadingStatus } from "../../components/DetailFeedback";
import { api } from "../../lib/api";
import { formatReviewDate } from "../../lib/review-date";
import type { BannerRecord, SiteBanner } from "../../lib/types";
import { AdminGate, AdminPageHeader } from "./AdminGate";

/**
 * 全站 Banner 设置（/admin/banner）：桌面版 + 移动版 HTML，
 * 提交后顶栏下方展示；下方列出设置历史。
 */
export function AdminBannerPage() {
  return (
    <AdminGate>
      <section className="max-w-[760px]">
        <AdminPageHeader
          title="全站 Banner"
          description="提交后全站顶栏下方展示；桌面版与移动版分别下发，移动版留空时回落到桌面版。支持 HTML，展示前会再消毒一次。"
        />
        <BannerEditor />
      </section>
    </AdminGate>
  );
}

function BannerEditor() {
  const [desktop, setDesktop] = useState("");
  const [mobile, setMobile] = useState("");
  const [history, setHistory] = useState<BannerRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const [current, records] = await Promise.all([
      api<{ banner: SiteBanner | null }>("/api/site/banner"),
      api<{ items: BannerRecord[] }>("/api/admin/banners"),
    ]);
    setDesktop(current.banner?.desktop_html ?? "");
    setMobile(current.banner?.mobile_html ?? "");
    setHistory(records.items);
  }, []);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [load]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    setPending(true);
    try {
      await api("/api/admin/banner", {
        method: "POST",
        body: JSON.stringify({ desktopHtml: desktop, mobileHtml: mobile }),
      });
      setSaved(true);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  if (loading) {
    return <DetailLoadingStatus label="Banner 设置加载中…" />;
  }

  return (
    <>
      <Form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <TextField fullWidth name="desktopHtml" value={desktop} onChange={setDesktop}>
          <Label>桌面版 banner（支持 HTML）</Label>
          <TextArea className="w-full" rows={3} />
          <Description>留空则桌面端不展示 banner。</Description>
        </TextField>
        <TextField fullWidth name="mobileHtml" value={mobile} onChange={setMobile}>
          <Label>移动版 banner（支持 HTML）</Label>
          <TextArea className="w-full" rows={3} />
          <Description>留空时移动端回落展示桌面版内容。</Description>
        </TextField>
        <div>
          <Button isPending={pending} type="submit" variant="primary">
            提交
          </Button>
        </div>
        {saved ? (
          <Alert role="status" status="success">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>已保存</Alert.Title>
              <Alert.Description>
                新的 banner 已生效，刷新公开页面即可看到。
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        {error ? (
          <Alert role="alert" status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>保存失败</Alert.Title>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
      </Form>

      <Typography className="mb-0 mt-10 text-[16px] font-bold" type="h2">
        设置历史{history ? `（共 ${history.length} 次）` : ""}
      </Typography>
      {history && history.length > 0 ? (
        <Table className="mt-3">
          <Table.ScrollContainer>
            <Table.Content aria-label="banner 设置历史" className="min-w-[560px]">
              <Table.Header>
                <Table.Column isRowHeader>时间</Table.Column>
                <Table.Column>桌面版</Table.Column>
                <Table.Column>移动版</Table.Column>
              </Table.Header>
              <Table.Body>
                {history.map((record) => (
                  <Table.Row key={record.id} id={String(record.id)}>
                    <Table.Cell>
                      <span className="whitespace-nowrap text-[12px] text-muted">
                        {formatReviewDate(record.created_at) || "—"}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="line-clamp-2 break-all text-[12px]">
                        {record.desktop_html || "—"}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="line-clamp-2 break-all text-[12px]">
                        {record.mobile_html || "—"}
                      </span>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      ) : (
        <p className="mt-3 text-[13px] text-muted">还没有设置过 banner。</p>
      )}
    </>
  );
}
