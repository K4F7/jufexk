-- CTA 教师官方主页与公开头像（#664）。
-- 只存已绑定详情页上的真人照片；默认占位图 defaulticon.png 不入库。
ALTER TABLE teachers ADD COLUMN cta_fid INTEGER;
ALTER TABLE teachers ADD COLUMN cta_uid INTEGER;
ALTER TABLE teachers ADD COLUMN homepage_url TEXT;
ALTER TABLE teachers ADD COLUMN homepage_locked INTEGER NOT NULL DEFAULT 0 CHECK (homepage_locked IN (0, 1));
ALTER TABLE teachers ADD COLUMN homepage_match TEXT NOT NULL DEFAULT 'none' CHECK (homepage_match IN ('none', 'unique', 'ambiguous', 'manual'));
ALTER TABLE teachers ADD COLUMN image_locked INTEGER NOT NULL DEFAULT 0 CHECK (image_locked IN (0, 1));
ALTER TABLE teachers ADD COLUMN avatar_sha256 TEXT;
ALTER TABLE teachers ADD COLUMN cta_synced_at TEXT;

CREATE TABLE teacher_avatars (
  teacher_id INTEGER PRIMARY KEY REFERENCES teachers (id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes BLOB NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_teachers_cta_uid ON teachers (cta_uid);
