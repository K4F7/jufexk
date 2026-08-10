import { Button, Label, SearchField, Spinner, Table } from "@heroui/react";
import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { EmptyBox } from "../components/EmptyBox";
import { SectionHead } from "../components/SectionHead";
import { api } from "../lib/api";
import { scoreText } from "../lib/labels";
import type { Paginated, Teacher } from "../lib/types";

const FILTER_DELAY = 320;

export function TeachersPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const q = params.get("q") || "";
  const parsedPage = Number(params.get("page") || "1");
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const [queryDraft, setQueryDraft] = useState(q);
  const [data, setData] = useState<Paginated<Teacher> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => setQueryDraft(q), [q]);

  useEffect(() => {
    const nextQuery = queryDraft.trim();
    if (nextQuery === q) return;

    const timer = window.setTimeout(() => {
      const sp = new URLSearchParams(params);
      if (nextQuery) sp.set("q", nextQuery);
      else sp.delete("q");
      sp.set("page", "1");
      setParams(sp, { replace: true });
    }, FILTER_DELAY);

    return () => window.clearTimeout(timer);
  }, [queryDraft, q, params, setParams]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    query.set("page", String(page));

    setLoading(true);
    setError("");
    api<Paginated<Teacher>>(`/api/teachers?${query}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || "教师资料加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [q, page]);

  const hasSearch = Boolean(queryDraft.trim() || q);

  function clearSearch() {
    setQueryDraft("");
    const sp = new URLSearchParams(params);
    sp.delete("q");
    sp.set("page", "1");
    setParams(sp, { replace: true });
  }

  const currentPage = data?.pages ? Math.min(data.page, data.pages) : 1;
  const totalPages = data?.pages || 1;

  return (
    <section>
      <div
        aria-label="教师资料筛选"
        className="mb-2.5 flex flex-col gap-2 sm:flex-row sm:items-end"
        role="search"
      >
        <SearchField
          fullWidth
          name="teacher-search"
          value={queryDraft}
          onChange={setQueryDraft}
          className="sm:max-w-[520px]"
        >
          <Label className="sr-only">搜索教师</Label>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input
              className="w-full"
              placeholder="搜索教师姓名或院系"
            />
            <SearchField.ClearButton aria-label="清空教师搜索" />
          </SearchField.Group>
        </SearchField>
        <Button
          className="w-full sm:w-auto"
          isDisabled={!hasSearch}
          onPress={clearSearch}
          size="sm"
          variant="ghost"
        >
          清空搜索
        </Button>
      </div>

      <SectionHead
        title="教师资料"
        meta={data ? `${data.total} 位教师` : ""}
      />

      {loading && data ? (
        <div
          aria-live="polite"
          className="mb-2 flex items-center gap-2 text-sm text-muted"
          role="status"
        >
          <Spinner size="sm" />
          正在更新教师资料…
        </div>
      ) : null}
      {error ? <EmptyBox role="alert">{error}</EmptyBox> : null}
      {loading && !data && !error ? (
        <EmptyBox role="status">加载中…</EmptyBox>
      ) : null}
      {data ? (
        <div aria-busy={loading}>
          <Table className="dense-table">
            <Table.ScrollContainer>
              <Table.Content aria-label="教师资料" className="min-w-[640px]">
                <Table.Header>
                  <Table.Column isRowHeader>姓名</Table.Column>
                  <Table.Column>职称</Table.Column>
                  <Table.Column>院系</Table.Column>
                  <Table.Column>评分</Table.Column>
                  <Table.Column>课程数</Table.Column>
                </Table.Header>
                <Table.Body
                  items={data.items}
                  renderEmptyState={() => (
                    <div className="py-8 text-center text-muted" role="status">
                      {q ? `没有找到匹配“${q}”的教师` : "暂无教师资料"}
                    </div>
                  )}
                >
                  {(teacher) => (
                    <Table.Row
                      id={String(teacher.id)}
                      key={teacher.id}
                      href={`/teachers/${teacher.id}${location.search}`}
                      className="cursor-pointer"
                    >
                      <Table.Cell>
                        <span className="font-semibold">{teacher.name}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="text-muted">{teacher.title || "—"}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="text-muted">{teacher.department}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="tabular font-semibold text-accent">
                          {scoreText(teacher.rating)}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="tabular font-semibold text-accent">
                          {teacher.course_count ?? 0}
                        </span>
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>

          <div className="mt-3 flex items-center justify-center gap-3 text-[13px] text-muted">
            <Button
              size="sm"
              variant="outline"
              isDisabled={loading || currentPage <= 1}
              onPress={() => {
                const sp = new URLSearchParams(params);
                sp.set("page", String(currentPage - 1));
                setParams(sp);
              }}
            >
              上一页
            </Button>
            <span aria-live="polite">
              {currentPage}/{totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              isDisabled={loading || currentPage >= totalPages}
              onPress={() => {
                const sp = new URLSearchParams(params);
                sp.set("page", String(currentPage + 1));
                setParams(sp);
              }}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
