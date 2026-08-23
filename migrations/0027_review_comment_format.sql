-- Review note rich-text storage marker (issue #400 / ADR-0025).
-- NULL = 纯文本（含全部历史行，不回填）；'html' = 白名单消毒后的 Tiptap HTML。
-- Numbered 0027 because main already shipped 0026_relation_ai_summaries.sql.
ALTER TABLE reviews ADD COLUMN comment_format TEXT
  CHECK(comment_format IS NULL OR comment_format IN ('html'));
