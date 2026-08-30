import { Typography } from "@heroui/react";
import { lazy, Suspense } from "react";

const HtmlReviewNoteContent = lazy(() => import("./HtmlReviewNoteContent"));

/**
 * 补充说明的统一展示（issue #400）：comment_format='html' 的行按白名单
 * 再消毒后渲染富文本；其余（历史与旧纯文本行）按纯文本原样展示。
 * 落库前服务端已消毒，这里用同一份白名单做展示侧的第二层防护。
 */
export function ReviewNoteContent({
  comment,
  commentFormat,
}: {
  comment: string;
  commentFormat?: string | null;
}) {
  if (commentFormat === "html") {
    return (
      <Suspense fallback={<PlainReviewNoteContent comment={comment} />}>
        <HtmlReviewNoteContent comment={comment} />
      </Suspense>
    );
  }
  return <PlainReviewNoteContent comment={comment} />;
}

function PlainReviewNoteContent({ comment }: { comment: string }) {
  return (
    <Typography className="m-0 break-words leading-relaxed" type="body-sm">
      {comment}
    </Typography>
  );
}
