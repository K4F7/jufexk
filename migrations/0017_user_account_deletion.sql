-- Ordinary-user account deletion recovery window (issue #139 / ADR-0016).
-- deletion_requested_at marks the start of the 30-day recovery period for
-- users in pending_deletion; auth identities are kept so a re-login inside
-- the window can still resolve the same users.id.
ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
