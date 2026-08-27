-- PROTOTYPE / local UI preview only.
-- Seeds a realistic JUFE-shaped catalog so public pages render against real
-- API data (not mock components). Never apply this file to production D1.
-- Apply: pnpm db:local && pnpm db:seed-preview
-- Safe to re-run: catalog rows use unique keys + INSERT OR IGNORE; preview
-- reviews / signals with proto- prefixes are replaced.
--
-- 灌库后从 Vite :5173 打开 /prototype#page-atlas：每个界面可进可出。
-- 左下角「返回页面图集」。详情页依赖下面这些预览行。

PRAGMA foreign_keys=ON;

-- Replace preview-owned rows so re-running upgrades an old seed.
DELETE FROM catalog_requests WHERE submitter_hash LIKE 'proto-req-%';
DELETE FROM user_notifications
WHERE source_review_id IN (SELECT id FROM reviews WHERE submitter_hash LIKE 'proto-r-%');
DELETE FROM review_endorsements
WHERE review_id IN (SELECT id FROM reviews WHERE submitter_hash LIKE 'proto-r-%')
   OR user_id IN (
     'a0000000000000000000000000000001',
     'a0000000000000000000000000000002',
     'a0000000000000000000000000000003'
   );
DELETE FROM review_moderation_events
WHERE review_id IN (SELECT id FROM reviews WHERE submitter_hash LIKE 'proto-r-%');
DELETE FROM relation_follows
WHERE user_id IN (
  'a0000000000000000000000000000001',
  'a0000000000000000000000000000002',
  'a0000000000000000000000000000003'
);
DELETE FROM relation_recommendations
WHERE user_id IN (
  'a0000000000000000000000000000001',
  'a0000000000000000000000000000002',
  'a0000000000000000000000000000003'
);
DELETE FROM reviews WHERE submitter_hash LIKE 'proto-r-%';
DELETE FROM public_historical_reviews WHERE id LIKE 'proto-hist-%';

INSERT OR IGNORE INTO teachers(source_teacher_label, name, department, title, bio) VALUES
  ('林晓雯', '林晓雯', '会计学院', '副教授', '本地预览数据'),
  ('陈启明', '陈启明', '金融学院', '教授', '本地预览数据'),
  ('王若舟', '王若舟', '经济学院', '讲师', '本地预览数据'),
  ('赵敏', '赵敏', '法学院', '副教授', '本地预览数据'),
  ('刘洋', '刘洋', '信息管理学院', '讲师', '本地预览数据'),
  ('周慧', '周慧', '体育部', '讲师', '本地预览数据'),
  ('黄志远', '黄志远', '统计学院', '教授', '本地预览数据'),
  ('吴桐', '吴桐', '工商管理学院', '副教授', '本地预览数据'),
  ('苏晚', '苏晚', '会计学院', '讲师', '本地预览：同一门课的第二位教师'),
  ('何岚', '何岚', '马克思主义学院', '副教授', '本地预览：思政课'),
  ('郑齐', '郑齐', '理学院', '教授', '本地预览：高等数学'),
  ('高宁', '高宁', '外国语学院', '讲师', '本地预览：大学英语');

