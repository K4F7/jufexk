-- Allow inbox rows that are not tied to a review, so "someone followed you"
-- can use the same user_notifications table as #460 / #493.

PRAGMA foreign_keys=OFF;

DROP TRIGGER IF EXISTS notify_followers_after_approved_review_insert;
DROP TRIGGER IF EXISTS notify_followers_after_review_approval;
DROP TRIGGER IF EXISTS notify_review_author_after_endorsement;
DROP TRIGGER IF EXISTS notify_user_followers_after_approved_review_insert;
DROP TRIGGER IF EXISTS notify_user_followers_after_review_approval;

CREATE TABLE user_notifications_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL
    CHECK(type IN (
      'followed_relation_review',
      'review_endorsed',
      'followed_user_review',
      'user_followed'
    )),
  message TEXT NOT NULL CHECK(length(trim(message)) > 0),
  link TEXT NOT NULL CHECK(substr(link, 1, 1) = '/'),
  event_key TEXT NOT NULL UNIQUE,
  source_review_id INTEGER REFERENCES reviews(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT
);

INSERT INTO user_notifications_next(
  id, user_id, type, message, link, event_key, source_review_id, created_at, read_at
)
SELECT
  id, user_id, type, message, link, event_key, source_review_id, created_at, read_at
FROM user_notifications;

DROP TABLE user_notifications;
ALTER TABLE user_notifications_next RENAME TO user_notifications;

CREATE INDEX idx_user_notifications_inbox
  ON user_notifications(user_id, created_at DESC, id DESC);
CREATE INDEX idx_user_notifications_unread
  ON user_notifications(user_id, read_at)
  WHERE read_at IS NULL;

CREATE TRIGGER notify_followers_after_approved_review_insert
AFTER INSERT ON reviews
WHEN NEW.status = 'approved' AND NEW.teacher_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO user_notifications(
    user_id, type, message, link, event_key, source_review_id
  )
  SELECT
    follow.user_id,
    'followed_relation_review',
    CASE
      WHEN follow.course_id = virtual.virtual_course_id THEN virtual.label
      ELSE course.name
    END || ' · ' || teacher.name || '有新任课评价',
    '/courses/' || follow.course_id || '?teacher=' || NEW.teacher_id || '#review-' || NEW.id,
    'followed-review:' || NEW.id || ':' || follow.user_id,
    NEW.id
  FROM relation_follows follow
  JOIN courses course ON course.id = NEW.course_id
  JOIN teachers teacher ON teacher.id = NEW.teacher_id
  LEFT JOIN virtual_pe_notification_courses virtual
    ON virtual.teacher_name = teacher.name
  WHERE follow.teacher_id = NEW.teacher_id
    AND follow.course_id IN (NEW.course_id, virtual.virtual_course_id)
    AND (NEW.author_user_id IS NULL OR follow.user_id <> NEW.author_user_id);
END;

CREATE TRIGGER notify_followers_after_review_approval
AFTER UPDATE OF status ON reviews
WHEN OLD.status <> 'approved'
  AND NEW.status = 'approved'
  AND NEW.teacher_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO user_notifications(
    user_id, type, message, link, event_key, source_review_id
  )
  SELECT
    follow.user_id,
    'followed_relation_review',
    CASE
      WHEN follow.course_id = virtual.virtual_course_id THEN virtual.label
      ELSE course.name
    END || ' · ' || teacher.name || '有新任课评价',
    '/courses/' || follow.course_id || '?teacher=' || NEW.teacher_id || '#review-' || NEW.id,
    'followed-review:' || NEW.id || ':' || follow.user_id,
    NEW.id
  FROM relation_follows follow
  JOIN courses course ON course.id = NEW.course_id
  JOIN teachers teacher ON teacher.id = NEW.teacher_id
  LEFT JOIN virtual_pe_notification_courses virtual
    ON virtual.teacher_name = teacher.name
  WHERE follow.teacher_id = NEW.teacher_id
    AND follow.course_id IN (NEW.course_id, virtual.virtual_course_id)
    AND (NEW.author_user_id IS NULL OR follow.user_id <> NEW.author_user_id);
