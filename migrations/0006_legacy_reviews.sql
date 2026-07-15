CREATE TABLE legacy_import_batches(
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type='legacy_ocr'),
  source_label TEXT NOT NULL,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'preview' CHECK(status IN('preview','approved','imported','rolled_back','failed')),
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  imported_at TEXT,
  rolled_back_at TEXT
);

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
  category TEXT CHECK(category IN('major','pe','general')),
  comment TEXT NOT NULL,
  term TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'legacy_ocr' CHECK(source_type='legacy_ocr'),
  source_label TEXT NOT NULL DEFAULT '腾讯表格历史资料',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
  duplicate_group TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);
CREATE INDEX idx_legacy_reviews_batch ON legacy_reviews(import_batch_id,id);
CREATE INDEX idx_legacy_reviews_status ON legacy_reviews(status,created_at DESC);
CREATE INDEX idx_legacy_reviews_subject ON legacy_reviews(course_id,teacher_id);
CREATE INDEX idx_legacy_batches_status_created ON legacy_import_batches(status,created_at DESC,id);
