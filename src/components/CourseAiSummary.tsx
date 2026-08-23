import { Button, Surface, Typography } from "@heroui/react";
import { useState } from "react";
import type { RelationSummary } from "../lib/types";

export const AI_SUMMARY_DISCLAIMER =
  "AI 总结为根据点评内容自动生成，仅供参考";

/** 超过这个体量默认折叠，点「展开全文」查看（对齐 icourse 长文可折叠）。 */
const COLLAPSE_HTML_LENGTH = 800;

/**
 * 课程 × 教师详情页的任课关系 AI 总结（#401）：简介下、点评上。
 * html 由服务端按极小 Markdown 子集渲染并整体转义（即消毒），
 * 这里只做展示与折叠，不再处理内容。
 */
export function CourseAiSummary({ summary }: { summary: RelationSummary }) {
  const collapsible = summary.html.length > COLLAPSE_HTML_LENGTH;
  const [expanded, setExpanded] = useState(!collapsible);
  return (
    <section className="mb-6" aria-labelledby="course-ai-summary-heading">
      <Typography
        className="m-0 mb-2 text-[calc(17/15*1rem)] font-bold leading-snug"
        id="course-ai-summary-heading"
        type="h2"
      >
        AI 总结
      </Typography>
      <Surface variant="secondary" className="rounded-xl px-4 py-3">
        <div
          className={
            expanded
              ? undefined
              : "max-h-36 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
          }
          dangerouslySetInnerHTML={{ __html: summary.html }}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-2">
          <p className="m-0 text-xs text-muted">
            {AI_SUMMARY_DISCLAIMER}
            {summary.updatedAt ? ` · 更新于 ${summary.updatedAt.slice(0, 10)}` : null}
          </p>
          {collapsible ? (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={expanded}
              onPress={() => setExpanded((value) => !value)}
            >
              {expanded ? "收起" : "展开全文"}
            </Button>
          ) : null}
        </div>
      </Surface>
    </section>
  );
}
