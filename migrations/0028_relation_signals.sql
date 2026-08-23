-- Course×teacher follow / recommend / not-recommend (issue #410).
-- These signals are ordinary-user actions and MUST stay decoupled from
-- rating / 推荐度 aggregation (ADR-0026). users.id is the stable identity;
-- no foreign key onto the evolving account schema, matching review_endorsements.
CREATE TABLE relation_follows (
  user_id TEXT NOT NULL,
  course_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, course_id, teacher_id)
);
CREATE INDEX idx_relation_follows_relation
  ON relation_follows(course_id, teacher_id);

CREATE TABLE relation_recommendations (
  user_id TEXT NOT NULL,
  course_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  stance TEXT NOT NULL CHECK(stance IN ('recommend', 'not_recommend')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, course_id, teacher_id)
);
CREATE INDEX idx_relation_recommendations_relation
  ON relation_recommendations(course_id, teacher_id);
