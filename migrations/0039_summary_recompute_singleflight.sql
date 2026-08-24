-- Global single-flight for AI summary recomputes: one relation at a time
-- across Worker isolates, plus a deduped pending queue.

CREATE TABLE IF NOT EXISTS summary_recompute_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  course_id INTEGER,
  teacher_id INTEGER,
  immediate INTEGER NOT NULL DEFAULT 0 CHECK (immediate IN (0, 1)),
  locked_at TEXT,
  lease_until INTEGER
);

INSERT OR IGNORE INTO summary_recompute_lock (id) VALUES (1);

CREATE TABLE IF NOT EXISTS summary_recompute_pending (
  course_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  immediate INTEGER NOT NULL DEFAULT 0 CHECK (immediate IN (0, 1)),
  enqueued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (course_id, teacher_id)
);
