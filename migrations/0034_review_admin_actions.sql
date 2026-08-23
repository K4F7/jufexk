-- Review ownership, visibility controls, and audited admin actions (issue #463).
ALTER TABLE reviews ADD COLUMN author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD COLUMN blocked_at TEXT;
ALTER TABLE reviews ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_reviews_author_user ON reviews(author_user_id);

-- A catalog request can create its attached review later, so retain the same
-- ordinary-user ownership across the moderation boundary.
ALTER TABLE catalog_requests ADD COLUMN author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_catalog_requests_author_user ON catalog_requests(author_user_id);

-- Keep review-local history while adding the acting admin session and the new
-- visibility / author-lookup actions. Deleted reviews are soft-deleted, so the
-- review foreign key and its audit trail remain intact.
ALTER TABLE review_moderation_events RENAME TO review_moderation_events_legacy;
CREATE TABLE review_moderation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN (
    'approved','rejected','edited','blocked','unblocked','deleted','author_lookup'
  )),
  note TEXT NOT NULL DEFAULT '',
  actor_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO review_moderation_events(id,review_id,action,note,created_at)
SELECT id,review_id,action,note,created_at FROM review_moderation_events_legacy;
DROP TABLE review_moderation_events_legacy;
CREATE INDEX idx_review_moderation_events_review
  ON review_moderation_events(review_id,created_at DESC,id DESC);
