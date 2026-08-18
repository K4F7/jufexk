-- Precomputed public course counts for teacher catalogue rows.
CREATE TABLE public_teacher_course_counts (
  teacher_id INTEGER PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
  course_count INTEGER NOT NULL CHECK(course_count >= 0)
);
CREATE INDEX idx_public_teacher_course_counts_count
  ON public_teacher_course_counts(course_count);
