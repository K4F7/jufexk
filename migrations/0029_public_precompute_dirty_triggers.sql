-- Keep public catalogue projections lazy and correct for every source-table write.
-- Each trigger only flips the singleton dirty bit; the next public read rebuilds
-- the projections once, regardless of how many rows a write batch changes.

CREATE TRIGGER public_precompute_dirty_courses_insert
AFTER INSERT ON courses
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_courses_update
AFTER UPDATE ON courses
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_courses_delete
AFTER DELETE ON courses
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;

CREATE TRIGGER public_precompute_dirty_course_name_variants_insert
AFTER INSERT ON course_name_variants
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_course_name_variants_update
AFTER UPDATE ON course_name_variants
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_course_name_variants_delete
AFTER DELETE ON course_name_variants
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;

CREATE TRIGGER public_precompute_dirty_teachers_insert
AFTER INSERT ON teachers
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_teachers_update
AFTER UPDATE ON teachers
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_teachers_delete
AFTER DELETE ON teachers
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;

CREATE TRIGGER public_precompute_dirty_course_teachers_insert
AFTER INSERT ON course_teachers
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_course_teachers_update
AFTER UPDATE ON course_teachers
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_course_teachers_delete
AFTER DELETE ON course_teachers
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;

CREATE TRIGGER public_precompute_dirty_reviews_insert
AFTER INSERT ON reviews
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_reviews_update
AFTER UPDATE ON reviews
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_reviews_delete
AFTER DELETE ON reviews
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;

CREATE TRIGGER public_precompute_dirty_legacy_reviews_insert
AFTER INSERT ON legacy_reviews
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_legacy_reviews_update
AFTER UPDATE ON legacy_reviews
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_legacy_reviews_delete
AFTER DELETE ON legacy_reviews
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;

CREATE TRIGGER public_precompute_dirty_public_historical_reviews_insert
AFTER INSERT ON public_historical_reviews
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_public_historical_reviews_update
AFTER UPDATE ON public_historical_reviews
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_public_historical_reviews_delete
AFTER DELETE ON public_historical_reviews
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;

CREATE TRIGGER public_precompute_dirty_offerings_insert
AFTER INSERT ON offerings
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_offerings_update
AFTER UPDATE ON offerings
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_offerings_delete
AFTER DELETE ON offerings
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;

CREATE TRIGGER public_precompute_dirty_offering_teachers_insert
AFTER INSERT ON offering_teachers
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_offering_teachers_update
AFTER UPDATE ON offering_teachers
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
CREATE TRIGGER public_precompute_dirty_offering_teachers_delete
AFTER DELETE ON offering_teachers
BEGIN
  UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
END;