INSERT OR IGNORE INTO courses(code, name, category, department, credits, description) VALUES
  ('ACC2101', '中级财务会计', 'general', '会计学院', 3, '本地预览'),
  ('FIN1203', '货币金融学', 'general', '金融学院', 3, '本地预览'),
  ('ECO1101', '微观经济学', 'general', '经济学院', 3, '本地预览'),
  ('LAW1002', '法理学', 'general', '法学院', 2, '本地预览'),
  ('MIS2205', '管理信息系统', 'general', '信息管理学院', 3, '本地预览'),
  ('STA1301', '概率论与数理统计', 'general', '统计学院', 3, '本地预览'),
  ('MGT2001', '管理学原理', 'general', '工商管理学院', 2, '本地预览'),
  ('GEN0108', '中国传统文化导论', 'general', '人文学院', 2, '本地预览'),
  ('GEN0215', '批判性思维', 'general', '人文学院', 2, '本地预览'),
  ('PE0120', '羽毛球', 'sports', '体育部', 1, '本地预览'),
  ('PE0142', '乒乓球', 'sports', '体育部', 1, '本地预览'),
  ('ACC3108', '审计学', 'general', '会计学院', 3, '本地预览'),
  ('FIN2306', '投资学', 'general', '金融学院', 3, '本地预览'),
  ('ECO2104', '宏观经济学', 'general', '经济学院', 3, '本地预览'),
  ('LAW2201', '民法总论', 'general', '法学院', 3, '本地预览'),
  ('MIS3102', '数据分析基础', 'general', '信息管理学院', 2, '本地预览'),
  ('STA2204', '应用回归分析', 'general', '统计学院', 3, '本地预览'),
  ('MGT3105', '战略管理', 'general', '工商管理学院', 2, '本地预览'),
  ('GEN0302', '心理学与生活', 'general', '人文学院', 2, '本地预览'),
  ('ACC1101', '会计学原理', 'general', '会计学院', 3, '本地预览'),
  ('FIN1101', '金融学导论', 'general', '金融学院', 2, '本地预览'),
  ('ECO1001', '经济学原理', 'general', '经济学院', 3, '本地预览'),
  ('LAW1105', '宪法学', 'general', '法学院', 2, '本地预览'),
  ('MIS1101', '计算机应用基础', 'general', '信息管理学院', 2, '本地预览'),
  ('PE0160', '游泳', 'sports', '体育部', 1, '本地预览'),
  ('EMPTY001', '预览空态课程', 'general', '会计学院', 2, '本地预览：无点评'),
  ('MAR1001', '思想道德与法治', 'general', '马克思主义学院', 3, '本地预览：思政'),
  ('MAT1101', '高等数学A', 'general', '理学院', 4, '本地预览：数学'),
  ('ENG1001', '大学英语I', 'general', '外国语学院', 4, '本地预览：英语归并'),
  ('ENG1002', '大学英语II', 'general', '外国语学院', 4, '本地预览：英语归并'),
  ('GEN0401', '职业生涯规划', 'general', '人文学院', 2, '本地预览：网课');

UPDATE courses SET
  scheme_key = CASE
    WHEN code IN ('PE0120','PE0142','PE0160') THEN 'pe'
    WHEN code = 'MAR1001' THEN 'ideology'
    WHEN code = 'MAT1101' THEN 'math'
    WHEN code IN ('ENG1001','ENG1002') THEN 'english'
    WHEN code IN ('GEN0108','GEN0215','GEN0302','GEN0401') THEN 'public_basic'
    ELSE 'major'
  END,
  enrollment_category = CASE
    WHEN category = 'sports' THEN '公共必修'
    WHEN code LIKE 'GEN%' OR code LIKE 'ENG%' OR code = 'MAR1001' THEN '公共必修'
    WHEN code = 'MAT1101' THEN '学科基础课'
    WHEN code = 'EMPTY001' THEN '专业选修课'
    ELSE '专业必修课'
  END,
  teaching_type = CASE WHEN category = 'sports' THEN '实践课' ELSE '理论课' END,
  course_level = CASE
    WHEN category = 'sports' THEN '体育'
    WHEN code LIKE 'GEN%' THEN '通识教育'
    WHEN code = 'MAR1001' THEN '思想政治理论课'
    WHEN code = 'MAT1101' THEN '学科基础课'
    WHEN code LIKE 'ENG%' THEN '公共外语课'
    ELSE '专业必修课'
  END
WHERE code IN (
  'ACC2101','FIN1203','ECO1101','LAW1002','MIS2205','STA1301','MGT2001',
  'GEN0108','GEN0215','PE0120','PE0142','ACC3108','FIN2306','ECO2104',
  'LAW2201','MIS3102','STA2204','MGT3105','GEN0302','ACC1101','FIN1101',
  'ECO1001','LAW1105','MIS1101','PE0160','EMPTY001','MAR1001','MAT1101',
  'ENG1001','ENG1002','GEN0401'
);

UPDATE courses
SET admin_notice='期末闭卷，可带不可编程计算器。这是本地预览的课程管理员公告。',
    admin_notice_updated_at='2026-08-01 09:00:00'
WHERE code='ACC2101';

INSERT OR IGNORE INTO course_tags(course_id, tag)
SELECT id, 'mooc' FROM courses WHERE code='GEN0401';

