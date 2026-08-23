-- Temporary ordinary-user write blocking (issue #464).
-- Keep this separate from users.status: a muted user may still authenticate and read.
ALTER TABLE users ADD COLUMN muted_until INTEGER;
