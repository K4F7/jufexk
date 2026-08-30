-- Materialize public endorsement/challenge counts so review ordering does not
-- execute one correlated COUNT per row across three review sources.
CREATE TABLE public_review_signal_counts (
  source_kind TEXT NOT NULL CHECK(source_kind IN ('review','historical','legacy')),
  source_id TEXT NOT NULL,
  endorsement_count INTEGER NOT NULL DEFAULT 0 CHECK(endorsement_count >= 0),
  challenge_count INTEGER NOT NULL DEFAULT 0 CHECK(challenge_count >= 0),
  PRIMARY KEY(source_kind, source_id)
);

INSERT INTO public_review_signal_counts(source_kind,source_id,endorsement_count,challenge_count)
SELECT 'review',CAST(r.id AS TEXT),
  COALESCE(e.endorsement_count,0),COALESCE(ch.challenge_count,0)
FROM reviews r
LEFT JOIN (
  SELECT review_id,COUNT(*) endorsement_count
  FROM review_endorsements GROUP BY review_id
) e ON e.review_id=r.id
LEFT JOIN (
  SELECT review_id,COUNT(*) challenge_count
  FROM review_challenges GROUP BY review_id
) ch ON ch.review_id=r.id
WHERE COALESCE(e.endorsement_count,0)>0 OR COALESCE(ch.challenge_count,0)>0;

INSERT INTO public_review_signal_counts(source_kind,source_id,endorsement_count,challenge_count)
SELECT 'historical',CAST(r.id AS TEXT),
  COALESCE(e.endorsement_count,0),COALESCE(ch.challenge_count,0)
FROM public_historical_reviews r
LEFT JOIN (
  SELECT historical_review_id,COUNT(*) endorsement_count
  FROM historical_review_endorsements GROUP BY historical_review_id
) e ON e.historical_review_id=r.id
LEFT JOIN (
  SELECT historical_review_id,COUNT(*) challenge_count
  FROM historical_review_challenges GROUP BY historical_review_id
) ch ON ch.historical_review_id=r.id
WHERE COALESCE(e.endorsement_count,0)>0 OR COALESCE(ch.challenge_count,0)>0;

INSERT INTO public_review_signal_counts(source_kind,source_id,endorsement_count,challenge_count)
SELECT 'legacy',CAST(r.id AS TEXT),
  COALESCE(e.endorsement_count,0),COALESCE(ch.challenge_count,0)
FROM legacy_reviews r
LEFT JOIN (
  SELECT legacy_review_id,COUNT(*) endorsement_count
  FROM legacy_review_endorsements GROUP BY legacy_review_id
) e ON e.legacy_review_id=r.id
LEFT JOIN (
  SELECT legacy_review_id,COUNT(*) challenge_count
  FROM legacy_review_challenges GROUP BY legacy_review_id
) ch ON ch.legacy_review_id=r.id
WHERE COALESCE(e.endorsement_count,0)>0 OR COALESCE(ch.challenge_count,0)>0;

-- Keep projected counts exact and never allow a delete to underflow them. The
-- existing 0049 mutual-exclusion triggers intentionally cause the opposite
-- action's DELETE trigger to run as well.
CREATE TRIGGER public_review_signal_review_endorsement_insert
AFTER INSERT ON review_endorsements BEGIN
  INSERT INTO public_review_signal_counts(source_kind,source_id,endorsement_count,challenge_count)
  VALUES('review',CAST(NEW.review_id AS TEXT),1,0)
  ON CONFLICT(source_kind,source_id) DO UPDATE SET endorsement_count=endorsement_count+1;
END;
CREATE TRIGGER public_review_signal_review_endorsement_delete
AFTER DELETE ON review_endorsements BEGIN
  UPDATE public_review_signal_counts
  SET endorsement_count=MAX(0,endorsement_count-1)
  WHERE source_kind='review' AND source_id=CAST(OLD.review_id AS TEXT);
END;
CREATE TRIGGER public_review_signal_review_challenge_insert
AFTER INSERT ON review_challenges BEGIN
  INSERT INTO public_review_signal_counts(source_kind,source_id,endorsement_count,challenge_count)
  VALUES('review',CAST(NEW.review_id AS TEXT),0,1)
  ON CONFLICT(source_kind,source_id) DO UPDATE SET challenge_count=challenge_count+1;
