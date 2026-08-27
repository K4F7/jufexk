-- 回复认可：与 review_endorsements 同构，按评论计票。
-- 不建通知触发器；账号删除时由 ordinary-user-account 清行。
CREATE TABLE review_comment_endorsements (
  user_id TEXT NOT NULL,
  comment_id INTEGER NOT NULL REFERENCES review_comments(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX idx_review_comment_endorsements_comment
  ON review_comment_endorsements(comment_id);