INSERT OR IGNORE INTO course_name_variants(course_id, name)
SELECT id, '中级会计' FROM courses WHERE code='ACC2101';

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.source_teacher_label='林晓雯' AND t.department='会计学院'
WHERE c.code IN ('ACC2101','ACC3108','ACC1101');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.source_teacher_label='苏晚' AND t.department='会计学院'
WHERE c.code IN ('ACC2101','EMPTY001');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.source_teacher_label='陈启明' AND t.department='金融学院'
WHERE c.code IN ('FIN1203','FIN2306','FIN1101');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.source_teacher_label='王若舟' AND t.department='经济学院'
WHERE c.code IN ('ECO1101','ECO2104','ECO1001','GEN0108');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.source_teacher_label='赵敏' AND t.department='法学院'
WHERE c.code IN ('LAW1002','LAW2201','LAW1105','GEN0215');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.source_teacher_label='刘洋' AND t.department='信息管理学院'
WHERE c.code IN ('MIS2205','MIS3102','MIS1101','GEN0401');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.source_teacher_label='黄志远' AND t.department='统计学院'
WHERE c.code IN ('STA1301','STA2204');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.source_teacher_label='吴桐' AND t.department='工商管理学院'
WHERE c.code IN ('MGT2001','MGT3105','GEN0302');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.source_teacher_label='周慧' AND t.department='体育部'
WHERE c.code IN ('PE0120','PE0142','PE0160');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.source_teacher_label='何岚' AND t.department='马克思主义学院'
WHERE c.code='MAR1001';

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.source_teacher_label='郑齐' AND t.department='理学院'
WHERE c.code='MAT1101';

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.source_teacher_label='高宁' AND t.department='外国语学院'
WHERE c.code IN ('ENG1001','ENG1002');

UPDATE course_teachers
SET ai_summary='同学们普遍觉得例题扎实、作业量适中，给分比较公平。考试会划重点，建议提前做课后题。',
    ai_summary_updated_at='2026-08-10 12:00:00'
WHERE course_id=(SELECT id FROM courses WHERE code='ACC2101')
  AND teacher_id=(SELECT id FROM teachers WHERE source_teacher_label='林晓雯');

INSERT OR IGNORE INTO users(id, status, public_code, avatar_key) VALUES
  ('a0000000000000000000000000000001', 'active', 1, 1),
  ('a0000000000000000000000000000002', 'active', 2, 2),
  ('a0000000000000000000000000000003', 'active', 3, 3);

UPDATE user_public_code_seq
SET next_code = MAX(next_code, COALESCE((SELECT MAX(public_code) FROM users), 0) + 1)
WHERE id=1;

