CREATE TABLE catalog_requests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN('course','teacher')),
  course_code TEXT NOT NULL DEFAULT '',
  course_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '' CHECK(category IN('','major','pe','general')),
  teacher_name TEXT NOT NULL DEFAULT '',
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
CREATE INDEX idx_catalog_requests_status_created ON catalog_requests(status,created_at DESC);
