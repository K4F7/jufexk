ALTER TABLE reviews ADD COLUMN grading_score INTEGER CHECK(grading_score BETWEEN 1 AND 5);
CREATE INDEX IF NOT EXISTS idx_reviews_teacher_status ON reviews(teacher_id,status);
CREATE TABLE admin_sessions(token_hash TEXT PRIMARY KEY,csrf_token TEXT NOT NULL,ip_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_at TEXT NOT NULL,revoked_at TEXT);
CREATE INDEX idx_admin_sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE admin_login_attempts(id INTEGER PRIMARY KEY AUTOINCREMENT,ip_hash TEXT NOT NULL,success INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_admin_login_attempts_ip_time ON admin_login_attempts(ip_hash,created_at DESC);
CREATE TABLE review_moderation_events(id INTEGER PRIMARY KEY AUTOINCREMENT,review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,action TEXT NOT NULL CHECK(action IN('approved','rejected','edited')),note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_moderation_review_time ON review_moderation_events(review_id,created_at DESC);
