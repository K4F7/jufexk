DELETE FROM course_teachers
WHERE course_id IN (
  SELECT id FROM courses
  WHERE (code='CS101' AND name='程序设计基础') OR (code='PE012' AND name='羽毛球')
)
AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.course_id=course_teachers.course_id);

DELETE FROM courses
WHERE ((code='CS101' AND name='程序设计基础') OR (code='PE012' AND name='羽毛球'))
AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.course_id=courses.id);

DELETE FROM teachers
WHERE name='林老师' AND department='计算机学院'
AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.teacher_id=teachers.id)
AND NOT EXISTS (SELECT 1 FROM course_teachers ct WHERE ct.teacher_id=teachers.id);
