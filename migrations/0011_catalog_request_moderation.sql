CREATE TABLE catalog_request_moderation_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_request_id INTEGER NOT NULL REFERENCES catalog_requests(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN('approved','rejected')),
  note TEXT NOT NULL DEFAULT '',
  actor_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_catalog_request_one_decision
  ON catalog_request_moderation_events(catalog_request_id);
CREATE INDEX idx_catalog_request_mod_time
  ON catalog_request_moderation_events(catalog_request_id,created_at DESC,id DESC);