WITH preview_reviews(
  code, teacher, dept, overall, comment, comment_format, term, status, hash,
  created_at, reviewed_at, scheme_key, scheme_version, scores, headline, grade,
  author_user_id, login_only, moderator_note
) AS (
  VALUES
  ('ACC2101','林晓雯','会计学院',5.0,'例题扎实，作业量适中，值得认真跟课。',NULL,'2024-2025-1','approved','proto-r-001','2025-09-12 10:00:00','2025-09-12 12:00:00','major',4,'{"difficulty":2,"gain":1,"grading":1,"homework":2}','例题扎实值得选',NULL,'a0000000000000000000000000000001',0,''),
  ('ACC2101','林晓雯','会计学院',4.0,'节奏偏快，建议提前预习教材例题。',NULL,'2024-2025-1','approved','proto-r-002','2025-09-18 11:00:00','2025-09-18 12:00:00','major',4,'{"difficulty":3,"gain":2,"grading":2,"homework":2}','节奏偏快要预习',NULL,'a0000000000000000000000000000002',0,''),
  ('ACC2101','林晓雯','会计学院',5.0,'考试公平，划重点清晰，复习路径明确。',NULL,'2023-2024-2','approved','proto-r-003','2025-03-02 09:00:00','2025-03-02 10:00:00','major',4,'{"difficulty":2,"gain":1,"grading":1,"homework":2}','考试公平划重点',NULL,NULL,0,''),
  ('FIN1203','陈启明','金融学院',4.0,'理论与时事结合好，课堂案例很新。',NULL,'2024-2025-1','approved','proto-r-004','2025-10-01 10:00:00','2025-10-01 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":2,"homework":2}','时事结合得好',NULL,'a0000000000000000000000000000001',0,''),
  ('FIN1203','陈启明','金融学院',5.0,'课堂讨论多，收获大，适合爱提问的同学。',NULL,'2024-2025-1','approved','proto-r-005','2025-10-08 10:00:00','2025-10-08 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":1,"homework":2}','讨论多收获大',NULL,'a0000000000000000000000000000002',0,''),
  ('ECO1101','王若舟','经济学院',5.0,'模型讲得清楚，课后习题对考试很有用。',NULL,'2024-2025-1','approved','proto-r-006','2025-09-20 10:00:00','2025-09-20 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":1,"homework":2}','模型讲得很清楚',NULL,'a0000000000000000000000000000001',0,''),
  ('ECO1101','王若舟','经济学院',4.0,'习题课很有用，建议一次都不要缺。',NULL,'2023-2024-2','approved','proto-r-007','2025-03-12 10:00:00','2025-03-12 11:00:00','major',4,'{"difficulty":2,"gain":2,"grading":2,"homework":2}','习题课很有用',NULL,NULL,0,''),
  ('ECO1101','王若舟','经济学院',5.0,'推荐给大一，入门友好而且不水。',NULL,'2023-2024-1','approved','proto-r-008','2024-12-01 10:00:00','2024-12-01 11:00:00','major',4,'{"difficulty":1,"gain":1,"grading":1,"homework":1}','推荐给大一',NULL,NULL,0,''),
  ('LAW1002','赵敏','法学院',4.0,'阅读量大，但有启发，课堂讨论质量高。',NULL,'2024-2025-1','approved','proto-r-009','2025-09-22 10:00:00','2025-09-22 11:00:00','major',4,'{"difficulty":3,"gain":1,"grading":2,"homework":3}','阅读量大有启发',NULL,NULL,0,''),
  ('MIS2205','刘洋','信息管理学院',3.0,'实验环境偶尔不稳，但案例贴近企业。',NULL,'2024-2025-1','approved','proto-r-010','2025-10-02 10:00:00','2025-10-02 11:00:00','major',4,'{"difficulty":2,"gain":2,"grading":2,"homework":3}','实验环境偶尔不稳',NULL,'a0000000000000000000000000000002',0,''),
  ('MIS2205','刘洋','信息管理学院',4.0,'案例贴近企业，作业以报告为主。',NULL,'2023-2024-2','approved','proto-r-011','2025-03-20 10:00:00','2025-03-20 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":2,"homework":2}','案例贴近企业',NULL,NULL,0,''),
  ('STA1301','黄志远','统计学院',5.0,'推导严谨，板书好，适合打基础。',NULL,'2024-2025-1','approved','proto-r-012','2025-09-25 10:00:00','2025-09-25 11:00:00','major',4,'{"difficulty":3,"gain":1,"grading":2,"homework":3}','推导严谨板书好',NULL,'a0000000000000000000000000000001',0,''),
  ('STA1301','黄志远','统计学院',4.0,'难度偏高但值得，作业量中等偏上。',NULL,'2024-2025-1','approved','proto-r-013','2025-10-05 10:00:00','2025-10-05 11:00:00','major',4,'{"difficulty":3,"gain":1,"grading":2,"homework":3}','难度偏高但值得',NULL,NULL,0,''),
  ('STA1301','黄志远','统计学院',5.0,'作业批改认真，错题会在课上讲。',NULL,'2023-2024-2','approved','proto-r-014','2025-03-08 10:00:00','2025-03-08 11:00:00','major',4,'{"difficulty":3,"gain":1,"grading":1,"homework":2}','作业批改认真',NULL,NULL,0,''),
  ('STA1301','黄志远','统计学院',4.0,'期末范围明确，真题风格稳定。',NULL,'2023-2024-1','approved','proto-r-015','2024-12-18 10:00:00','2024-12-18 11:00:00','major',4,'{"difficulty":3,"gain":2,"grading":2,"homework":2}','期末范围明确',NULL,NULL,0,''),
  ('MGT2001','吴桐','工商管理学院',4.0,'小组作业多，平时分占比高。',NULL,'2024-2025-1','approved','proto-r-016','2025-09-28 10:00:00','2025-09-28 11:00:00','major',4,'{"difficulty":1,"gain":2,"grading":1,"homework":3}','小组作业比较多',NULL,NULL,0,''),
  ('GEN0108','王若舟','经济学院',5.0,'公选课良心，课堂轻松但有收获。',NULL,'2024-2025-1','approved','proto-r-017','2025-10-12 10:00:00','2025-10-12 11:00:00','public_basic',4,'{"difficulty":1,"gain":1,"grading":1,"homework":1}','公选课良心',NULL,'a0000000000000000000000000000001',0,''),
  ('GEN0215','赵敏','法学院',4.0,'讨论氛围好，阅读材料质量高。',NULL,'2024-2025-1','approved','proto-r-018','2025-10-15 10:00:00','2025-10-15 11:00:00','public_basic',4,'{"difficulty":2,"gain":1,"grading":2,"homework":2}','讨论氛围好',NULL,NULL,0,''),
  ('PE0120','周慧','体育部',5.0,'运动量刚好，教练会纠正动作。',NULL,'2024-2025-1','approved','proto-r-019','2025-09-16 10:00:00','2025-09-16 11:00:00','pe',4,'{"difficulty":1,"gain":1,"grading":1,"homework":1}','运动量刚好',NULL,'a0000000000000000000000000000001',0,''),
  ('PE0142','周慧','体育部',4.0,'器材够用，课堂以练习为主。',NULL,'2024-2025-1','approved','proto-r-020','2025-09-17 10:00:00','2025-09-17 11:00:00','pe',4,'{"difficulty":1,"gain":2,"grading":1,"homework":1}','器材够用',NULL,NULL,0,''),
  ('ACC3108','林晓雯','会计学院',4.0,'案例更新及时，和中级课衔接好。',NULL,'2024-2025-1','approved','proto-r-021','2025-10-20 10:00:00','2025-10-20 11:00:00','major',4,'{"difficulty":3,"gain":1,"grading":2,"homework":3}','案例更新及时',NULL,NULL,0,''),
  ('FIN2306','陈启明','金融学院',5.0,'模拟交易有趣，能把理论用起来。',NULL,'2024-2025-1','approved','proto-r-022','2025-10-22 10:00:00','2025-10-22 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":1,"homework":2}','模拟交易有趣',NULL,'a0000000000000000000000000000002',0,''),
  ('FIN2306','陈启明','金融学院',4.0,'公式多，要勤练，否则容易掉队。',NULL,'2023-2024-2','approved','proto-r-023','2025-03-15 10:00:00','2025-03-15 11:00:00','major',4,'{"difficulty":3,"gain":2,"grading":2,"homework":3}','公式多要勤练',NULL,NULL,0,''),
  ('ECO2104','王若舟','经济学院',4.0,'与微观衔接好，模型一脉相承。',NULL,'2024-2025-1','approved','proto-r-024','2025-10-24 10:00:00','2025-10-24 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":2,"homework":2}','与微观衔接好',NULL,NULL,0,''),
  ('LAW2201','赵敏','法学院',5.0,'体系清晰，法条和案例穿插讲解。',NULL,'2024-2025-1','approved','proto-r-025','2025-10-26 10:00:00','2025-10-26 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":1,"homework":2}','体系清晰',NULL,NULL,0,''),
  ('MIS3102','刘洋','信息管理学院',4.0,'Python 上手友好，作业可在机房完成。',NULL,'2024-2025-1','approved','proto-r-026','2025-10-28 10:00:00','2025-10-28 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":2,"homework":2}','Python 上手友好',NULL,NULL,0,''),
  ('STA2204','黄志远','统计学院',5.0,'项目作业实用，能做出完整分析报告。',NULL,'2024-2025-1','approved','proto-r-027','2025-10-30 10:00:00','2025-10-30 11:00:00','major',4,'{"difficulty":3,"gain":1,"grading":1,"homework":3}','项目作业实用',NULL,'a0000000000000000000000000000002',0,''),
  ('MGT3105','吴桐','工商管理学院',3.0,'小组报告压力大，平时要持续投入。',NULL,'2024-2025-1','approved','proto-r-028','2025-11-01 10:00:00','2025-11-01 11:00:00','major',4,'{"difficulty":2,"gain":2,"grading":2,"homework":3}','小组报告压力大',NULL,NULL,0,''),
  ('GEN0302','吴桐','工商管理学院',5.0,'轻松有收获，适合想换口气的学期。',NULL,'2024-2025-1','approved','proto-r-029','2025-11-03 10:00:00','2025-11-03 11:00:00','public_basic',4,'{"difficulty":1,"gain":1,"grading":1,"homework":1}','轻松有收获',NULL,NULL,0,''),
  ('ACC1101','林晓雯','会计学院',4.0,'入门推荐，会计分录会反复练。',NULL,'2023-2024-1','approved','proto-r-030','2024-11-20 10:00:00','2024-11-20 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":2,"homework":2}','入门推荐',NULL,NULL,0,''),
  ('ACC1101','林晓雯','会计学院',5.0,'作业反馈快，不懂的当堂就能问。',NULL,'2024-2025-1','approved','proto-r-031','2025-11-05 10:00:00','2025-11-05 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":1,"homework":2}','作业反馈快',NULL,NULL,0,''),
  ('FIN1101','陈启明','金融学院',4.0,'适合低年级，概念讲得慢而清楚。',NULL,'2024-2025-1','approved','proto-r-032','2025-11-07 10:00:00','2025-11-07 11:00:00','major',4,'{"difficulty":1,"gain":2,"grading":1,"homework":1}','适合低年级',NULL,NULL,0,''),
  ('ECO1001','王若舟','经济学院',5.0,'图示很多，适合第一次接触经济学。',NULL,'2024-2025-1','approved','proto-r-033','2025-11-09 10:00:00','2025-11-09 11:00:00','major',4,'{"difficulty":1,"gain":1,"grading":1,"homework":1}','图示很多',NULL,NULL,0,''),
  ('LAW1105','赵敏','法学院',4.0,'阅读材料质量高，课堂会对照宪法文本。',NULL,'2024-2025-1','approved','proto-r-034','2025-11-11 10:00:00','2025-11-11 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":2,"homework":2}','阅读材料质量高',NULL,NULL,0,''),
  ('MIS1101','刘洋','信息管理学院',3.0,'内容偏基础，有计算机基础会较轻松。',NULL,'2024-2025-1','approved','proto-r-035','2025-11-13 10:00:00','2025-11-13 11:00:00','major',4,'{"difficulty":1,"gain":3,"grading":2,"homework":1}','内容偏基础',NULL,NULL,0,''),
  ('PE0160','周慧','体育部',5.0,'教练耐心，游泳课安全提醒很到位。',NULL,'2024-2025-1','approved','proto-r-036','2025-11-15 10:00:00','2025-11-15 11:00:00','pe',4,'{"difficulty":2,"gain":1,"grading":1,"homework":1}','教练耐心',NULL,NULL,0,''),
  ('ACC2101','林晓雯','会计学院',4.0,'这是一条保留的 v3 快照，公开条目仍应显示考勤松紧。',NULL,'2024-2025-1','approved','proto-r-037','2025-06-01 10:00:00','2025-06-01 11:00:00','major',3,'{"attendance":2,"difficulty":2,"gain":1,"grading":1,"homework":2}','v3 快照含考勤',NULL,NULL,0,''),
  ('ACC2101','林晓雯','会计学院',5.0,'这是一条保留的 v1 快照，公开条目仍应显示维度均分。',NULL,'2023-2024-1','approved','proto-r-038','2024-06-01 10:00:00','2024-06-01 11:00:00','major',1,'{"attendance":3,"grading":5,"teaching":4,"workload":2}','v1 旧快照',NULL,NULL,0,''),
  ('ACC2101','林晓雯','会计学院',NULL,'只写点评不评分的预览样本，公开流不应出现伪造的推荐度。',NULL,'2025-2026-1','approved','proto-r-039','2026-03-01 10:00:00','2026-03-01 11:00:00',NULL,NULL,NULL,'只写点评不评分',NULL,'a0000000000000000000000000000001',0,''),
  ('ACC2101','林晓雯','会计学院',5.0,'<p>例题很扎实，作业量适中。</p><ul><li>建议先做教材课后题</li><li>考试会划重点</li></ul>','html','2025-2026-1','approved','proto-r-040','2026-03-08 10:00:00','2026-03-08 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":1,"homework":2}','富文本补充说明',NULL,NULL,0,''),
  ('ACC2101','林晓雯','会计学院',4.0,'仅登录用户可见的预览点评正文，访客公开流不应出现。',NULL,'2025-2026-1','approved','proto-r-041','2026-03-12 10:00:00','2026-03-12 11:00:00','major',4,'{"difficulty":2,"gain":2,"grading":2,"homework":2}','仅登录可见',NULL,NULL,1,''),
  ('ACC2101','林晓雯','会计学院',3.0,'这是一条待审核的预览点评，公开流不应出现。',NULL,'2025-2026-1','pending','proto-r-042','2026-04-01 10:00:00',NULL,'major',4,'{"difficulty":2,"gain":2,"grading":2,"homework":2}','待审核样例',NULL,NULL,0,''),
  ('ACC2101','林晓雯','会计学院',2.0,'这是一条已驳回的预览点评，公开流不应出现。',NULL,'2025-2026-1','rejected','proto-r-043','2026-04-02 10:00:00','2026-04-03 10:00:00','major',4,'{"difficulty":3,"gain":3,"grading":3,"homework":3}','已驳回样例',NULL,NULL,0,'本地预览：驳回样例'),
  ('ACC2101','苏晚','会计学院',4.0,'另一位老师的课堂更偏练习，适合想多做题的同学。',NULL,'2025-2026-1','approved','proto-r-044','2026-03-20 10:00:00','2026-03-20 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":2,"homework":3}','偏练习的课堂',NULL,'a0000000000000000000000000000002',0,''),
  ('MAR1001','何岚','马克思主义学院',5.0,'课堂讨论认真，作业以读书笔记为主，给分稳定。',NULL,'2025-2026-1','approved','proto-r-045','2026-03-22 10:00:00','2026-03-22 11:00:00','ideology',4,'{"difficulty":1,"gain":1,"grading":1,"homework":2}','讨论认真给分稳',NULL,NULL,0,''),
  ('MAT1101','郑齐','理学院',3.0,'进度快、作业多，但讲义清楚，跟上就能过。',NULL,'2025-2026-1','approved','proto-r-046','2026-03-24 10:00:00','2026-03-24 11:00:00','math',4,'{"difficulty":3,"gain":1,"grading":2,"homework":3}','进度快作业多','88',NULL,0,''),
  ('ENG1001','高宁','外国语学院',4.0,'听说练习多，课文难度适中，适合打基础。',NULL,'2025-2026-1','approved','proto-r-047','2026-03-26 10:00:00','2026-03-26 11:00:00','english',4,'{"difficulty":2,"gain":2,"grading":1,"homework":2}','听说练习多',NULL,NULL,0,''),
  ('ENG1002','高宁','外国语学院',5.0,'读写任务明确，课堂节奏稳，和 I 级衔接好。',NULL,'2025-2026-1','approved','proto-r-048','2026-03-28 10:00:00','2026-03-28 11:00:00','english',4,'{"difficulty":2,"gain":1,"grading":1,"homework":2}','读写任务明确',NULL,NULL,0,''),
  ('GEN0401','刘洋','信息管理学院',4.0,'网课没有线下签到，作业按周提交，节奏好控。',NULL,'2025-2026-1','approved','proto-r-049','2026-03-30 10:00:00','2026-03-30 11:00:00','public_basic',4,'{"difficulty":1,"gain":2,"grading":1,"homework":2}','网课节奏好控',NULL,NULL,0,''),
  ('ACC3108','林晓雯','会计学院',4.0,'这是一条偏长的预览点评，用来观察课程页和最新课评在窄屏上的折行与间距。内容仍然只谈这门课的作业、考试和课堂节奏，避免空话。期中之后作业会明显变难，建议预留整块时间做综合题，不要拖到截止当天。',NULL,'2025-2026-1','approved','proto-r-050','2026-04-04 10:00:00','2026-04-04 11:00:00','major',4,'{"difficulty":3,"gain":1,"grading":2,"homework":3}','长评观察折行',NULL,NULL,0,''),
  ('FIN1203','陈启明','金融学院',5.0,'带成绩字段的预览点评，成绩只展示不参与排序。',NULL,'2025-2026-1','approved','proto-r-051','2026-04-06 10:00:00','2026-04-06 11:00:00','major',4,'{"difficulty":2,"gain":1,"grading":1,"homework":2}','给分样本','95','a0000000000000000000000000000001',0,''),
  ('PE0120','周慧','体育部',NULL,'体育课也可以只写文字、不打推荐度，用来对照空星级。',NULL,'2025-2026-1','approved','proto-r-052','2026-04-08 10:00:00','2026-04-08 11:00:00',NULL,NULL,NULL,'体育课纯文字',NULL,NULL,0,'')
)
INSERT INTO reviews(
  course_id, teacher_id, category, overall, comment, comment_format, term, status,
  submitter_hash, created_at, reviewed_at, scheme_key, scheme_version, scores,
  headline, grade, author_user_id, login_only, moderator_note
)
SELECT
  c.id, t.id, c.category, v.overall, v.comment, v.comment_format, v.term, v.status,
  v.hash, v.created_at, v.reviewed_at, v.scheme_key, v.scheme_version, v.scores,
  v.headline, v.grade, v.author_user_id, v.login_only, v.moderator_note
