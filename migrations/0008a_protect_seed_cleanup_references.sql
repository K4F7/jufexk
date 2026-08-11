-- This migration intentionally sorts between 0008 and 0009. Production may
-- already have applied 0009; in that case these guards are harmless and 0010
-- removes them immediately. Databases upgrading from 0008 receive the guards
-- before the seed cleanup runs.
CREATE TRIGGER protect_seed_relation_references
BEFORE DELETE ON course_teachers
WHEN EXISTS(
  SELECT 1 FROM legacy_reviews
  WHERE course_id=OLD.course_id AND teacher_id=OLD.teacher_id
    AND status IN('pending','approved')
) OR EXISTS(
  SELECT 1 FROM catalog_requests
  WHERE created_course_id=OLD.course_id OR created_teacher_id=OLD.teacher_id
)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER protect_seed_course_references
BEFORE DELETE ON courses
WHEN EXISTS(
  SELECT 1 FROM legacy_reviews
  WHERE course_id=OLD.id AND status IN('pending','approved')
) OR EXISTS(
  SELECT 1 FROM catalog_requests WHERE created_course_id=OLD.id
)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER protect_seed_teacher_references
BEFORE DELETE ON teachers
WHEN EXISTS(
  SELECT 1 FROM legacy_reviews
  WHERE teacher_id=OLD.id AND status IN('pending','approved')
) OR EXISTS(
  SELECT 1 FROM catalog_requests WHERE created_teacher_id=OLD.id
)
BEGIN
  SELECT RAISE(IGNORE);
END;
