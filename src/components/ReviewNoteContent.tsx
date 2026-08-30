import { Typography } from "@heroui/react";
import DOMPurify from "dompurify";
import {
  REVIEW_NOTE_ALLOWED_ATTRS,
  REVIEW_NOTE_ALLOWED_TAGS,
} from "../lib/review-note-html";

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
    const html = DOMPurify.sanitize(comment, {
      ALLOWED_TAGS: [...REVIEW_NOTE_ALLOWED_TAGS],
      ALLOWED_ATTR: [...REVIEW_NOTE_ALLOWED_ATTRS, "target", "rel"],
    });
    return (
      <Typography
        className="review-note-html m-0 break-words leading-relaxed"
        render={(props) => (
          <div
            {...props}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
        type="body-sm"
      />
    );
  }
  return (
    <Typography className="m-0 break-words leading-relaxed" type="body-sm">
      {comment}
    </Typography>
  );
}
