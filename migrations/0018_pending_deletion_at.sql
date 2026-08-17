-- Recovery-window timestamp for ordinary-user account deletion (issue #172).
-- pending_deletion_at is the start of the 30-day copy window. This version
-- does not finalize the account or drop auth identities when it elapses.
-- Copy the previous deletion_requested_at so existing recovery rows keep
-- their original start time.
ALTER TABLE users ADD COLUMN pending_deletion_at TEXT;
UPDATE users
SET pending_deletion_at = deletion_requested_at
WHERE pending_deletion_at IS NULL AND deletion_requested_at IS NOT NULL;
