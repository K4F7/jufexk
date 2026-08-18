-- Versioned review schemes on courses and reviews (issue #232 / ADR-0021).
-- Existing review rows stay NULL; this migration must not backfill them.
ALTER TABLE courses ADD COLUMN scheme_key TEXT
  CHECK(scheme_key IS NULL OR scheme_key IN (
    'major','ideology','math','public_basic','english','pe'
  ));

CREATE TABLE course_tags (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK(tag IN ('mooc')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (course_id, tag)
);
CREATE INDEX idx_course_tags_tag ON course_tags(tag);

ALTER TABLE reviews ADD COLUMN scheme_key TEXT
  CHECK(scheme_key IS NULL OR scheme_key IN (
    'major','ideology','math','public_basic','english','pe'
  ));
ALTER TABLE reviews ADD COLUMN scheme_version INTEGER
  CHECK(scheme_version IS NULL OR scheme_version >= 1);
ALTER TABLE reviews ADD COLUMN scores TEXT;