FROM preview_reviews v
JOIN courses c ON c.code=v.code
JOIN teachers t ON t.source_teacher_label=v.teacher AND t.department=v.dept;

INSERT INTO public_historical_reviews(
  id, course_id, teacher_id, comment, package_contract,
  approved_package_manifest_sha256, approved_catalog_content_sha256, imported_at
)
SELECT
  'proto-hist-001', c.id, t.id,
  '历史文字资料预览：当年课堂很赶，但老师答疑耐心，适合对照现行点评流。',
  'proto-preview', 'proto-preview-manifest', 'proto-preview-catalog',
  '2024-06-02 08:00:00'
FROM courses c JOIN teachers t
  ON t.source_teacher_label='林晓雯' AND t.department='会计学院'
WHERE c.code='ACC2101';

INSERT INTO public_historical_reviews(
  id, course_id, teacher_id, comment, package_contract,
  approved_package_manifest_sha256, approved_catalog_content_sha256, imported_at
)
SELECT
  'proto-hist-002', c.id, t.id,
  '历史文字资料预览：公选课作业轻，课堂以讲座为主。',
  'proto-preview', 'proto-preview-manifest', 'proto-preview-catalog',
  '2024-06-03 08:00:00'
FROM courses c JOIN teachers t
  ON t.source_teacher_label='王若舟' AND t.department='经济学院'
