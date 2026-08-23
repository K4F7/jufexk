-- Public announcements managed by administrators (issue #462).
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
  content TEXT NOT NULL CHECK(length(trim(content)) BETWEEN 1 AND 10000),
  author TEXT NOT NULL CHECK(length(trim(author)) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_announcements_created
  ON announcements(created_at DESC, id DESC);
