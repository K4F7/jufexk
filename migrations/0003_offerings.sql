CREATE TABLE offerings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  term TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT '',
  campus TEXT NOT NULL DEFAULT '',
  schedule TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(course_id,term,section)
);
CREATE TABLE offering_teachers(
  offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  PRIMARY KEY(offering_id,teacher_id)
);
ALTER TABLE reviews ADD COLUMN offering_id INTEGER REFERENCES offerings(id);
CREATE INDEX idx_offerings_course_term ON offerings(course_id,term);
CREATE INDEX idx_reviews_offering_status ON reviews(offering_id,status);
INSERT INTO offerings(course_id,term,section,status)
SELECT id,'','历史数据','active' FROM courses;
INSERT INTO offering_teachers(offering_id,teacher_id)
SELECT o.id,ct.teacher_id FROM offerings o JOIN course_teachers ct ON ct.course_id=o.course_id WHERE o.section='历史数据';
UPDATE reviews SET offering_id=(SELECT o.id FROM offerings o WHERE o.course_id=reviews.course_id AND o.section='历史数据' LIMIT 1) WHERE offering_id IS NULL;
