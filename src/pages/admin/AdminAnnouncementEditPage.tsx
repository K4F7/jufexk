import {
  Alert,
  Button,
  Card,
  Description,
  Form,
  Input,
  Label,
  TextArea,
  TextField,
} from "@heroui/react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DetailLoadingStatus } from "../../components/DetailFeedback";
import { api } from "../../lib/api";
import type { Announcement } from "../../lib/types";
import { AdminLayout } from "./AdminGate";

const DEFAULT_AUTHOR = "站务组";

/**
 * 公告发布 / 编辑（/admin/announcements/:id，`new` 为新建）。
 * 编辑时从公开列表取当前内容预填；保存后回到公告栏。
 */
export function AdminAnnouncementEditPage() {
  const { id } = useParams();
  const isNew = id === "new" || !id;
  return (
    <AdminLayout
      title={isNew ? "发布公告" : "编辑公告"}
      description="公告为纯文本，公开页面只读展示。"
    >
      {isNew ? <AnnouncementForm /> : <ExistingAnnouncementLoader id={id!} />}
    </AdminLayout>
  );
}

function ExistingAnnouncementLoader({ id }: { id: string }) {
  const [existing, setExisting] = useState<Announcement | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api<{ items: Announcement[] }>("/api/announcements")
      .then((d) => {
        if (cancelled) return;
        const hit = d.items.find((a) => String(a.id) === id);
        if (hit) setExisting(hit);
        else setError("找不到这条公告，可能已被删除。");
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <DetailLoadingStatus label="公告加载中…" />;
  if (error) {
    return (
      <Alert role="alert" status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>加载失败</Alert.Title>
          <Alert.Description>{error}</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }
  return <AnnouncementForm existing={existing ?? undefined} />;
}

function AnnouncementForm({ existing }: { existing?: Announcement }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  const [author, setAuthor] = useState(existing?.author || DEFAULT_AUTHOR);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const body = JSON.stringify({ title, content, author });
      if (existing) {
        await api(`/api/admin/announcements/${existing.id}`, {
          method: "PUT",
          body,
        });
      } else {
        await api("/api/admin/announcements", {
          method: "POST",
          body,
        });
      }
      navigate("/announcements");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <Card.Content>
        <Form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <TextField
            fullWidth
            isRequired
            name="title"
            value={title}
            onChange={setTitle}
          >
            <Label>标题</Label>
            <Input />
          </TextField>
          <TextField
            fullWidth
            isRequired
            name="author"
            value={author}
            onChange={setAuthor}
          >
            <Label>署名</Label>
            <Input />
            <Description>一般填站务组。</Description>
          </TextField>
          <TextField
            fullWidth
            isRequired
            name="content"
            value={content}
            onChange={setContent}
          >
            <Label>内容</Label>
            <TextArea className="w-full" rows={8} />
          </TextField>
          <div className="flex gap-2">
            <Button isPending={pending} type="submit" variant="primary">
              提交
            </Button>
            <Button
              type="button"
              variant="tertiary"
              onPress={() => navigate("/announcements")}
            >
              取消
            </Button>
          </div>
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
      </Card.Content>
    </Card>
  );
}
