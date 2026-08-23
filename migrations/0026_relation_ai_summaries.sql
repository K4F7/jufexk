-- 任课关系 AI 总结缓存（#401）：Markdown 正文 + 最近一次成功重算（含清空）时间。
-- 总结是缓存，不是评分；空串表示当前没有总结。
ALTER TABLE course_teachers ADD COLUMN ai_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE course_teachers ADD COLUMN ai_summary_updated_at TEXT;
