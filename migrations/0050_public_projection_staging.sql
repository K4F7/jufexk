-- Build public projections off to the side, then publish one complete generation.
-- This lets public reads continue using the previous complete generation while a
-- dirty refresh is running.
ALTER TABLE public_precompute_state
ADD COLUMN published_generation INTEGER NOT NULL DEFAULT -1;

ALTER TABLE public_precompute_state
ADD COLUMN published_at INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public_course_canonicals
ADD COLUMN is_public_sports INTEGER NOT NULL DEFAULT 0 CHECK(is_public_sports IN (0,1));

UPDATE public_precompute_state
SET published_generation = CASE
      WHEN EXISTS (SELECT 1 FROM public_course_canonicals) THEN generation
      ELSE -1
    END,
    published_at = CASE
      WHEN EXISTS (SELECT 1 FROM public_course_canonicals) THEN unixepoch()
      ELSE 0
    END
WHERE id=1;

CREATE TABLE public_course_canonicals_staging (
  course_id INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  canonical_course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  family_label TEXT,
  search_text TEXT NOT NULL DEFAULT '',
  match_text TEXT NOT NULL DEFAULT '',
  teacher_variant_text TEXT NOT NULL DEFAULT '',
  pinyin_text TEXT NOT NULL DEFAULT '',
  is_public_sports INTEGER NOT NULL DEFAULT 0 CHECK(is_public_sports IN (0,1))
);

CREATE TABLE public_review_counts_staging (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  review_count INTEGER NOT NULL CHECK(review_count >= 0),
  PRIMARY KEY(course_id,teacher_id)
);

CREATE TABLE public_teacher_course_counts_staging (
  teacher_id INTEGER PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
  course_count INTEGER NOT NULL CHECK(course_count >= 0)
);

CREATE TABLE public_teacher_search_staging (
  teacher_id INTEGER PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
  match_text TEXT NOT NULL DEFAULT '',
  pinyin_text TEXT NOT NULL DEFAULT ''
);

CREATE TABLE public_relation_ratings (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  rating REAL NOT NULL,
  PRIMARY KEY(course_id,teacher_id)
);

CREATE TABLE public_relation_ratings_staging (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  rating REAL NOT NULL,
  PRIMARY KEY(course_id,teacher_id)
);

CREATE INDEX idx_course_teachers_course_teacher
  ON course_teachers(course_id,teacher_id);
CREATE INDEX idx_course_tags_course_tag
  ON course_tags(course_id,tag);

DROP TRIGGER IF EXISTS public_precompute_dirty_course_tags_insert;
CREATE TRIGGER public_precompute_dirty_course_tags_insert
AFTER INSERT ON course_tags BEGIN
  UPDATE public_precompute_state
  SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_course_tags_update;
CREATE TRIGGER public_precompute_dirty_course_tags_update
AFTER UPDATE ON course_tags BEGIN
  UPDATE public_precompute_state
  SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_course_tags_delete;
CREATE TRIGGER public_precompute_dirty_course_tags_delete
AFTER DELETE ON course_tags BEGIN
  UPDATE public_precompute_state
  SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1;
END;