WHERE c.code='GEN0108';

INSERT INTO review_endorsements(user_id, review_id)
SELECT 'a0000000000000000000000000000002', id FROM reviews WHERE submitter_hash='proto-r-001';
INSERT INTO review_endorsements(user_id, review_id)
SELECT 'a0000000000000000000000000000003', id FROM reviews WHERE submitter_hash='proto-r-001';
INSERT INTO review_endorsements(user_id, review_id)
SELECT 'a0000000000000000000000000000003', id FROM reviews WHERE submitter_hash='proto-r-006';

INSERT INTO relation_follows(user_id, course_id, teacher_id)
SELECT 'a0000000000000000000000000000001', c.id, t.id
FROM courses c JOIN teachers t ON t.source_teacher_label='林晓雯'
WHERE c.code='ACC2101';

INSERT INTO relation_follows(user_id, course_id, teacher_id)
SELECT 'a0000000000000000000000000000002', c.id, t.id
FROM courses c JOIN teachers t ON t.source_teacher_label='林晓雯'
WHERE c.code='ACC2101';

INSERT INTO relation_recommendations(user_id, course_id, teacher_id, stance)
SELECT 'a0000000000000000000000000000001', c.id, t.id, 'recommend'
FROM courses c JOIN teachers t ON t.source_teacher_label='林晓雯'
WHERE c.code='ACC2101';

INSERT INTO relation_recommendations(user_id, course_id, teacher_id, stance)
SELECT 'a0000000000000000000000000000002', c.id, t.id, 'not_recommend'
FROM courses c JOIN teachers t ON t.source_teacher_label='林晓雯'
WHERE c.code='ACC2101';

UPDATE site_banner_current
SET desktop_html='<p>本地预览种子已加载（桌面）。可打开课程页和最新课评查看各状态。</p>',
    mobile_html='<p>本地预览种子已加载（移动）。</p>',
    updated_at='2026-08-21 09:30:00'
WHERE id=1;

INSERT INTO catalog_requests(
  kind, course_code, course_name, category, teacher_name, teacher_source_label,
  department, note, status, submitter_hash, created_at
) VALUES
  ('course','NEW9999','预览待审课程','general','','','会计学院','本地预览：待审课程补充','pending','proto-req-001','2026-08-18 10:00:00'),
  ('teacher','','','','预览待审教师','预览待审教师','金融学院','本地预览：待审教师补充','pending','proto-req-002','2026-08-18 10:05:00');
