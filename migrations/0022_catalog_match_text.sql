-- Course/teacher catalog search projections for issue #282.
-- search_text stays the PE-family blob; match_text is the per-course search surface.
ALTER TABLE public_course_canonicals ADD COLUMN match_text TEXT NOT NULL DEFAULT '';
ALTER TABLE public_course_canonicals ADD COLUMN teacher_variant_text TEXT NOT NULL DEFAULT '';

CREATE TABLE public_teacher_search (
  teacher_id INTEGER PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
  match_text TEXT NOT NULL DEFAULT ''
);
