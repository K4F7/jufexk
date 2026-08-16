CREATE TABLE catalog_baseline_finalize_locks(
  batch_id TEXT PRIMARY KEY REFERENCES catalog_baseline_uploads(batch_id) ON DELETE CASCADE,
  locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
