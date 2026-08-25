-- 投稿可选「仅限登录用户查看」：访客公开流不展示这些点评。
ALTER TABLE reviews ADD COLUMN login_only INTEGER NOT NULL DEFAULT 0
  CHECK (login_only IN (0, 1));
