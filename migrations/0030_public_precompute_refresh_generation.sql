-- Version source writes so an older rebuild cannot publish stale projections.

ALTER TABLE public_precompute_state
ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public_precompute_state
ADD COLUMN refresh_token TEXT;

ALTER TABLE public_precompute_state
ADD COLUMN refresh_lease_until INTEGER;

DROP TRIGGER IF EXISTS public_precompute_dirty_courses_insert;
CREATE TRIGGER public_precompute_dirty_courses_insert
AFTER INSERT ON courses
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_courses_update;
CREATE TRIGGER public_precompute_dirty_courses_update
AFTER UPDATE ON courses
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_courses_delete;
CREATE TRIGGER public_precompute_dirty_courses_delete
AFTER DELETE ON courses
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_course_name_variants_insert;
CREATE TRIGGER public_precompute_dirty_course_name_variants_insert
AFTER INSERT ON course_name_variants
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_course_name_variants_update;
CREATE TRIGGER public_precompute_dirty_course_name_variants_update
AFTER UPDATE ON course_name_variants
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_course_name_variants_delete;
CREATE TRIGGER public_precompute_dirty_course_name_variants_delete
AFTER DELETE ON course_name_variants
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_teachers_insert;
CREATE TRIGGER public_precompute_dirty_teachers_insert
AFTER INSERT ON teachers
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_teachers_update;
CREATE TRIGGER public_precompute_dirty_teachers_update
AFTER UPDATE ON teachers
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_teachers_delete;
CREATE TRIGGER public_precompute_dirty_teachers_delete
AFTER DELETE ON teachers
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_course_teachers_insert;
CREATE TRIGGER public_precompute_dirty_course_teachers_insert
AFTER INSERT ON course_teachers
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_course_teachers_update;
CREATE TRIGGER public_precompute_dirty_course_teachers_update
AFTER UPDATE ON course_teachers
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_course_teachers_delete;
CREATE TRIGGER public_precompute_dirty_course_teachers_delete
AFTER DELETE ON course_teachers
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_reviews_insert;
CREATE TRIGGER public_precompute_dirty_reviews_insert
AFTER INSERT ON reviews
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_reviews_update;
CREATE TRIGGER public_precompute_dirty_reviews_update
AFTER UPDATE ON reviews
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_reviews_delete;
CREATE TRIGGER public_precompute_dirty_reviews_delete
AFTER DELETE ON reviews
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_legacy_reviews_insert;
CREATE TRIGGER public_precompute_dirty_legacy_reviews_insert
AFTER INSERT ON legacy_reviews
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_legacy_reviews_update;
CREATE TRIGGER public_precompute_dirty_legacy_reviews_update
AFTER UPDATE ON legacy_reviews
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_legacy_reviews_delete;
CREATE TRIGGER public_precompute_dirty_legacy_reviews_delete
AFTER DELETE ON legacy_reviews
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_public_historical_reviews_insert;
CREATE TRIGGER public_precompute_dirty_public_historical_reviews_insert
AFTER INSERT ON public_historical_reviews
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_public_historical_reviews_update;
CREATE TRIGGER public_precompute_dirty_public_historical_reviews_update
AFTER UPDATE ON public_historical_reviews
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_public_historical_reviews_delete;
CREATE TRIGGER public_precompute_dirty_public_historical_reviews_delete
AFTER DELETE ON public_historical_reviews
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_offerings_insert;
CREATE TRIGGER public_precompute_dirty_offerings_insert
AFTER INSERT ON offerings
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_offerings_update;
CREATE TRIGGER public_precompute_dirty_offerings_update
AFTER UPDATE ON offerings
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_offerings_delete;
CREATE TRIGGER public_precompute_dirty_offerings_delete
AFTER DELETE ON offerings
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_offering_teachers_insert;
CREATE TRIGGER public_precompute_dirty_offering_teachers_insert
AFTER INSERT ON offering_teachers
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_offering_teachers_update;
CREATE TRIGGER public_precompute_dirty_offering_teachers_update
AFTER UPDATE ON offering_teachers
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
DROP TRIGGER IF EXISTS public_precompute_dirty_offering_teachers_delete;
CREATE TRIGGER public_precompute_dirty_offering_teachers_delete
AFTER DELETE ON offering_teachers
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,
      generation=generation+1,
      refresh_token=NULL,
      refresh_lease_until=NULL
  WHERE id=1;
END;
