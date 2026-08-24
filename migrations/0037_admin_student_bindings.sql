-- Administrator student-ID bindings (#480).
-- Only the CAS identity subject hash is stored; plaintext student IDs never
-- enter D1. The hash matches auth_identities.subject for provider=cas.
CREATE TABLE admin_student_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
