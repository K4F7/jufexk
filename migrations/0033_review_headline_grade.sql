-- Review headline + optional grade (issue #444).
-- headline：一句话总结本课，新投稿必填（应用层校验 1–80 字）；既有行回填空串。
-- grade：你的成绩，选填（应用层校验 ≤20 字，空串存 NULL）；不进入 AI 总结提示词。
-- Numbered 0033 because main already shipped 0032_jxuf_course_plan_attributes.sql.
ALTER TABLE reviews ADD COLUMN headline TEXT NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN grade TEXT;
