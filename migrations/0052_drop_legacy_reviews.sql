-- Drop the empty leftover OCR scaffold (issue #724 step 2).
-- Production inventory on 2026-08-30: legacy_reviews, leftover batches,
-- and leftover endorsements were all 0 rows. Historical counterparts stay.
-- Do not rewrite already-applied 0006 / 0029 / 0030 / 0048 / 0049.

DROP TRIGGER IF EXISTS public_precompute_dirty_legacy_reviews_insert;
DROP TRIGGER IF EXISTS public_precompute_dirty_legacy_reviews_update;
DROP TRIGGER IF EXISTS public_precompute_dirty_legacy_reviews_delete;
DROP TRIGGER IF EXISTS legacy_review_challenge_clears_endorsement;
DROP TRIGGER IF EXISTS legacy_review_endorsement_clears_challenge;

-- The previous notify_review_comment_reply body JOINed legacy_reviews.
-- Recreate it without that branch before the table goes away.
DROP TRIGGER IF EXISTS notify_review_comment_reply;
CREATE TRIGGER notify_review_comment_reply
AFTER INSERT ON review_comments
BEGIN
  INSERT OR IGNORE INTO user_notifications(
    user_id, type, message, link, event_key, source_review_id
  )
  SELECT
    review.author_user_id,
    'review_comment_replied',
    '你对' || COALESCE(virtual.label, course.name) || ' · ' || teacher.name || '的任课评价有了新回复',
    '/courses/' || COALESCE(virtual.virtual_course_id, review.course_id) || '?teacher=' || review.teacher_id || '#review-' || review.id,
    'review-comment-replied:' || NEW.id || ':review-author',
    review.id
  FROM reviews review
  JOIN courses course ON course.id = review.course_id
  JOIN teachers teacher ON teacher.id = review.teacher_id
  LEFT JOIN virtual_pe_notification_courses virtual
    ON virtual.teacher_name = teacher.name
  WHERE review.id = NEW.review_id
    AND NEW.parent_comment_id IS NULL
    AND review.status = 'approved'
    AND review.author_user_id IS NOT NULL
    AND review.author_user_id <> NEW.author_user_id;

  INSERT OR IGNORE INTO user_notifications(
    user_id, type, message, link, event_key, source_review_id
  )
  SELECT
    parent.author_user_id,
    'review_comment_replied',
    '你在' || COALESCE(virtual.label, course.name) || ' · ' || teacher.name || '评价下的回复有了新回复',
    '/courses/' || COALESCE(virtual.virtual_course_id, review.course_id) || '?teacher=' || review.teacher_id || '#review-' || review.id,
    'review-comment-replied:' || NEW.id || ':parent-author',
    review.id
  FROM review_comments parent
  JOIN reviews review ON review.id = parent.review_id
  JOIN courses course ON course.id = review.course_id
  JOIN teachers teacher ON teacher.id = review.teacher_id
  LEFT JOIN virtual_pe_notification_courses virtual
    ON virtual.teacher_name = teacher.name
  WHERE parent.id = NEW.parent_comment_id
    AND parent.deleted_at IS NULL
    AND parent.review_id IS NOT NULL
    AND review.status = 'approved'
    AND parent.author_user_id <> NEW.author_user_id;

  INSERT OR IGNORE INTO user_notifications(
    user_id, type, message, link, event_key, source_review_id
  )
  SELECT
    parent.author_user_id,
    'review_comment_replied',
    '你的回复有了新回复',
    '/courses/' || phr.course_id || '?teacher=' || phr.teacher_id || '#historical-' || phr.id,
    'review-comment-replied:' || NEW.id || ':parent-author',
    NULL
  FROM review_comments parent
  JOIN public_historical_reviews phr
    ON parent.public_id = 'historical:' || phr.id
  WHERE parent.id = NEW.parent_comment_id
    AND parent.deleted_at IS NULL
    AND NEW.public_id LIKE 'historical:%'
    AND parent.author_user_id <> NEW.author_user_id;
END;

DROP TABLE IF EXISTS legacy_review_challenges;
DROP TABLE IF EXISTS legacy_review_endorsements;
DROP TABLE IF EXISTS legacy_review_visibility_events;
DROP TABLE IF EXISTS legacy_review_moderation_events;
DROP TABLE IF EXISTS legacy_reviews;
DROP TABLE IF EXISTS legacy_import_batches;
