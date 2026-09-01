-- Persist source-Relation PE specialization mapping and an unmapped umbrella queue.
-- Direct skill names backfill from catalog course names; umbrella names are never guessed.
CREATE TABLE catalog_relation_pe_specializations (
  course_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('umbrella', 'direct_skill')),
  normalized_specialization TEXT NOT NULL CHECK(length(trim(normalized_specialization)) > 0),
  display_semantics TEXT NOT NULL CHECK(display_semantics IN ('umbrella_prefixed', 'keep_source_name')),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  PRIMARY KEY(course_id, teacher_id),
  FOREIGN KEY(course_id, teacher_id) REFERENCES course_teachers(course_id, teacher_id) ON DELETE CASCADE,
  CHECK(
    (source_kind = 'umbrella' AND display_semantics = 'umbrella_prefixed')
    OR (source_kind = 'direct_skill' AND display_semantics = 'keep_source_name')
  )
);

CREATE TABLE catalog_pe_specialization_review_queue (
  course_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  course_code TEXT NOT NULL CHECK(length(trim(course_code)) > 0),
  course_name TEXT NOT NULL CHECK(length(trim(course_name)) > 0),
  source_teacher_label TEXT NOT NULL CHECK(length(trim(source_teacher_label)) > 0),
  reason TEXT NOT NULL CHECK(reason = 'umbrella_unmapped'),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(course_id, teacher_id),
  FOREIGN KEY(course_id, teacher_id) REFERENCES course_teachers(course_id, teacher_id) ON DELETE CASCADE
);

INSERT INTO catalog_relation_pe_specializations(
  course_id, teacher_id, source_kind, normalized_specialization, display_semantics, evidence_json
)
SELECT
  mapped.course_id,
  mapped.teacher_id,
  'direct_skill',
  mapped.normalized_specialization,
  'keep_source_name',
  json_object(
    'kind', 'catalog_course_name',
    'sourceCourseCode', mapped.course_code,
    'sourceCourseName', mapped.course_name,
    'sourceTeacherLabel', mapped.source_teacher_label,
    'rawSpecializationName', mapped.course_name
  )
FROM (
  SELECT
    ct.course_id,
    ct.teacher_id,
    c.code AS course_code,
    c.name AS course_name,
    t.source_teacher_label,
    CASE
      WHEN c.name = '健美操' OR c.name GLOB '健美操[0-9]*' OR c.name LIKE '健美操专项理论与实践%'
        OR c.name = '健身教练' OR c.name GLOB '健身教练[0-9]*' OR c.name LIKE '健身教练专项理论与实践%' THEN '健美操'
      WHEN c.name = '击剑' OR c.name GLOB '击剑[0-9]*' OR c.name LIKE '击剑专项理论与实践%' THEN '击剑'
      WHEN c.name = '篮球' OR c.name GLOB '篮球[0-9]*' OR c.name LIKE '篮球专项理论与实践%' THEN '篮球'
      WHEN c.name = '网球' OR c.name GLOB '网球[0-9]*' OR c.name LIKE '网球专项理论与实践%' THEN '网球'
      WHEN c.name = '羽毛球' OR c.name GLOB '羽毛球[0-9]*' OR c.name LIKE '羽毛球专项理论与实践%' THEN '羽毛球'
      WHEN c.name = '排球' OR c.name GLOB '排球[0-9]*' OR c.name LIKE '排球专项理论与实践%' THEN '排球'
      WHEN c.name = '乒乓球' OR c.name GLOB '乒乓球[0-9]*' OR c.name LIKE '乒乓球专项理论与实践%' THEN '乒乓球'
      WHEN c.name = '足球' OR c.name GLOB '足球[0-9]*' OR c.name LIKE '足球专项理论与实践%' THEN '足球'
      WHEN c.name = '瑜伽' OR c.name GLOB '瑜伽[0-9]*' OR c.name LIKE '瑜伽专项理论与实践%' THEN '瑜伽'
      WHEN c.name = '武术' OR c.name GLOB '武术[0-9]*' OR c.name LIKE '武术专项理论与实践%' THEN '武术'
      WHEN c.name = '体育舞蹈' OR c.name GLOB '体育舞蹈[0-9]*' OR c.name LIKE '体育舞蹈专项理论与实践%' THEN '体育舞蹈'
      WHEN c.name = '轮滑' OR c.name GLOB '轮滑[0-9]*' OR c.name LIKE '轮滑专项理论与实践%' THEN '轮滑'
      WHEN c.name = '散打' OR c.name GLOB '散打[0-9]*' OR c.name LIKE '散打专项理论与实践%' THEN '散打'
      ELSE NULL
    END AS normalized_specialization
  FROM course_teachers ct
  JOIN courses c ON c.id = ct.course_id
  JOIN teachers t ON t.id = ct.teacher_id
) mapped
WHERE mapped.normalized_specialization IS NOT NULL;

INSERT INTO catalog_pe_specialization_review_queue(
  course_id, teacher_id, course_code, course_name, source_teacher_label, reason, evidence_json
)
SELECT
  ct.course_id,
  ct.teacher_id,
  c.code,
  c.name,
  t.source_teacher_label,
  'umbrella_unmapped',
  json_object(
    'sourceCourseCode', c.code,
    'sourceCourseName', c.name,
    'sourceTeacherLabel', t.source_teacher_label,
    'sourceKind', 'umbrella'
  )
FROM course_teachers ct
JOIN courses c ON c.id = ct.course_id
JOIN teachers t ON t.id = ct.teacher_id
WHERE c.name IN (
  '体育1', '体育2', '体育3', '体育4',
  '体育Ⅰ（留）', '体育Ⅱ（留）', '体育I（留）', '体育II（留）',
  '大学体育1', '大学体育2', '大学体育3', '大学体育4',
  '大学体育I', '大学体育II', '大学体育III', '大学体育IV',
  '大学体育Ⅰ', '大学体育Ⅱ', '大学体育Ⅲ', '大学体育Ⅳ'
)
AND NOT EXISTS (
  SELECT 1
  FROM catalog_relation_pe_specializations mapped
  WHERE mapped.course_id = ct.course_id AND mapped.teacher_id = ct.teacher_id
);
