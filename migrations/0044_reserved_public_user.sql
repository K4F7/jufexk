-- #612: seed a non-login users row for 学长学姐 #000000 so follow /
-- counts share the numbered-user path. public_code stays NULL because
-- the existing CHECK still forbids 0; lookup uses the stable reserved id.
-- Unattributed reviews are still not backfilled onto this row.

INSERT OR IGNORE INTO users(id,status,public_code,avatar_key)
VALUES('00000000000000000000000000000000','active',NULL,0);
