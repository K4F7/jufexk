-- PROTOTYPE / local UI preview only.
-- Seeds a realistic JUFE-shaped catalog so /courses and shell-nav variants
-- render against real API data (not mock components).
-- Apply: pnpm db:seed-preview
-- Safe to re-run: unique keys + INSERT OR IGNORE / NOT EXISTS, not a marker-course skip.

PRAGMA foreign_keys=ON;

-- Schema notes (keep this file aligned with current migrations):
-- teachers require source_teacher_label (UNIQUE); courses.category is general|sports.
INSERT OR IGNORE INTO teachers(source_teacher_label, name, department, title, bio) VALUES
  ('林晓雯', '林晓雯', '会计学院', '副教授', '本地预览数据'),
  ('陈启明', '陈启明', '金融学院', '教授', '本地预览数据'),
  ('王若舟', '王若舟', '经济学院', '讲师', '本地预览数据'),
  ('赵敏', '赵敏', '法学院', '副教授', '本地预览数据'),
  ('刘洋', '刘洋', '信息管理学院', '讲师', '本地预览数据'),
  ('周慧', '周慧', '体育部', '讲师', '本地预览数据'),
  ('黄志远', '黄志远', '统计学院', '教授', '本地预览数据'),
  ('吴桐', '吴桐', '工商管理学院', '副教授', '本地预览数据');

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
  ('PE0160', '游泳', 'sports', '体育部', 1, '本地预览');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.name='林晓雯' AND t.department='会计学院'
WHERE c.code IN ('ACC2101','ACC3108','ACC1101');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.name='陈启明' AND t.department='金融学院'
WHERE c.code IN ('FIN1203','FIN2306','FIN1101');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.name='王若舟' AND t.department='经济学院'
WHERE c.code IN ('ECO1101','ECO2104','ECO1001','GEN0108');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.name='赵敏' AND t.department='法学院'
WHERE c.code IN ('LAW1002','LAW2201','LAW1105','GEN0215');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.name='刘洋' AND t.department='信息管理学院'
WHERE c.code IN ('MIS2205','MIS3102','MIS1101');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.name='黄志远' AND t.department='统计学院'
WHERE c.code IN ('STA1301','STA2204');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.name='吴桐' AND t.department='工商管理学院'
WHERE c.code IN ('MGT2001','MGT3105','GEN0302');

INSERT OR IGNORE INTO course_teachers(course_id, teacher_id)
SELECT c.id, t.id FROM courses c JOIN teachers t
  ON t.name='周慧' AND t.department='体育部'
WHERE c.code IN ('PE0120','PE0142','PE0160');

