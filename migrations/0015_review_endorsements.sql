-- Endorsement relation and write idempotency (issue #79 / ADR-0016).
-- users.id is the stable ordinary-user identity; #138 owns the full account
-- model and may extend this table. Endorsements reference the identifier
-- only — they do not create a foreign key onto the evolving account schema.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','banned','pending_deletion','deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE review_endorsements (
  user_id TEXT NOT NULL,
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, review_id)
);
CREATE INDEX idx_review_endorsements_review ON review_endorsements(review_id);

CREATE TABLE IF NOT EXISTS write_idempotency (
  user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, operation, idempotency_key)
);
