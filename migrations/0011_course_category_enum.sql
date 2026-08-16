CREATE TABLE courses_category_new(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE CHECK(length(trim(code))>0),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN('general','sports')),
  department TEXT NOT NULL DEFAULT '',
  credits REAL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO courses_category_new(id,code,name,category,department,credits,description,created_at)
SELECT id,code,name,
  CASE WHEN category IN('pe','sports') THEN 'sports' ELSE 'general' END,
  department,credits,description,created_at FROM courses;

DROP TRIGGER courses_name_variant_after_insert;
DROP TRIGGER courses_name_variant_after_update;
DROP INDEX idx_reviews_status_created;
DROP INDEX idx_reviews_course_status;
DROP INDEX idx_reviews_teacher_status;
DROP INDEX idx_reviews_offering_status;
DROP INDEX idx_moderation_review_time;
DROP INDEX idx_offerings_course_term;
DROP INDEX idx_legacy_reviews_batch;
DROP INDEX idx_legacy_reviews_status;
DROP INDEX idx_legacy_reviews_subject;
DROP INDEX idx_legacy_status_batch_created;
DROP INDEX idx_legacy_mod_review_time;
DROP INDEX idx_legacy_mod_one_decision;
DROP INDEX idx_catalog_requests_status_created;
DROP INDEX idx_catalog_request_one_decision;
DROP INDEX idx_catalog_request_mod_time;

ALTER TABLE courses RENAME TO courses_category_legacy;
ALTER TABLE courses_category_new RENAME TO courses;

ALTER TABLE course_teachers RENAME TO course_teachers_category_legacy;
CREATE TABLE course_teachers(
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  PRIMARY KEY(course_id,teacher_id)
);
INSERT INTO course_teachers SELECT course_id,teacher_id FROM course_teachers_category_legacy;

ALTER TABLE offerings RENAME TO offerings_category_legacy;
CREATE TABLE offerings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  term TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT '',
  campus TEXT NOT NULL DEFAULT '',
  schedule TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(course_id,term,section)
);
INSERT INTO offerings(id,course_id,term,section,campus,schedule,status,created_at)
SELECT id,course_id,term,section,campus,schedule,status,created_at FROM offerings_category_legacy;

ALTER TABLE reviews RENAME TO reviews_category_legacy;
CREATE TABLE reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  teacher_id INTEGER REFERENCES teachers(id),
  category TEXT NOT NULL CHECK(category IN('general','sports')),
  attendance TEXT NOT NULL DEFAULT '',
  grading TEXT NOT NULL DEFAULT '',
  workload TEXT NOT NULL DEFAULT '',
  rescue TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT '',
  teaching TEXT NOT NULL DEFAULT '',
  clarity INTEGER CHECK(clarity BETWEEN 1 AND 5),
  knowledge INTEGER CHECK(knowledge BETWEEN 1 AND 5),
  overall INTEGER NOT NULL CHECK(overall BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
  moderator_note TEXT NOT NULL DEFAULT '',
  submitter_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  grading_score INTEGER CHECK(grading_score BETWEEN 1 AND 5),
  offering_id INTEGER REFERENCES offerings(id),
  interest INTEGER CHECK(interest BETWEEN 1 AND 5),
  practicality INTEGER CHECK(practicality BETWEEN 1 AND 5),
  workload_score INTEGER CHECK(workload_score BETWEEN 1 AND 5),
  fairness INTEGER CHECK(fairness BETWEEN 1 AND 5),
  organization INTEGER CHECK(organization BETWEEN 1 AND 5)
);
INSERT INTO reviews(id,course_id,teacher_id,category,attendance,grading,workload,rescue,assessment,teaching,clarity,knowledge,overall,comment,term,status,moderator_note,submitter_hash,created_at,reviewed_at,grading_score,offering_id,interest,practicality,workload_score,fairness,organization)
SELECT id,course_id,teacher_id,
  CASE WHEN category IN('pe','sports') THEN 'sports' ELSE 'general' END,
  attendance,grading,workload,rescue,assessment,teaching,clarity,knowledge,overall,comment,term,status,moderator_note,submitter_hash,created_at,reviewed_at,grading_score,offering_id,interest,practicality,workload_score,fairness,organization FROM reviews_category_legacy;

