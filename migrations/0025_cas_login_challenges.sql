-- Short-lived CAS MFA holds (#389). The blob is AES-GCM ciphertext only:
-- no plaintext password, CASTGC or student number columns.
CREATE TABLE cas_login_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  blob TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX idx_cas_login_challenges_expires ON cas_login_challenges(expires_at);
