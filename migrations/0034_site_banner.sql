CREATE TABLE site_banner_current (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  desktop_html TEXT NOT NULL DEFAULT '',
  mobile_html TEXT NOT NULL DEFAULT '',
  updated_by_session_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO site_banner_current(id) VALUES(1);

CREATE TABLE site_banner_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  desktop_html TEXT NOT NULL,
  mobile_html TEXT NOT NULL,
  actor_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_site_banner_history_created
  ON site_banner_history(created_at DESC, id DESC);
