-- Upgrade-safe backfill: map catalog direct-skill Relations for expanded
-- PE families (跆拳道 / 游泳 / 田径 and existing families). INSERT OR IGNORE
-- does not rewrite historical umbrella mappings.
INSERT OR IGNORE INTO catalog_relation_pe_specializations(
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
      WHEN c.name = '跆拳道' OR c.name GLOB '跆拳道[0-9]*' OR c.name LIKE '跆拳道专项理论与实践%' THEN '跆拳道'
      WHEN c.name = '游泳' OR c.name GLOB '游泳[0-9]*' OR c.name LIKE '游泳专项理论与实践%' THEN '游泳'
      WHEN c.name = '田径' OR c.name GLOB '田径[0-9]*' OR c.name LIKE '田径专项理论与实践%' THEN '田径'
      ELSE NULL
    END AS normalized_specialization
  FROM course_teachers ct
  JOIN courses c ON c.id = ct.course_id
  JOIN teachers t ON t.id = ct.teacher_id
) mapped
WHERE mapped.normalized_specialization IS NOT NULL;
