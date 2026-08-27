-- Historical / approved-legacy text reviews: endorse, comment, and
-- admin block / soft-delete (issue #677). Current reviews keep
-- review_endorsements. Comments gain a public_id so one table covers
-- review: / historical: / legacy: targets.

ALTER TABLE public_historical_reviews ADD COLUMN blocked_at TEXT;
ALTER TABLE public_historical_reviews ADD COLUMN deleted_at TEXT;

ALTER TABLE legacy_reviews ADD COLUMN blocked_at TEXT;
ALTER TABLE legacy_reviews ADD COLUMN deleted_at TEXT;

CREATE TABLE historical_review_endorsements (
  user_id TEXT NOT NULL,
  historical_review_id TEXT NOT NULL
    REFERENCES public_historical_reviews(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, historical_review_id)
);
CREATE INDEX idx_historical_review_endorsements_review
  ON historical_review_endorsements(historical_review_id);

CREATE TABLE legacy_review_endorsements (
  user_id TEXT NOT NULL,
  legacy_review_id INTEGER NOT NULL
    REFERENCES legacy_reviews(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, legacy_review_id)
);
CREATE INDEX idx_legacy_review_endorsements_review
  ON legacy_review_endorsements(legacy_review_id);

CREATE TABLE historical_review_visibility_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  historical_review_id TEXT NOT NULL
    REFERENCES public_historical_reviews(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('blocked','unblocked','deleted')),
  actor_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_historical_review_visibility_events_review
  ON historical_review_visibility_events(
    historical_review_id, created_at DESC, id DESC
  );

CREATE TABLE legacy_review_visibility_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_review_id INTEGER NOT NULL
    REFERENCES legacy_reviews(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('blocked','unblocked','deleted')),
  actor_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_legacy_review_visibility_events_review
  ON legacy_review_visibility_events(
    legacy_review_id, created_at DESC, id DESC
  );

PRAGMA foreign_keys=OFF;

CREATE TABLE review_comments_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL,
  review_id INTEGER REFERENCES reviews(id) ON DELETE CASCADE,
  parent_comment_id INTEGER REFERENCES review_comments_next(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(trim(body)) > 0 AND length(body) <= 500),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  CHECK (
    (public_id LIKE 'review:%' AND review_id IS NOT NULL)
    OR (
      (public_id LIKE 'historical:%' OR public_id LIKE 'legacy:%')
      AND review_id IS NULL
    )
  )
);

INSERT INTO review_comments_next(
  id, public_id, review_id, parent_comment_id, author_user_id, body,
  created_at, deleted_at
)
SELECT
  id, 'review:' || review_id, review_id, parent_comment_id, author_user_id, body,
  created_at, deleted_at
FROM review_comments;

DROP TABLE review_comments;
ALTER TABLE review_comments_next RENAME TO review_comments;

CREATE INDEX idx_review_comments_review
  ON review_comments(review_id, created_at, id)
  WHERE deleted_at IS NULL AND review_id IS NOT NULL;
CREATE INDEX idx_review_comments_public
  ON review_comments(public_id, created_at, id)
  WHERE deleted_at IS NULL;

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

  INSERT OR IGNORE INTO user_notifications(
    user_id, type, message, link, event_key, source_review_id
  )
  SELECT
    parent.author_user_id,
    'review_comment_replied',
    '你的回复有了新回复',
    '/courses/' || lr.course_id || '?teacher=' || lr.teacher_id || '#legacy-' || lr.id,
    'review-comment-replied:' || NEW.id || ':parent-author',
    NULL
  FROM review_comments parent
  JOIN legacy_reviews lr
    ON parent.public_id = 'legacy:' || lr.id
  WHERE parent.id = NEW.parent_comment_id
    AND parent.deleted_at IS NULL
    AND NEW.public_id LIKE 'legacy:%'
    AND parent.author_user_id <> NEW.author_user_id;
END;

PRAGMA foreign_keys=ON;
