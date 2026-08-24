ALTER TABLE course_teachers ADD COLUMN ai_summary_source_hash TEXT NOT NULL DEFAULT '';

-- Queue delivery is at least once. A relation-scoped lease prevents duplicate
-- messages for the same course/teacher pair from invoking the model together,
-- while unrelated pairs can be consumed concurrently.
CREATE TABLE summary_recompute_leases (
  course_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  lease_token TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  PRIMARY KEY (course_id, teacher_id)
);
