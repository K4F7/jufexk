-- 推荐度下限从 1 改为 0.5（半星「快跑」）。SQLite 不能 ALTER CHECK，整表重建。
-- 先拆掉 SELECT reviews 的触发器，再换表；子表仍 REFERENCES reviews(id)，改名后挂回。

PRAGMA foreign_keys=OFF;

DROP TRIGGER IF EXISTS public_precompute_dirty_reviews_insert;
DROP TRIGGER IF EXISTS public_precompute_dirty_reviews_update;
DROP TRIGGER IF EXISTS public_precompute_dirty_reviews_delete;
DROP TRIGGER IF EXISTS notify_followers_after_approved_review_insert;
DROP TRIGGER IF EXISTS notify_followers_after_review_approval;
DROP TRIGGER IF EXISTS notify_user_followers_after_approved_review_insert;
DROP TRIGGER IF EXISTS notify_user_followers_after_review_approval;
DROP TRIGGER IF EXISTS notify_review_author_after_endorsement;
DROP TRIGGER IF EXISTS notify_review_comment_reply;

CREATE TABLE reviews_next(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  teacher_id INTEGER REFERENCES teachers(id),
  category TEXT NOT NULL CHECK(category IN('general','sports')),
  attendance TEXT NOT NULL DEFAULT '',
  grading TEXT NOT NULL DEFAULT '',
  workload TEXT NOT NULL DEFAULT '',
  rescue TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT '',
  teaching TEXT NOT NULL DEFAULT '',
  clarity INTEGER CHECK(clarity BETWEEN 1 AND 5),
  knowledge INTEGER CHECK(knowledge BETWEEN 1 AND 5),
  overall REAL CHECK(overall IS NULL OR (overall >= 0.5 AND overall <= 5)),
  comment TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
  moderator_note TEXT NOT NULL DEFAULT '',
  submitter_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  grading_score INTEGER CHECK(grading_score BETWEEN 1 AND 5),
  offering_id INTEGER REFERENCES offerings(id),
  interest INTEGER CHECK(interest BETWEEN 1 AND 5),
  practicality INTEGER CHECK(practicality BETWEEN 1 AND 5),
  workload_score INTEGER CHECK(workload_score BETWEEN 1 AND 5),
  fairness INTEGER CHECK(fairness BETWEEN 1 AND 5),
  organization INTEGER CHECK(organization BETWEEN 1 AND 5),
  scheme_key TEXT
    CHECK(scheme_key IS NULL OR scheme_key IN (
      'major','ideology','math','public_basic','english','pe'
    )),
  scheme_version INTEGER
    CHECK(scheme_version IS NULL OR scheme_version >= 1),
  scores TEXT,
  comment_format TEXT
    CHECK(comment_format IS NULL OR comment_format IN ('html')),
  headline TEXT NOT NULL DEFAULT '',
  grade TEXT,
  author_user_id TEXT,
  blocked_at TEXT,
  deleted_at TEXT,
  login_only INTEGER NOT NULL DEFAULT 0 CHECK (login_only IN (0, 1))
);

INSERT INTO reviews_next(
  id,course_id,teacher_id,category,attendance,grading,workload,rescue,assessment,teaching,
  clarity,knowledge,overall,comment,term,status,moderator_note,submitter_hash,created_at,
  reviewed_at,grading_score,offering_id,interest,practicality,workload_score,fairness,
  organization,scheme_key,scheme_version,scores,comment_format,headline,grade,author_user_id,
  blocked_at,deleted_at,login_only
)
SELECT
  id,course_id,teacher_id,category,attendance,grading,workload,rescue,assessment,teaching,
  clarity,knowledge,overall,comment,term,status,moderator_note,submitter_hash,created_at,
  reviewed_at,grading_score,offering_id,interest,practicality,workload_score,fairness,
  organization,scheme_key,scheme_version,scores,comment_format,headline,grade,author_user_id,
  blocked_at,deleted_at,login_only
FROM reviews;

DROP TABLE reviews;
ALTER TABLE reviews_next RENAME TO reviews;

CREATE INDEX idx_reviews_status_created ON reviews(status,created_at DESC);
CREATE INDEX idx_reviews_course_status ON reviews(course_id,status);
CREATE INDEX idx_reviews_teacher_status ON reviews(teacher_id,status);
CREATE INDEX idx_reviews_offering_status ON reviews(offering_id,status);
CREATE INDEX idx_reviews_author_created
  ON reviews(author_user_id, created_at DESC)
  WHERE author_user_id IS NOT NULL;

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
