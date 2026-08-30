-- 评价质疑：与认可互斥的负向参考价值信号（issue #693）。
-- 独立表，不改 review_endorsements 的整数外键。触发器保证一人一条、两侧互斥。

CREATE TABLE review_challenges (
  user_id TEXT NOT NULL,
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, review_id)
);
CREATE INDEX idx_review_challenges_review ON review_challenges(review_id);

CREATE TABLE historical_review_challenges (
  user_id TEXT NOT NULL,
  historical_review_id TEXT NOT NULL
    REFERENCES public_historical_reviews(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, historical_review_id)
);
CREATE INDEX idx_historical_review_challenges_review
  ON historical_review_challenges(historical_review_id);

CREATE TABLE legacy_review_challenges (
  user_id TEXT NOT NULL,
  legacy_review_id INTEGER NOT NULL
    REFERENCES legacy_reviews(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, legacy_review_id)
);
CREATE INDEX idx_legacy_review_challenges_review
  ON legacy_review_challenges(legacy_review_id);

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

CREATE TRIGGER historical_review_challenge_clears_endorsement
AFTER INSERT ON historical_review_challenges
BEGIN
  DELETE FROM historical_review_endorsements
  WHERE user_id=NEW.user_id AND historical_review_id=NEW.historical_review_id;
END;

CREATE TRIGGER historical_review_endorsement_clears_challenge
AFTER INSERT ON historical_review_endorsements
BEGIN
  DELETE FROM historical_review_challenges
  WHERE user_id=NEW.user_id AND historical_review_id=NEW.historical_review_id;
END;

CREATE TRIGGER legacy_review_challenge_clears_endorsement
AFTER INSERT ON legacy_review_challenges
BEGIN
  DELETE FROM legacy_review_endorsements
  WHERE user_id=NEW.user_id AND legacy_review_id=NEW.legacy_review_id;
END;

CREATE TRIGGER legacy_review_endorsement_clears_challenge
AFTER INSERT ON legacy_review_endorsements
BEGIN
  DELETE FROM legacy_review_challenges
  WHERE user_id=NEW.user_id AND legacy_review_id=NEW.legacy_review_id;
END;
