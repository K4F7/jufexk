-- Scope public projection invalidation to columns that can change its output.
-- A dirty epoch advances generation once. The first write while a refresh lease
-- is held also cancels that lease; later writes in the same epoch are no-ops.

DROP TRIGGER IF EXISTS public_precompute_dirty_courses_insert;
DROP TRIGGER IF EXISTS public_precompute_dirty_courses_update;
DROP TRIGGER IF EXISTS public_precompute_dirty_courses_delete;
CREATE TRIGGER public_precompute_dirty_courses_insert AFTER INSERT ON courses BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_courses_update AFTER UPDATE OF name,code,category,scheme_key,department ON courses BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_courses_delete AFTER DELETE ON courses BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_course_name_variants_insert;
DROP TRIGGER IF EXISTS public_precompute_dirty_course_name_variants_update;
DROP TRIGGER IF EXISTS public_precompute_dirty_course_name_variants_delete;
CREATE TRIGGER public_precompute_dirty_course_name_variants_insert AFTER INSERT ON course_name_variants BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_course_name_variants_update AFTER UPDATE OF course_id,name ON course_name_variants BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_course_name_variants_delete AFTER DELETE ON course_name_variants BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_teachers_insert;
DROP TRIGGER IF EXISTS public_precompute_dirty_teachers_update;
DROP TRIGGER IF EXISTS public_precompute_dirty_teachers_delete;
CREATE TRIGGER public_precompute_dirty_teachers_insert AFTER INSERT ON teachers BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_teachers_update AFTER UPDATE OF name,department ON teachers BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_teachers_delete AFTER DELETE ON teachers BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_course_teachers_insert;
DROP TRIGGER IF EXISTS public_precompute_dirty_course_teachers_update;
DROP TRIGGER IF EXISTS public_precompute_dirty_course_teachers_delete;
CREATE TRIGGER public_precompute_dirty_course_teachers_insert AFTER INSERT ON course_teachers BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_course_teachers_update AFTER UPDATE OF course_id,teacher_id ON course_teachers BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_course_teachers_delete AFTER DELETE ON course_teachers BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_reviews_insert;
DROP TRIGGER IF EXISTS public_precompute_dirty_reviews_update;
DROP TRIGGER IF EXISTS public_precompute_dirty_reviews_delete;
CREATE TRIGGER public_precompute_dirty_reviews_insert AFTER INSERT ON reviews BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_reviews_update AFTER UPDATE OF course_id,teacher_id,status,comment,overall,blocked_at,deleted_at,login_only,offering_id ON reviews BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_reviews_delete AFTER DELETE ON reviews BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_legacy_reviews_insert;
DROP TRIGGER IF EXISTS public_precompute_dirty_legacy_reviews_update;
DROP TRIGGER IF EXISTS public_precompute_dirty_legacy_reviews_delete;

DROP TRIGGER IF EXISTS public_precompute_dirty_public_historical_reviews_insert;
DROP TRIGGER IF EXISTS public_precompute_dirty_public_historical_reviews_update;
DROP TRIGGER IF EXISTS public_precompute_dirty_public_historical_reviews_delete;
CREATE TRIGGER public_precompute_dirty_public_historical_reviews_insert AFTER INSERT ON public_historical_reviews BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_public_historical_reviews_update AFTER UPDATE OF course_id,teacher_id,comment,blocked_at,deleted_at ON public_historical_reviews BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_public_historical_reviews_delete AFTER DELETE ON public_historical_reviews BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_offerings_insert;
DROP TRIGGER IF EXISTS public_precompute_dirty_offerings_update;
DROP TRIGGER IF EXISTS public_precompute_dirty_offerings_delete;
CREATE TRIGGER public_precompute_dirty_offerings_insert AFTER INSERT ON offerings BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_offerings_update AFTER UPDATE OF id,course_id ON offerings BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_offerings_delete AFTER DELETE ON offerings BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_offering_teachers_insert;
DROP TRIGGER IF EXISTS public_precompute_dirty_offering_teachers_update;
DROP TRIGGER IF EXISTS public_precompute_dirty_offering_teachers_delete;
CREATE TRIGGER public_precompute_dirty_offering_teachers_insert AFTER INSERT ON offering_teachers BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_offering_teachers_update AFTER UPDATE OF offering_id,teacher_id ON offering_teachers BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_offering_teachers_delete AFTER DELETE ON offering_teachers BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;

DROP TRIGGER IF EXISTS public_precompute_dirty_course_tags_insert;
DROP TRIGGER IF EXISTS public_precompute_dirty_course_tags_update;
DROP TRIGGER IF EXISTS public_precompute_dirty_course_tags_delete;
CREATE TRIGGER public_precompute_dirty_course_tags_insert AFTER INSERT ON course_tags BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_course_tags_update AFTER UPDATE OF course_id,tag ON course_tags BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
CREATE TRIGGER public_precompute_dirty_course_tags_delete AFTER DELETE ON course_tags BEGIN
  UPDATE public_precompute_state SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
