CREATE TABLE rate_limit_counters(
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0)
);
CREATE INDEX idx_rate_limit_counters_window ON rate_limit_counters(window_start);

CREATE TABLE review_dedupe(
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_review_dedupe_created ON review_dedupe(created_at);

ALTER TABLE admin_sessions ADD COLUMN session_id TEXT;
UPDATE admin_sessions SET session_id=lower(hex(randomblob(16))) WHERE session_id IS NULL;
CREATE UNIQUE INDEX idx_admin_sessions_session_id ON admin_sessions(session_id);
CREATE INDEX idx_admin_sessions_active ON admin_sessions(revoked_at,expires_at);
