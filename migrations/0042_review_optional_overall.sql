-- 只写点评不评分：overall / scores 可为 NULL，不再伪造推荐度。
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
  overall REAL CHECK(overall IS NULL OR (overall >= 1 AND overall <= 5)),
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
  id,course_id,teacher_id,
  CASE WHEN category IN('sports','pe') THEN 'sports' ELSE 'general' END,
  attendance,grading,workload,rescue,assessment,teaching,
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
      'followed_user_review'
    )),
  message TEXT NOT NULL CHECK(length(trim(message)) > 0),
  link TEXT NOT NULL CHECK(substr(link, 1, 1) = '/'),
  event_key TEXT NOT NULL UNIQUE,
  source_review_id INTEGER NOT NULL REFERENCES reviews_next(id) ON DELETE CASCADE,
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
  id,kind,course_code,course_name,
  CASE
    WHEN category='' THEN ''
    WHEN category IN('sports','pe') THEN 'sports'
    ELSE 'general'
  END,
  teacher_name,teacher_source_label,department,
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
