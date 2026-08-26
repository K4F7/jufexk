-- 培养方案理论课程课号表（#637 / #640）：年级×专业×课号×建议学期。
-- 不写入 courses.enrollment_category；开课班仍走 schedule-offerings。
CREATE TABLE program_plan_courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grade TEXT NOT NULL,
  department_code TEXT NOT NULL DEFAULT '',
  department_name TEXT NOT NULL DEFAULT '',
  major_code TEXT NOT NULL,
  major_name TEXT NOT NULL,
  study_kind TEXT NOT NULL DEFAULT '主修' CHECK (study_kind = '主修'),
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  credits REAL,
  category_path TEXT NOT NULL DEFAULT '',
  course_standing TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT '',
  suggested_term TEXT NOT NULL DEFAULT '',
  total_hours REAL,
  lecture_hours REAL,
  lab_hours REAL,
  practice_hours REAL,
  other_hours REAL,
  weekly_hours REAL,
  catalog_course_id INTEGER REFERENCES courses(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (grade, major_code, course_code, suggested_term)
);
CREATE INDEX idx_program_plan_grade_major_name ON program_plan_courses (grade, major_name);
CREATE INDEX idx_program_plan_grade_major_code ON program_plan_courses (grade, major_code);
CREATE INDEX idx_program_plan_course_code ON program_plan_courses (course_code);
