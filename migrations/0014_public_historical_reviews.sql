CREATE TABLE public_historical_reviews(
  id TEXT PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  comment TEXT NOT NULL CHECK(trim(comment) <> ''),
  package_contract TEXT NOT NULL,
  approved_package_manifest_sha256 TEXT NOT NULL,
  approved_catalog_content_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_public_historical_reviews_course
  ON public_historical_reviews(course_id, id);
CREATE INDEX idx_public_historical_reviews_teacher
  ON public_historical_reviews(teacher_id, id);

CREATE TRIGGER public_historical_reviews_relation_insert
BEFORE INSERT ON public_historical_reviews
WHEN NOT EXISTS(
  SELECT 1 FROM course_teachers
  WHERE course_id=NEW.course_id AND teacher_id=NEW.teacher_id
)
BEGIN
  SELECT RAISE(ABORT, 'historical review requires an existing course-teacher relation');
END;

CREATE TRIGGER public_historical_reviews_relation_update
BEFORE UPDATE OF course_id, teacher_id ON public_historical_reviews
WHEN NOT EXISTS(
  SELECT 1 FROM course_teachers
  WHERE course_id=NEW.course_id AND teacher_id=NEW.teacher_id
)
BEGIN
  SELECT RAISE(ABORT, 'historical review requires an existing course-teacher relation');
END;

CREATE TRIGGER public_historical_reviews_relation_delete_guard
BEFORE DELETE ON course_teachers
WHEN EXISTS(
  SELECT 1 FROM public_historical_reviews
  WHERE course_id=OLD.course_id AND teacher_id=OLD.teacher_id
)
BEGIN
  SELECT RAISE(ABORT, 'course-teacher relation has public historical reviews');
END;
