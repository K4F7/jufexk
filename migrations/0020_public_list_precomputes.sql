-- Precomputed public catalogue projections for issue #247.
CREATE TABLE public_precompute_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  dirty INTEGER NOT NULL DEFAULT 1 CHECK(dirty IN (0,1)),
  fingerprint TEXT NOT NULL DEFAULT ''
);
INSERT INTO public_precompute_state(id,dirty) VALUES(1,1);

CREATE TABLE public_course_canonicals (
  course_id INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  canonical_course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  family_label TEXT,
  search_text TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_public_course_canonicals_canonical
  ON public_course_canonicals(canonical_course_id);
CREATE INDEX idx_public_course_canonicals_family
  ON public_course_canonicals(family_label);

CREATE TABLE public_review_counts (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  review_count INTEGER NOT NULL CHECK(review_count >= 0),
  PRIMARY KEY(course_id,teacher_id)
);
CREATE INDEX idx_public_review_counts_course
  ON public_review_counts(course_id);
CREATE INDEX idx_public_review_counts_teacher
  ON public_review_counts(teacher_id);

CREATE INDEX idx_courses_name ON courses(name);
CREATE INDEX idx_courses_department ON courses(department);
CREATE INDEX idx_teachers_name ON teachers(name);
CREATE INDEX idx_teachers_department ON teachers(department);
CREATE INDEX idx_course_teachers_teacher_course
  ON course_teachers(teacher_id,course_id);
