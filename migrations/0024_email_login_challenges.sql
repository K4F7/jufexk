-- Email login challenges (#325). D1 stores hashes only: no plaintext
-- mailbox, OTP or magic token. One unconsumed challenge per subject.
CREATE TABLE email_login_challenges (
  subject TEXT PRIMARY KEY NOT NULL,
  code_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX idx_email_login_token ON email_login_challenges(token_hash);