END;

CREATE TRIGGER notify_review_author_after_endorsement
AFTER INSERT ON review_endorsements
BEGIN
  INSERT OR IGNORE INTO user_notifications(
    user_id, type, message, link, event_key, source_review_id
  )
  SELECT
    review.author_user_id,
    'review_endorsed',
    '你对' || COALESCE(virtual.label, course.name) || ' · ' || teacher.name || '的任课评价获得了认可',
    '/courses/' || COALESCE(virtual.virtual_course_id, review.course_id) || '?teacher=' || review.teacher_id || '#review-' || review.id,
    'review-endorsed:' || review.id || ':' || NEW.user_id,
    review.id
  FROM reviews review
  JOIN courses course ON course.id = review.course_id
  JOIN teachers teacher ON teacher.id = review.teacher_id
  LEFT JOIN virtual_pe_notification_courses virtual
    ON virtual.teacher_name = teacher.name
  WHERE review.id = NEW.review_id
    AND review.status = 'approved'
    AND review.author_user_id IS NOT NULL
    AND review.author_user_id <> NEW.user_id;
END;

CREATE TRIGGER notify_user_followers_after_approved_review_insert
AFTER INSERT ON reviews
WHEN NEW.status = 'approved'
  AND NEW.author_user_id IS NOT NULL
  AND NEW.teacher_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO user_notifications(
    user_id, type, message, link, event_key, source_review_id
  )
  SELECT
    follow.follower_user_id,
    'followed_user_review',
    '匿名用户#' || printf('%06d', author.public_code) || ' 发布了新任课评价',
    '/courses/' || COALESCE(virtual.virtual_course_id, NEW.course_id) || '?teacher=' || NEW.teacher_id || '#review-' || NEW.id,
    'followed-user-review:' || NEW.id || ':' || follow.follower_user_id,
    NEW.id
  FROM user_follows follow
  JOIN users author ON author.id = NEW.author_user_id
  JOIN teachers teacher ON teacher.id = NEW.teacher_id
  LEFT JOIN virtual_pe_notification_courses virtual
    ON virtual.teacher_name = teacher.name
  WHERE follow.followed_user_id = NEW.author_user_id
    AND follow.follower_user_id <> NEW.author_user_id
    AND author.public_code IS NOT NULL
    AND author.public_code >= 1;
END;

CREATE TRIGGER notify_user_followers_after_review_approval
AFTER UPDATE OF status ON reviews
WHEN OLD.status <> 'approved'
  AND NEW.status = 'approved'
  AND NEW.author_user_id IS NOT NULL
  AND NEW.teacher_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO user_notifications(
    user_id, type, message, link, event_key, source_review_id
  )
  SELECT
    follow.follower_user_id,
    'followed_user_review',
    '匿名用户#' || printf('%06d', author.public_code) || ' 发布了新任课评价',
    '/courses/' || COALESCE(virtual.virtual_course_id, NEW.course_id) || '?teacher=' || NEW.teacher_id || '#review-' || NEW.id,
    'followed-user-review:' || NEW.id || ':' || follow.follower_user_id,
    NEW.id
  FROM user_follows follow
  JOIN users author ON author.id = NEW.author_user_id
  JOIN teachers teacher ON teacher.id = NEW.teacher_id
  LEFT JOIN virtual_pe_notification_courses virtual
    ON virtual.teacher_name = teacher.name
  WHERE follow.followed_user_id = NEW.author_user_id
    AND follow.follower_user_id <> NEW.author_user_id
    AND author.public_code IS NOT NULL
    AND author.public_code >= 1;
END;

PRAGMA foreign_keys=ON;