ALTER TABLE review_moderation_events RENAME TO review_moderation_events_category_legacy;
CREATE TABLE review_moderation_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN('approved','rejected','edited')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO review_moderation_events(id,review_id,action,note,created_at)
SELECT id,review_id,action,note,created_at FROM review_moderation_events_category_legacy;

ALTER TABLE offering_teachers RENAME TO offering_teachers_category_legacy;
CREATE TABLE offering_teachers(
  offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  PRIMARY KEY(offering_id,teacher_id)
);
INSERT INTO offering_teachers SELECT offering_id,teacher_id FROM offering_teachers_category_legacy;

ALTER TABLE legacy_reviews RENAME TO legacy_reviews_category_legacy;
CREATE TABLE legacy_reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_batch_id TEXT NOT NULL REFERENCES legacy_import_batches(id),
  source_file TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  source_row TEXT NOT NULL,
  raw_ocr_text TEXT NOT NULL,
  ocr_confidence REAL NOT NULL CHECK(ocr_confidence BETWEEN 0 AND 1),
  ocr_tokens_json TEXT NOT NULL DEFAULT '[]',
  inherited_from TEXT NOT NULL DEFAULT '',
  ocr_course_name TEXT NOT NULL DEFAULT '',
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  ocr_teacher_name TEXT NOT NULL DEFAULT '',
  teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  offering_id INTEGER REFERENCES offerings(id) ON DELETE SET NULL,
  category TEXT CHECK(category IN('general','sports')),
  comment TEXT NOT NULL,
  term TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'legacy_ocr' CHECK(source_type='legacy_ocr'),
  source_label TEXT NOT NULL DEFAULT '腾讯表格历史资料',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
  duplicate_group TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  moderator_note TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  duplicate_action TEXT NOT NULL DEFAULT '' CHECK(duplicate_action IN('','keep'))
);
INSERT INTO legacy_reviews(id,import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,ocr_confidence,ocr_tokens_json,inherited_from,ocr_course_name,course_id,ocr_teacher_name,teacher_id,offering_id,category,comment,term,source_type,source_label,status,duplicate_group,created_at,reviewed_at,moderator_note,review_note,duplicate_action)
SELECT id,import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,ocr_confidence,ocr_tokens_json,inherited_from,ocr_course_name,course_id,ocr_teacher_name,teacher_id,offering_id,
  CASE WHEN category IS NULL THEN NULL WHEN category IN('pe','sports') THEN 'sports' ELSE 'general' END,
  comment,term,source_type,source_label,status,duplicate_group,created_at,reviewed_at,moderator_note,review_note,duplicate_action FROM legacy_reviews_category_legacy;

ALTER TABLE legacy_review_moderation_events RENAME TO legacy_review_moderation_events_category_legacy;
CREATE TABLE legacy_review_moderation_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_review_id INTEGER NOT NULL REFERENCES legacy_reviews(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN('approved','rejected')),
  note TEXT NOT NULL DEFAULT '',
  actor_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO legacy_review_moderation_events(id,legacy_review_id,action,note,actor_session_id,created_at)
SELECT id,legacy_review_id,action,note,actor_session_id,created_at FROM legacy_review_moderation_events_category_legacy;

ALTER TABLE catalog_request_moderation_events RENAME TO catalog_request_moderation_events_category_legacy;
ALTER TABLE catalog_requests RENAME TO catalog_requests_category_legacy;
CREATE TABLE catalog_requests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN('course','teacher')),
  course_code TEXT NOT NULL DEFAULT '',
  course_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '' CHECK(category IN('','general','sports')),
  teacher_name TEXT NOT NULL DEFAULT '',
  teacher_source_label TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  pending_review_json TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
  moderator_note TEXT NOT NULL DEFAULT '',
  created_course_id INTEGER REFERENCES courses(id),
  created_teacher_id INTEGER REFERENCES teachers(id),
  created_review_id INTEGER REFERENCES reviews(id),
  submitter_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);
