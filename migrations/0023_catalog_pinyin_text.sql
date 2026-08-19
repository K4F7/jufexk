-- Precomputed pinyin / initials for public catalog search (issue #283).
ALTER TABLE public_course_canonicals ADD COLUMN pinyin_text TEXT NOT NULL DEFAULT '';
ALTER TABLE public_teacher_search ADD COLUMN pinyin_text TEXT NOT NULL DEFAULT '';