END;
CREATE TRIGGER public_review_signal_review_challenge_delete
AFTER DELETE ON review_challenges BEGIN
  UPDATE public_review_signal_counts
  SET challenge_count=MAX(0,challenge_count-1)
  WHERE source_kind='review' AND source_id=CAST(OLD.review_id AS TEXT);
END;

CREATE TRIGGER public_review_signal_historical_endorsement_insert
AFTER INSERT ON historical_review_endorsements BEGIN
  INSERT INTO public_review_signal_counts(source_kind,source_id,endorsement_count,challenge_count)
  VALUES('historical',CAST(NEW.historical_review_id AS TEXT),1,0)
  ON CONFLICT(source_kind,source_id) DO UPDATE SET endorsement_count=endorsement_count+1;
END;
CREATE TRIGGER public_review_signal_historical_endorsement_delete
AFTER DELETE ON historical_review_endorsements BEGIN
  UPDATE public_review_signal_counts
  SET endorsement_count=MAX(0,endorsement_count-1)
  WHERE source_kind='historical' AND source_id=CAST(OLD.historical_review_id AS TEXT);
END;
CREATE TRIGGER public_review_signal_historical_challenge_insert
AFTER INSERT ON historical_review_challenges BEGIN
  INSERT INTO public_review_signal_counts(source_kind,source_id,endorsement_count,challenge_count)
  VALUES('historical',CAST(NEW.historical_review_id AS TEXT),0,1)
  ON CONFLICT(source_kind,source_id) DO UPDATE SET challenge_count=challenge_count+1;
END;
CREATE TRIGGER public_review_signal_historical_challenge_delete
AFTER DELETE ON historical_review_challenges BEGIN
  UPDATE public_review_signal_counts
  SET challenge_count=MAX(0,challenge_count-1)
  WHERE source_kind='historical' AND source_id=CAST(OLD.historical_review_id AS TEXT);
END;

CREATE TRIGGER public_review_signal_legacy_endorsement_insert
AFTER INSERT ON legacy_review_endorsements BEGIN
  INSERT INTO public_review_signal_counts(source_kind,source_id,endorsement_count,challenge_count)
  VALUES('legacy',CAST(NEW.legacy_review_id AS TEXT),1,0)
  ON CONFLICT(source_kind,source_id) DO UPDATE SET endorsement_count=endorsement_count+1;
END;
CREATE TRIGGER public_review_signal_legacy_endorsement_delete
AFTER DELETE ON legacy_review_endorsements BEGIN
  UPDATE public_review_signal_counts
  SET endorsement_count=MAX(0,endorsement_count-1)
  WHERE source_kind='legacy' AND source_id=CAST(OLD.legacy_review_id AS TEXT);
END;
CREATE TRIGGER public_review_signal_legacy_challenge_insert
AFTER INSERT ON legacy_review_challenges BEGIN
  INSERT INTO public_review_signal_counts(source_kind,source_id,endorsement_count,challenge_count)
  VALUES('legacy',CAST(NEW.legacy_review_id AS TEXT),0,1)
  ON CONFLICT(source_kind,source_id) DO UPDATE SET challenge_count=challenge_count+1;
END;
CREATE TRIGGER public_review_signal_legacy_challenge_delete
AFTER DELETE ON legacy_review_challenges BEGIN
  UPDATE public_review_signal_counts
  SET challenge_count=MAX(0,challenge_count-1)
  WHERE source_kind='legacy' AND source_id=CAST(OLD.legacy_review_id AS TEXT);
END;

-- Catalog and review read paths use these leading predicates for category and
-- subject/sort filtering. Existing indexes remain untouched.
CREATE INDEX idx_courses_scheme_key_id ON courses(scheme_key,id);
CREATE INDEX idx_public_course_canonicals_sports
  ON public_course_canonicals(is_public_sports,canonical_course_id,course_id);
CREATE INDEX idx_reviews_public_subject_created
  ON reviews(course_id,teacher_id,status,created_at,id);
CREATE INDEX idx_reviews_public_subject_rating
  ON reviews(course_id,teacher_id,status,overall,id);
CREATE INDEX idx_legacy_reviews_public_subject_created
  ON legacy_reviews(course_id,teacher_id,status,created_at,id);
CREATE INDEX idx_historical_reviews_public_subject_created
  ON public_historical_reviews(course_id,teacher_id,imported_at,id);