INSERT INTO catalog_requests(id,kind,course_code,course_name,category,teacher_name,teacher_source_label,department,note,pending_review_json,status,moderator_note,created_course_id,created_teacher_id,created_review_id,submitter_hash,created_at,reviewed_at)
SELECT id,kind,course_code,course_name,
  CASE WHEN category='' THEN '' WHEN category IN('pe','sports') THEN 'sports' ELSE 'general' END,
  teacher_name,teacher_source_label,department,note,pending_review_json,status,moderator_note,created_course_id,created_teacher_id,created_review_id,submitter_hash,created_at,reviewed_at FROM catalog_requests_category_legacy;

CREATE TABLE catalog_request_moderation_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_request_id INTEGER NOT NULL REFERENCES catalog_requests(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN('approved','rejected')),
  note TEXT NOT NULL DEFAULT '',
  actor_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO catalog_request_moderation_events(id,catalog_request_id,action,note,actor_session_id,created_at)
SELECT id,catalog_request_id,action,note,actor_session_id,created_at
FROM catalog_request_moderation_events_category_legacy;

ALTER TABLE course_name_variants RENAME TO course_name_variants_category_legacy;
CREATE TABLE course_name_variants(
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(course_id,name)
);
INSERT INTO course_name_variants(course_id,name,created_at)
SELECT course_id,name,created_at FROM course_name_variants_category_legacy;

DROP TABLE review_moderation_events_category_legacy;
DROP TABLE legacy_review_moderation_events_category_legacy;
DROP TABLE course_teachers_category_legacy;
DROP TABLE offering_teachers_category_legacy;
DROP TABLE catalog_request_moderation_events_category_legacy;
DROP TABLE catalog_requests_category_legacy;
DROP TABLE reviews_category_legacy;
DROP TABLE legacy_reviews_category_legacy;
DROP TABLE offerings_category_legacy;
DROP TABLE course_name_variants_category_legacy;
DROP TABLE courses_category_legacy;

CREATE TRIGGER courses_name_variant_after_insert
AFTER INSERT ON courses
BEGIN
  INSERT OR IGNORE INTO course_name_variants(course_id,name) VALUES(NEW.id,NEW.name);
END;
CREATE TRIGGER courses_name_variant_after_update
AFTER UPDATE OF name ON courses
BEGIN
  INSERT OR IGNORE INTO course_name_variants(course_id,name) VALUES(NEW.id,OLD.name);
  INSERT OR IGNORE INTO course_name_variants(course_id,name) VALUES(NEW.id,NEW.name);
END;

CREATE INDEX idx_reviews_status_created ON reviews(status,created_at DESC);
CREATE INDEX idx_reviews_course_status ON reviews(course_id,status);
CREATE INDEX idx_reviews_teacher_status ON reviews(teacher_id,status);
CREATE INDEX idx_reviews_offering_status ON reviews(offering_id,status);
CREATE INDEX idx_moderation_review_time ON review_moderation_events(review_id,created_at DESC);
CREATE INDEX idx_offerings_course_term ON offerings(course_id,term);
CREATE INDEX idx_legacy_reviews_batch ON legacy_reviews(import_batch_id,id);
CREATE INDEX idx_legacy_reviews_status ON legacy_reviews(status,created_at DESC);
CREATE INDEX idx_legacy_reviews_subject ON legacy_reviews(course_id,teacher_id);
CREATE INDEX idx_legacy_status_batch_created ON legacy_reviews(status,import_batch_id,created_at DESC,id);
CREATE INDEX idx_legacy_mod_review_time ON legacy_review_moderation_events(legacy_review_id,created_at DESC,id DESC);
CREATE UNIQUE INDEX idx_legacy_mod_one_decision ON legacy_review_moderation_events(legacy_review_id);
CREATE INDEX idx_catalog_requests_status_created ON catalog_requests(status,created_at DESC);
CREATE UNIQUE INDEX idx_catalog_request_one_decision
  ON catalog_request_moderation_events(catalog_request_id);
CREATE INDEX idx_catalog_request_mod_time
  ON catalog_request_moderation_events(catalog_request_id,created_at DESC,id DESC);
