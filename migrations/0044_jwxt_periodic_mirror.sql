-- Independent periodic JWXT mirror. This does not replace offerings or any
-- review foreign key. Class numbers remain private; enrollment counts are not
-- accepted by this schema at all.

CREATE TABLE jwxt_sync_generations (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('pilot','incremental','full')),
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
  state TEXT NOT NULL DEFAULT 'staging'
    CHECK(state IN ('staging','published','superseded')),
  complete INTEGER NOT NULL CHECK(complete IN (0,1)),
  expected_row_count INTEGER NOT NULL CHECK(expected_row_count >= 0),
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);

CREATE TABLE jwxt_sync_generation_rows (
  generation_id TEXT NOT NULL REFERENCES jwxt_sync_generations(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK(length(source_key)=64),
  source_row_sha256 TEXT NOT NULL CHECK(length(source_row_sha256)=64),
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  teacher_source_label TEXT NOT NULL,
  term_id TEXT NOT NULL,
  campus TEXT NOT NULL DEFAULT '',
  week_text TEXT NOT NULL DEFAULT '',
  time_text TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  class_number TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(generation_id,source_key)
);

CREATE INDEX idx_jwxt_sync_generation_rows_generation
  ON jwxt_sync_generation_rows(generation_id);

CREATE TABLE jwxt_sync_offerings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE CHECK(length(source_key)=64),
  source_row_sha256 TEXT NOT NULL CHECK(length(source_row_sha256)=64),
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  teacher_source_label TEXT NOT NULL,
  term_id TEXT NOT NULL,
  campus TEXT NOT NULL DEFAULT '',
  week_text TEXT NOT NULL DEFAULT '',
  time_text TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  class_number TEXT NOT NULL DEFAULT '',
  catalog_course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  catalog_teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  last_seen_generation_id TEXT NOT NULL REFERENCES jwxt_sync_generations(id),
  missing_complete_runs INTEGER NOT NULL DEFAULT 0 CHECK(missing_complete_runs >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','offline')),
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  offline_at TEXT
);

CREATE INDEX idx_jwxt_sync_offerings_public
  ON jwxt_sync_offerings(catalog_course_id,term_id,status);

CREATE TABLE jwxt_sync_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  active_generation_id TEXT REFERENCES jwxt_sync_generations(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO jwxt_sync_state(singleton) VALUES(1);
