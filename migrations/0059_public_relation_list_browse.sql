-- Browse indexes so unfiltered relation lists can start from aggregate tables
-- instead of sorting every public course×teacher row. Totals avoid COUNT(*) on
-- the same join for category/sort switches.
CREATE TABLE public_relation_list_totals (
  category TEXT PRIMARY KEY,
  n INTEGER NOT NULL CHECK(n >= 0)
);
CREATE TABLE public_relation_list_totals_staging (
  category TEXT PRIMARY KEY,
  n INTEGER NOT NULL CHECK(n >= 0)
);

CREATE INDEX idx_public_review_counts_review_count
  ON public_review_counts(review_count DESC, course_id, teacher_id);
CREATE INDEX idx_public_relation_ratings_rating
  ON public_relation_ratings(rating DESC, course_id, teacher_id);

UPDATE public_precompute_state SET dirty=1 WHERE id=1 AND dirty=0;
