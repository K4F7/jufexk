ALTER TABLE legacy_reviews ADD COLUMN moderator_note TEXT NOT NULL DEFAULT '';

CREATE TABLE legacy_review_moderation_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_review_id INTEGER NOT NULL REFERENCES legacy_reviews(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN('approved','rejected')),
  note TEXT NOT NULL DEFAULT '',
  actor_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_legacy_mod_review_time ON legacy_review_moderation_events(legacy_review_id,created_at DESC,id DESC);
CREATE UNIQUE INDEX idx_legacy_mod_one_decision ON legacy_review_moderation_events(legacy_review_id);
CREATE INDEX idx_legacy_status_batch_created ON legacy_reviews(status,import_batch_id,created_at DESC,id);
