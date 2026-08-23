-- 江财培养方案展示字段（#436）：选课类别 / 教学类型 / 课程层次。
-- 评价模板仍用 courses.category；这里只存课表归出的短标签和中段原词。
ALTER TABLE courses ADD COLUMN enrollment_category TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN teaching_type TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN course_level TEXT NOT NULL DEFAULT '';
