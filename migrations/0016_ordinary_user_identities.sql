-- Ordinary-user auth identities (#138).
-- users.id stays the only business identity; subjects are stored as hashes.
CREATE TABLE auth_identities (
  provider TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, issuer, subject)
);
CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);
