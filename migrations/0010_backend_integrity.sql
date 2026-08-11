DROP TRIGGER IF EXISTS protect_seed_relation_references;
DROP TRIGGER IF EXISTS protect_seed_course_references;
DROP TRIGGER IF EXISTS protect_seed_teacher_references;

ALTER TABLE legacy_reviews ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE legacy_reviews ADD COLUMN duplicate_action TEXT NOT NULL DEFAULT ''
  CHECK(duplicate_action IN('','keep'));
