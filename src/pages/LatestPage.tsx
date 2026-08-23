/**
 * 最新课评 /latest（Issue #402）：页面结构对齐 icourse 首页的最新投稿流。
 * 全站最新公开文字评价接口属 #410，未上线前本页不请求数据，只渲染
 * 明确标注的占位状态；接口就绪后这里恢复为按时间倒序的条目流
 * （占位头像 + 匿名用户 点评了 课程（老师）+ 日期 + 正文 clamp + >>更多）。
 */
import { Typography } from "@heroui/react";
import { RouterAriaLink } from "../components/RouterAriaLink";

export function LatestPage() {
  return (
    <section className="mx-auto w-full max-w-[760px]">
      <header aria-label="最新课评标题" className="mb-3">
        <Typography
          className="m-0 text-lg font-bold leading-tight tracking-tight text-foreground"
          type="h1"
        >
          最新课评
        </Typography>
      </header>
      <div
        className="rounded border border-dashed border-border px-7 py-7 text-center text-muted"
        role="status"
      >
        <div className="font-medium text-foreground">最新课评流暂未接入</div>
        <p className="mb-0 mt-1 text-sm">
          全站点评数据就绪后，这里会按时间倒序列出最新点评；现在先到
          <RouterAriaLink to="/courses" className="text-accent">
            课程列表
          </RouterAriaLink>
          看看，或通过课程页的「写点评」分享第一门课的体验。
        </p>
      </div>
    </section>
  );
}
