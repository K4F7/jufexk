-- “班会”不是可评价课程。首尾字符集与 course-catalog-policy.ts 的空白规范一致；
-- 内部空白不会被删除，因此“班 会”等非精确名称不受影响。
-- 受保护的评价引用会让本迁移明确失败，避免静默丢数据。
DELETE FROM courses
WHERE trim(name, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8203,8204,8205,8232,8233,8239,8287,8288,12288,65279)) = '班会';

CREATE TRIGGER reject_excluded_course_insert
BEFORE INSERT ON courses
WHEN trim(NEW.name, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8203,8204,8205,8232,8233,8239,8287,8288,12288,65279)) = '班会'
BEGIN
  SELECT RAISE(ABORT, 'excluded course name: 班会');
END;

CREATE TRIGGER reject_excluded_course_update
BEFORE UPDATE OF name ON courses
WHEN trim(NEW.name, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8203,8204,8205,8232,8233,8239,8287,8288,12288,65279)) = '班会'
BEGIN
  SELECT RAISE(ABORT, 'excluded course name: 班会');
END;