-- Reviews: only insert when marker hash missing (re-run safe for this block).
INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '例题扎实，作业量适中。', '2024-2025-1', 'approved', 'proto-r-001', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='林晓雯' AND t.department='会计学院'
WHERE c.code='ACC2101' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-001');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '节奏偏快，建议提前预习。', '2024-2025-1', 'approved', 'proto-r-002', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='林晓雯' AND t.department='会计学院'
WHERE c.code='ACC2101' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-002');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '考试公平，划重点清晰。', '2023-2024-2', 'approved', 'proto-r-003', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='林晓雯' AND t.department='会计学院'
WHERE c.code='ACC2101' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-003');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '理论与时事结合好。', '2024-2025-1', 'approved', 'proto-r-004', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='陈启明' AND t.department='金融学院'
WHERE c.code='FIN1203' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-004');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '课堂讨论多，收获大。', '2024-2025-1', 'approved', 'proto-r-005', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='陈启明' AND t.department='金融学院'
WHERE c.code='FIN1203' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-005');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '模型讲得清楚。', '2024-2025-1', 'approved', 'proto-r-006', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='王若舟' AND t.department='经济学院'
WHERE c.code='ECO1101' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-006');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '习题课很有用。', '2023-2024-2', 'approved', 'proto-r-007', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='王若舟' AND t.department='经济学院'
WHERE c.code='ECO1101' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-007');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '推荐给大一。', '2023-2024-1', 'approved', 'proto-r-008', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='王若舟' AND t.department='经济学院'
WHERE c.code='ECO1101' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-008');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '阅读量大，但有启发。', '2024-2025-1', 'approved', 'proto-r-009', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='赵敏' AND t.department='法学院'
WHERE c.code='LAW1002' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-009');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 3, '实验环境偶尔不稳。', '2024-2025-1', 'approved', 'proto-r-010', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='刘洋' AND t.department='信息管理学院'
WHERE c.code='MIS2205' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-010');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '案例贴近企业。', '2023-2024-2', 'approved', 'proto-r-011', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='刘洋' AND t.department='信息管理学院'
WHERE c.code='MIS2205' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-011');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '推导严谨，板书好。', '2024-2025-1', 'approved', 'proto-r-012', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='黄志远' AND t.department='统计学院'
WHERE c.code='STA1301' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-012');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '难度偏高但值得。', '2024-2025-1', 'approved', 'proto-r-013', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='黄志远' AND t.department='统计学院'
WHERE c.code='STA1301' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-013');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '作业批改认真。', '2023-2024-2', 'approved', 'proto-r-014', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='黄志远' AND t.department='统计学院'
WHERE c.code='STA1301' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-014');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '期末范围明确。', '2023-2024-1', 'approved', 'proto-r-015', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='黄志远' AND t.department='统计学院'
WHERE c.code='STA1301' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-015');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '小组作业多。', '2024-2025-1', 'approved', 'proto-r-016', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='吴桐' AND t.department='工商管理学院'
WHERE c.code='MGT2001' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-016');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '公选课良心。', '2024-2025-1', 'approved', 'proto-r-017', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='王若舟' AND t.department='经济学院'
WHERE c.code='GEN0108' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-017');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '讨论氛围好。', '2024-2025-1', 'approved', 'proto-r-018', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='赵敏' AND t.department='法学院'
WHERE c.code='GEN0215' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-018');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '运动量刚好。', '2024-2025-1', 'approved', 'proto-r-019', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='周慧' AND t.department='体育部'
WHERE c.code='PE0120' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-019');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '器材够用。', '2024-2025-1', 'approved', 'proto-r-020', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='周慧' AND t.department='体育部'
WHERE c.code='PE0142' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-020');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '案例更新及时。', '2024-2025-1', 'approved', 'proto-r-021', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='林晓雯' AND t.department='会计学院'
WHERE c.code='ACC3108' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-021');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '模拟交易有趣。', '2024-2025-1', 'approved', 'proto-r-022', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='陈启明' AND t.department='金融学院'
WHERE c.code='FIN2306' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-022');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '公式多，要勤练。', '2023-2024-2', 'approved', 'proto-r-023', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='陈启明' AND t.department='金融学院'
WHERE c.code='FIN2306' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-023');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '与微观衔接好。', '2024-2025-1', 'approved', 'proto-r-024', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='王若舟' AND t.department='经济学院'
WHERE c.code='ECO2104' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-024');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '体系清晰。', '2024-2025-1', 'approved', 'proto-r-025', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='赵敏' AND t.department='法学院'
WHERE c.code='LAW2201' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-025');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, 'Python 上手友好。', '2024-2025-1', 'approved', 'proto-r-026', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='刘洋' AND t.department='信息管理学院'
WHERE c.code='MIS3102' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-026');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '项目作业实用。', '2024-2025-1', 'approved', 'proto-r-027', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='黄志远' AND t.department='统计学院'
WHERE c.code='STA2204' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-027');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 3, '小组报告压力大。', '2024-2025-1', 'approved', 'proto-r-028', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='吴桐' AND t.department='工商管理学院'
WHERE c.code='MGT3105' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-028');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '轻松有收获。', '2024-2025-1', 'approved', 'proto-r-029', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='吴桐' AND t.department='工商管理学院'
WHERE c.code='GEN0302' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-029');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '入门推荐。', '2023-2024-1', 'approved', 'proto-r-030', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='林晓雯' AND t.department='会计学院'
WHERE c.code='ACC1101' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-030');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '作业反馈快。', '2024-2025-1', 'approved', 'proto-r-031', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='林晓雯' AND t.department='会计学院'
WHERE c.code='ACC1101' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-031');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '适合低年级。', '2024-2025-1', 'approved', 'proto-r-032', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='陈启明' AND t.department='金融学院'
WHERE c.code='FIN1101' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-032');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '图示很多。', '2024-2025-1', 'approved', 'proto-r-033', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='王若舟' AND t.department='经济学院'
WHERE c.code='ECO1001' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-033');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 4, '阅读材料质量高。', '2024-2025-1', 'approved', 'proto-r-034', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='赵敏' AND t.department='法学院'
WHERE c.code='LAW1105' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-034');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 3, '内容偏基础。', '2024-2025-1', 'approved', 'proto-r-035', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='刘洋' AND t.department='信息管理学院'
WHERE c.code='MIS1101' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-035');

INSERT INTO reviews(course_id, teacher_id, category, overall, comment, term, status, submitter_hash, reviewed_at)
SELECT c.id, t.id, c.category, 5, '教练耐心。', '2024-2025-1', 'approved', 'proto-r-036', CURRENT_TIMESTAMP
FROM courses c JOIN teachers t ON t.name='周慧' AND t.department='体育部'
WHERE c.code='PE0160' AND NOT EXISTS (SELECT 1 FROM reviews WHERE submitter_hash='proto-r-036');
