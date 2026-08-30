-- 推荐度下限从 1 改为 0.5（半星「快跑」）。SQLite 不能 ALTER CHECK，整表重建。
-- 先落到 reviews_next，再把引用 reviews 的子表改挂过去，最后才丢掉旧表。

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
DROP TRIGGER IF EXISTS review_challenge_clears_endorsement;
DROP TRIGGER IF EXISTS review_endorsement_clears_challenge;

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

CREATE TABLE review_moderation_events_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL REFERENCES reviews_next(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN (
    'approved','rejected','edited','blocked','unblocked','deleted','author_lookup'
  )),
  note TEXT NOT NULL DEFAULT '',
  actor_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO review_moderation_events_next(id,review_id,action,note,actor_session_id,created_at)
SELECT id,review_id,action,note,actor_session_id,created_at FROM review_moderation_events;
DROP TABLE review_moderation_events;
ALTER TABLE review_moderation_events_next RENAME TO review_moderation_events;

CREATE TABLE review_endorsements_next (
  user_id TEXT NOT NULL,
  review_id INTEGER NOT NULL REFERENCES reviews_next(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, review_id)
);
INSERT INTO review_endorsements_next(user_id,review_id,created_at)
SELECT user_id,review_id,created_at FROM review_endorsements;
DROP TABLE review_endorsements;
ALTER TABLE review_endorsements_next RENAME TO review_endorsements;

CREATE TABLE user_notifications_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL
    CHECK(type IN (
      'followed_relation_review',
      'review_endorsed',
      'followed_user_review',
      'user_followed',
      'review_comment_replied'
    )),
  message TEXT NOT NULL CHECK(length(trim(message)) > 0),
  link TEXT NOT NULL CHECK(substr(link, 1, 1) = '/'),
  event_key TEXT NOT NULL UNIQUE,
  source_review_id INTEGER REFERENCES reviews_next(id) ON DELETE CASCADE,
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

CREATE TABLE catalog_requests_next(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN('course','teacher')),
  course_code TEXT NOT NULL DEFAULT '',
  course_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '' CHECK(category IN('','general','sports')),
  teacher_name TEXT NOT NULL DEFAULT '',
  teacher_source_label TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  pending_review_json TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
  moderator_note TEXT NOT NULL DEFAULT '',
  created_course_id INTEGER REFERENCES courses(id),
  created_teacher_id INTEGER REFERENCES teachers(id),
  created_review_id INTEGER REFERENCES reviews_next(id),
  submitter_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  author_user_id TEXT
);
INSERT INTO catalog_requests_next(
  id,kind,course_code,course_name,category,teacher_name,teacher_source_label,department,
  note,pending_review_json,status,moderator_note,created_course_id,created_teacher_id,
  created_review_id,submitter_hash,created_at,reviewed_at,author_user_id
)
SELECT
  id,kind,course_code,course_name,category,teacher_name,teacher_source_label,department,
  note,pending_review_json,status,moderator_note,created_course_id,created_teacher_id,
  created_review_id,submitter_hash,created_at,reviewed_at,author_user_id
FROM catalog_requests;

CREATE TABLE catalog_request_moderation_events_next(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_request_id INTEGER NOT NULL REFERENCES catalog_requests_next(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN('approved','rejected')),
  note TEXT NOT NULL DEFAULT '',
  actor_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO catalog_request_moderation_events_next(
  id,catalog_request_id,action,note,actor_session_id,created_at
)
SELECT id,catalog_request_id,action,note,actor_session_id,created_at
FROM catalog_request_moderation_events;
DROP TABLE catalog_request_moderation_events;
DROP TABLE catalog_requests;
ALTER TABLE catalog_requests_next RENAME TO catalog_requests;
ALTER TABLE catalog_request_moderation_events_next RENAME TO catalog_request_moderation_events;

CREATE TABLE review_comments_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL,
  review_id INTEGER REFERENCES reviews_next(id) ON DELETE CASCADE,
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
  id, public_id, review_id, parent_comment_id, author_user_id, body,
  created_at, deleted_at
FROM review_comments;

CREATE TABLE review_comment_endorsements_next (
  user_id TEXT NOT NULL,
  comment_id INTEGER NOT NULL REFERENCES review_comments_next(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, comment_id)
);
INSERT INTO review_comment_endorsements_next(user_id, comment_id, created_at)
SELECT user_id, comment_id, created_at FROM review_comment_endorsements;
DROP TABLE review_comment_endorsements;
DROP TABLE review_comments;
ALTER TABLE review_comments_next RENAME TO review_comments;
ALTER TABLE review_comment_endorsements_next RENAME TO review_comment_endorsements;

CREATE TABLE review_challenges_next (
  user_id TEXT NOT NULL,
  review_id INTEGER NOT NULL REFERENCES reviews_next(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, review_id)
);
INSERT INTO review_challenges_next(user_id, review_id, created_at)
SELECT user_id, review_id, created_at FROM review_challenges;
DROP TABLE review_challenges;
ALTER TABLE review_challenges_next RENAME TO review_challenges;

DROP TABLE reviews;
ALTER TABLE reviews_next RENAME TO reviews;

CREATE INDEX idx_reviews_status_created ON reviews(status,created_at DESC);
CREATE INDEX idx_reviews_course_status ON reviews(course_id,status);
CREATE INDEX idx_reviews_teacher_status ON reviews(teacher_id,status);
CREATE INDEX idx_reviews_offering_status ON reviews(offering_id,status);
CREATE INDEX idx_reviews_author_created
  ON reviews(author_user_id, created_at DESC)
  WHERE author_user_id IS NOT NULL;
CREATE INDEX idx_review_moderation_events_review
  ON review_moderation_events(review_id,created_at DESC,id DESC);
CREATE INDEX idx_review_endorsements_review ON review_endorsements(review_id);
CREATE INDEX idx_user_notifications_inbox
  ON user_notifications(user_id, created_at DESC, id DESC);
CREATE INDEX idx_user_notifications_unread
  ON user_notifications(user_id, read_at)
  WHERE read_at IS NULL;
CREATE INDEX idx_catalog_requests_status_created ON catalog_requests(status,created_at DESC);
CREATE INDEX idx_catalog_requests_author_user ON catalog_requests(author_user_id);
CREATE UNIQUE INDEX idx_catalog_request_one_decision
  ON catalog_request_moderation_events(catalog_request_id);
CREATE INDEX idx_catalog_request_mod_time
  ON catalog_request_moderation_events(catalog_request_id,created_at DESC,id DESC);
CREATE INDEX idx_review_comments_review
  ON review_comments(review_id, created_at, id)
  WHERE deleted_at IS NULL AND review_id IS NOT NULL;
CREATE INDEX idx_review_comments_public
  ON review_comments(public_id, created_at, id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_review_comment_endorsements_comment
  ON review_comment_endorsements(comment_id);
CREATE INDEX idx_review_challenges_review ON review_challenges(review_id);

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

CREATE TRIGGER review_challenge_clears_endorsement
AFTER INSERT ON review_challenges
BEGIN
  DELETE FROM review_endorsements
  WHERE user_id=NEW.user_id AND review_id=NEW.review_id;
END;

CREATE TRIGGER review_endorsement_clears_challenge
AFTER INSERT ON review_endorsements
BEGIN
  DELETE FROM review_challenges
  WHERE user_id=NEW.user_id AND review_id=NEW.review_id;
END;

PRAGMA foreign_keys=ON;
