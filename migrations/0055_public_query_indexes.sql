-- Query support for public catalog name-variant predicates and latest reviews.
-- Keep the course id first so correlated EXISTS predicates can use a covering lookup.
CREATE INDEX IF NOT EXISTS idx_course_name_variants_course_lower_name
  ON course_name_variants(course_id, lower(name));

-- The latest public feed orders the historical branch by imported_at and id
-- before UNION sorting and cursor filtering.
CREATE INDEX IF NOT EXISTS idx_public_historical_reviews_latest
  ON public_historical_reviews(imported_at DESC, id DESC);
