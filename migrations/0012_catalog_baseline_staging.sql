CREATE TABLE catalog_baseline_uploads(
  batch_id TEXT PRIMARY KEY CHECK(length(batch_id) BETWEEN 1 AND 80),
  approved_schema_version TEXT NOT NULL CHECK(approved_schema_version='catalog-baseline-approved-manifest/v1'),
  approved_manifest_content_sha256 TEXT NOT NULL CHECK(length(approved_manifest_content_sha256)=64),
  artifact_sha256 TEXT NOT NULL CHECK(length(artifact_sha256)=64),
  artifact_bytes INTEGER NOT NULL CHECK(artifact_bytes>=0),
  artifact_records INTEGER NOT NULL CHECK(artifact_records>=0),
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 10000),
  source_capture_manifest_content_sha256 TEXT NOT NULL CHECK(length(source_capture_manifest_content_sha256)=64),
  derivation_content_sha256 TEXT NOT NULL CHECK(length(derivation_content_sha256)=64),
  quality_manifest_content_sha256 TEXT NOT NULL CHECK(length(quality_manifest_content_sha256)=64),
  decisions_sha256 TEXT NOT NULL CHECK(length(decisions_sha256)=64),
  boundary_fixture_content_sha256 TEXT NOT NULL CHECK(length(boundary_fixture_content_sha256)=64),
  expected_courses INTEGER NOT NULL CHECK(expected_courses>=0),
  expected_teachers INTEGER NOT NULL CHECK(expected_teachers>=0),
  expected_relations INTEGER NOT NULL CHECK(expected_relations>=0),
  status TEXT NOT NULL DEFAULT 'uploading' CHECK(status IN('uploading','staged','published')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  staged_at TEXT,
  published_at TEXT
);

CREATE TABLE catalog_baseline_chunks(
  batch_id TEXT NOT NULL REFERENCES catalog_baseline_uploads(batch_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),
  chunk_id TEXT NOT NULL CHECK(length(chunk_id) BETWEEN 1 AND 100),
  records INTEGER NOT NULL CHECK(records>=0),
  bytes INTEGER NOT NULL CHECK(bytes>=0),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  content TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(batch_id,chunk_index),
  UNIQUE(batch_id,chunk_id)
);

CREATE TABLE catalog_baseline_staged_courses(
  batch_id TEXT NOT NULL REFERENCES catalog_baseline_uploads(batch_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  course_code TEXT NOT NULL CHECK(length(trim(course_code))>0),
  name TEXT NOT NULL CHECK(length(trim(name))>0),
  category TEXT NOT NULL CHECK(category IN('general','sports')),
  source_json TEXT NOT NULL,
  PRIMARY KEY(batch_id,course_code)
);
CREATE TABLE catalog_baseline_staged_course_names(
  batch_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  course_code TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>0),
  PRIMARY KEY(batch_id,course_code,name),
  FOREIGN KEY(batch_id) REFERENCES catalog_baseline_uploads(batch_id) ON DELETE CASCADE
);
CREATE TABLE catalog_baseline_staged_teachers(
  batch_id TEXT NOT NULL REFERENCES catalog_baseline_uploads(batch_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  source_teacher_label TEXT NOT NULL CHECK(length(trim(source_teacher_label))>0),
  display_name TEXT NOT NULL CHECK(length(trim(display_name))>0),
  source_json TEXT NOT NULL,
  PRIMARY KEY(batch_id,source_teacher_label)
);
CREATE TABLE catalog_baseline_staged_relations(
  batch_id TEXT NOT NULL REFERENCES catalog_baseline_uploads(batch_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  course_code TEXT NOT NULL,
  source_teacher_label TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  source_json TEXT NOT NULL,
  PRIMARY KEY(batch_id,course_code,source_teacher_label),
  FOREIGN KEY(batch_id) REFERENCES catalog_baseline_uploads(batch_id) ON DELETE CASCADE
);

CREATE TABLE catalog_baseline_marker(
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  batch_id TEXT NOT NULL UNIQUE,
  approved_schema_version TEXT NOT NULL,
  approved_manifest_content_sha256 TEXT NOT NULL UNIQUE CHECK(length(approved_manifest_content_sha256)=64),
  artifact_sha256 TEXT NOT NULL UNIQUE CHECK(length(artifact_sha256)=64),
  source_capture_manifest_content_sha256 TEXT NOT NULL CHECK(length(source_capture_manifest_content_sha256)=64),
  derivation_content_sha256 TEXT NOT NULL CHECK(length(derivation_content_sha256)=64),
  quality_manifest_content_sha256 TEXT NOT NULL CHECK(length(quality_manifest_content_sha256)=64),
  decisions_sha256 TEXT NOT NULL CHECK(length(decisions_sha256)=64),
  boundary_fixture_content_sha256 TEXT NOT NULL CHECK(length(boundary_fixture_content_sha256)=64),
  courses INTEGER NOT NULL,
  teachers INTEGER NOT NULL,
  relations INTEGER NOT NULL,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE catalog_relation_provenance(
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  query_id TEXT NOT NULL,
  page INTEGER NOT NULL CHECK(page>=1),
  row_number INTEGER NOT NULL CHECK(row_number>=1),
  semester TEXT NOT NULL,
  education_level TEXT NOT NULL,
  grade TEXT NOT NULL,
  PRIMARY KEY(course_id,teacher_id,query_id,page,row_number,semester,education_level,grade),
  FOREIGN KEY(course_id,teacher_id) REFERENCES course_teachers(course_id,teacher_id) ON DELETE CASCADE
);

CREATE INDEX idx_catalog_baseline_chunks_batch ON catalog_baseline_chunks(batch_id,chunk_index);
CREATE INDEX idx_catalog_baseline_staged_relations_batch ON catalog_baseline_staged_relations(batch_id);
