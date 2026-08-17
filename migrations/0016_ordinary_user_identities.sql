-- Ordinary-user auth identities for campus AuthBridge JWT (#138).
-- users.id stays the only business identity. AuthBridge `sub` is not a
-- stable student id when `enc` is set; we store a hashed subject only.
CREATE TABLE auth_identities (
  provider TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, issuer, subject)
);
CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);
