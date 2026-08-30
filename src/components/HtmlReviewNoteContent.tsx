import { Typography } from "@heroui/react";
import DOMPurify from "dompurify";
import {
  REVIEW_NOTE_ALLOWED_ATTRS,
  REVIEW_NOTE_ALLOWED_TAGS,
} from "../lib/review-note-html";

export default function HtmlReviewNoteContent({ comment }: { comment: string }) {
  const html = DOMPurify.sanitize(comment, {
    ALLOWED_TAGS: [...REVIEW_NOTE_ALLOWED_TAGS],
    ALLOWED_ATTR: [...REVIEW_NOTE_ALLOWED_ATTRS, "target", "rel"],
  });
  return (
    <Typography
      className="review-note-html m-0 break-words leading-relaxed"
      render={(props) => (
        <div {...props} dangerouslySetInnerHTML={{ __html: html }} />
      )}
      type="body-sm"
    />
  );
}
