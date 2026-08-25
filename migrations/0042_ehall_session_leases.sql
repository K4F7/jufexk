-- Anonymous short lease only; upstream cookies remain in the browser-held sealed cookie.
CREATE TABLE IF NOT EXISTS ehall_session_leases (
  session_hash TEXT PRIMARY KEY,
  lease_until INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ehall_session_leases_expiry
  ON ehall_session_leases(lease_until);
