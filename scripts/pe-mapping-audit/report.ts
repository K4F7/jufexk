import {
  PE_SKILL_FAMILIES,
  VIRTUAL_PE_SPORTS,
} from "../../src/lib/public-course-presentation";

export const PE_MAPPING_AUDIT_SCHEMA = "pe-mapping-audit/v1" as const;

export const PE_MAPPING_AUDIT_DATA_SCOPE =
  "生产 D1 数据库 jufexk（wrangler database_name=jufexk）中的 course_teachers 任课关系。预期体育来源 Relation 为课名经 peUmbrellaCourseNamePredicate（伞形课）或 peDirectSkillNormalizedSql / classifyPeSourceCourseName（直接专项）判定的行，与 #832 分类器相同。覆盖率 = 这些预期来源中已存在 catalog_relation_pe_specializations 映射的行数 / 预期来源行数。人工复核队列为 catalog_pe_specialization_review_queue（现存行即为未处理集合）。审计只读 SELECT/WITH，不读取评价正文、Cookie、CAS 凭据或学生身份。";

export const PE_MAPPING_AUDIT_COVERAGE_DEFINITION =
  "分子：预期体育来源 Relation 中已有 catalog_relation_pe_specializations 行的数量。分母：course_teachers 中课名分类为 umbrella 或 direct_skill 的数量。";

export const PE_MAPPING_AUDIT_QUEUE_DEFINITION =
  "catalog_pe_specialization_review_queue 无 processed 标记；表中现存行即为未处理记录。staleMapped 为同时存在映射的队列行。";

export type PeMappingAuditSourceKind = "umbrella" | "direct_skill";

export type PeMappingAuditRelationRef = {
  courseId: number;
  teacherId: number;
  courseCode: string;
  courseName: string;
  sourceTeacherLabel: string;
  sourceKind: PeMappingAuditSourceKind;
};

export type PeMappingAuditExpectedRow = PeMappingAuditRelationRef & {
  expectedFamily: string | null;
  mappedSpecialization: string | null;
  mappedSourceKind: PeMappingAuditSourceKind | null;
  isMapped: boolean;
  inQueue: boolean;
  queueReason: string | null;
  virtualSportLabel: string | null;
  virtualCourseId: number | null;
};

export type PeMappingAuditQueueRow = {
  courseId: number;
  teacherId: number;
  courseCode: string;
  courseName: string;
  sourceTeacherLabel: string;
  reason: string;
};

export type PeMappingAuditSpecializationCount = {
  normalizedSpecialization: string;
  mapped: number;
  expectedDirectSkill: number;
  unmappedExpected: number;
};

export type PeMappingAuditFocusRow = PeMappingAuditRelationRef & {
  isMapped: boolean;
  expectedFamily: string | null;
  mappedSpecialization: string | null;
  virtualSportLabel: string | null;
  virtualCourseId: number | null;
};

export type PeMappingAuditFocus = {
  label: string;
  mapped: number;
  unmappedExpected: number;
  virtualTeacherUnmapped: number;
  rows: PeMappingAuditFocusRow[];
};

export type PeMappingAuditCoverage = {
  numerator: number;
  denominator: number;
  rate: number;
  percent: string;
  mappingTableRows: number;
  extraMappings: number;
  definition: string;
};

export type PeMappingAuditReport = {
  schemaVersion: typeof PE_MAPPING_AUDIT_SCHEMA;
  auditedAt: string;
  deploySha: string;
  workerVersionId: string | null;
  dataScope: string;
  readOnly: true;
  coverage: PeMappingAuditCoverage;
  specializations: PeMappingAuditSpecializationCount[];
  yoga: PeMappingAuditFocus;
  wushu: PeMappingAuditFocus;
  queue: {
    total: number;
    unprocessed: number;
    staleMapped: number;
    orphanNotExpected: number;
    definition: string;
  };
  status: {
    allExpectedMapped: boolean;
    unmappedUmbrellaAllQueued: boolean;
    noUntrackedGaps: boolean;
    queueEmpty: boolean;
  };
  unmappedExpectedSources: PeMappingAuditRelationRef[];
  unmappedUmbrellaMissingQueue: PeMappingAuditRelationRef[];
  gapsNeitherMappingNorQueue: PeMappingAuditRelationRef[];
  unmappedVirtualPeSports: Array<
    PeMappingAuditRelationRef & {
      virtualSportLabel: string;
      virtualCourseId: number;
    }
  >;
};

export type PeMappingAuditMeta = {
  auditedAt: string;
  deploySha: string;
  workerVersionId?: string | null;
  dataScope?: string;
};

function asInt(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) throw new Error(`invalid integer ${field}: ${String(value)}`);
  return n;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`invalid string ${field}: ${String(value)}`);
  }
  return value;
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.length ? text : null;
}

function asFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function asSourceKind(value: unknown, field: string): PeMappingAuditSourceKind {
  if (value === "umbrella" || value === "direct_skill") return value;
  throw new Error(`invalid ${field}: ${String(value)}`);
}

function asNullableSourceKind(value: unknown): PeMappingAuditSourceKind | null {
  if (value == null || value === "") return null;
  return asSourceKind(value, "mapped_source_kind");
}

function relationKey(row: { courseId: number; teacherId: number }): string {
  return `${row.courseId}:${row.teacherId}`;
}

function sortRefs<T extends PeMappingAuditRelationRef>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const code = left.courseCode.localeCompare(right.courseCode, "zh");
    if (code) return code;
    const teacher = left.sourceTeacherLabel.localeCompare(right.sourceTeacherLabel, "zh");
    if (teacher) return teacher;
    return left.courseId - right.courseId || left.teacherId - right.teacherId;
  });
}

function toRef(row: PeMappingAuditExpectedRow): PeMappingAuditRelationRef {
  return {
    courseId: row.courseId,
    teacherId: row.teacherId,
    courseCode: row.courseCode,
    courseName: row.courseName,
    sourceTeacherLabel: row.sourceTeacherLabel,
    sourceKind: row.sourceKind,
  };
}

export function coverageRate(numerator: number, denominator: number): {
  rate: number;
  percent: string;
} {
  const rate = denominator === 0 ? 0 : numerator / denominator;
  return { rate, percent: `${(rate * 100).toFixed(2)}%` };
}

export function parseExpectedPeSourceRow(
  row: Record<string, unknown>,
): PeMappingAuditExpectedRow {
  const virtualCourseIdRaw = row.virtual_course_id;
  return {
    courseId: asInt(row.course_id, "course_id"),
    teacherId: asInt(row.teacher_id, "teacher_id"),
    courseCode: asString(row.course_code, "course_code"),
    courseName: asString(row.course_name, "course_name"),
    sourceTeacherLabel: asString(row.source_teacher_label, "source_teacher_label"),
    sourceKind: asSourceKind(row.source_kind, "source_kind"),
    expectedFamily: asNullableString(row.expected_family),
    mappedSpecialization: asNullableString(row.mapped_specialization),
    mappedSourceKind: asNullableSourceKind(row.mapped_source_kind),
    isMapped: asFlag(row.is_mapped),
    inQueue: asFlag(row.in_queue),
    queueReason: asNullableString(row.queue_reason),
    virtualSportLabel: asNullableString(row.virtual_sport_label),
    virtualCourseId:
      virtualCourseIdRaw == null || virtualCourseIdRaw === ""
        ? null
        : asInt(virtualCourseIdRaw, "virtual_course_id"),
  };
}

export function parseReviewQueueRow(
  row: Record<string, unknown>,
): PeMappingAuditQueueRow {
  return {
    courseId: asInt(row.course_id, "course_id"),
    teacherId: asInt(row.teacher_id, "teacher_id"),
    courseCode: asString(row.course_code, "course_code"),
    courseName: asString(row.course_name, "course_name"),
    sourceTeacherLabel: asString(row.source_teacher_label, "source_teacher_label"),
    reason: asString(row.reason, "reason"),
  };
}

export function parseMappingRowCount(rows: Array<Record<string, unknown>>): number {
  const row = rows[0];
  if (!row) return 0;
  return asInt(row.mapping_rows, "mapping_rows");
}

function relatedToLabel(row: PeMappingAuditExpectedRow, label: string): boolean {
  return (
    row.expectedFamily === label ||
    row.mappedSpecialization === label ||
    row.virtualSportLabel === label
  );
}

function buildFocus(
  label: string,
  expectedRows: PeMappingAuditExpectedRow[],
): PeMappingAuditFocus {
  const rows = sortRefs(
    expectedRows.filter((row) => relatedToLabel(row, label)).map((row) => ({
      ...toRef(row),
      isMapped: row.isMapped,
      expectedFamily: row.expectedFamily,
      mappedSpecialization: row.mappedSpecialization,
      virtualSportLabel: row.virtualSportLabel,
      virtualCourseId: row.virtualCourseId,
    })),
  );
  return {
    label,
    mapped: expectedRows.filter(
      (row) => row.isMapped && row.mappedSpecialization === label,
    ).length,
    unmappedExpected: expectedRows.filter(
      (row) =>
        !row.isMapped &&
        (row.expectedFamily === label || row.virtualSportLabel === label),
    ).length,
    virtualTeacherUnmapped: expectedRows.filter(
      (row) => !row.isMapped && row.virtualSportLabel === label,
    ).length,
    rows,
  };
}

function specializationCounts(
  expectedRows: PeMappingAuditExpectedRow[],
): PeMappingAuditSpecializationCount[] {
  const labels = [
    ...PE_SKILL_FAMILIES.map((family) => family.label),
    ...[...new Set(
      expectedRows
        .map((row) => row.mappedSpecialization)
        .filter((label): label is string => Boolean(label)),
    )].filter(
      (label) => !PE_SKILL_FAMILIES.some((family) => family.label === label),
    ).sort((left, right) => left.localeCompare(right, "zh")),
  ];
  return labels.map((label) => ({
    normalizedSpecialization: label,
    mapped: expectedRows.filter(
      (row) => row.isMapped && row.mappedSpecialization === label,
    ).length,
    expectedDirectSkill: expectedRows.filter((row) => row.expectedFamily === label)
      .length,
    unmappedExpected: expectedRows.filter(
      (row) =>
        !row.isMapped &&
        (row.expectedFamily === label || row.virtualSportLabel === label),
    ).length,
  }));
}

export function buildPeMappingAuditReport(input: {
  expectedRows: Array<Record<string, unknown>>;
  queueRows: Array<Record<string, unknown>>;
  mappingRows: number;
  meta: PeMappingAuditMeta;
}): PeMappingAuditReport {
  const expectedRows = input.expectedRows.map(parseExpectedPeSourceRow);
  const queueRows = input.queueRows.map(parseReviewQueueRow);
  const expectedKeys = new Set(expectedRows.map(relationKey));
  const mappedExpected = expectedRows.filter((row) => row.isMapped);
  const unmappedExpected = expectedRows.filter((row) => !row.isMapped);
  const { rate, percent } = coverageRate(
    mappedExpected.length,
    expectedRows.length,
  );
  const staleMapped = queueRows.filter((row) => {
    const expected = expectedRows.find(
      (item) => item.courseId === row.courseId && item.teacherId === row.teacherId,
    );
    return expected?.isMapped === true;
  }).length;
  const orphanNotExpected = queueRows.filter(
    (row) => !expectedKeys.has(relationKey(row)),
  ).length;
  const unmappedUmbrellaMissingQueue = unmappedExpected.filter(
    (row) => row.sourceKind === "umbrella" && !row.inQueue,
  );
  const gapsNeitherMappingNorQueue = unmappedExpected.filter((row) => !row.inQueue);
  const unmappedVirtualPeSports = unmappedExpected.filter(
    (row) => row.virtualSportLabel && row.virtualCourseId != null,
  ) as Array<PeMappingAuditExpectedRow & { virtualSportLabel: string; virtualCourseId: number }>;

  return {
    schemaVersion: PE_MAPPING_AUDIT_SCHEMA,
    auditedAt: input.meta.auditedAt,
    deploySha: input.meta.deploySha,
    workerVersionId: input.meta.workerVersionId ?? null,
    dataScope: input.meta.dataScope ?? PE_MAPPING_AUDIT_DATA_SCOPE,
    readOnly: true,
    coverage: {
      numerator: mappedExpected.length,
      denominator: expectedRows.length,
      rate,
      percent,
      mappingTableRows: input.mappingRows,
      extraMappings: Math.max(0, input.mappingRows - mappedExpected.length),
      definition: PE_MAPPING_AUDIT_COVERAGE_DEFINITION,
    },
    specializations: specializationCounts(expectedRows),
    yoga: buildFocus("瑜伽", expectedRows),
    wushu: buildFocus("武术", expectedRows),
    queue: {
      total: queueRows.length,
      unprocessed: queueRows.length,
      staleMapped,
      orphanNotExpected,
      definition: PE_MAPPING_AUDIT_QUEUE_DEFINITION,
    },
    status: {
      allExpectedMapped: mappedExpected.length === expectedRows.length,
      unmappedUmbrellaAllQueued: unmappedUmbrellaMissingQueue.length === 0,
      noUntrackedGaps: gapsNeitherMappingNorQueue.length === 0,
      queueEmpty: queueRows.length === 0,
    },
    unmappedExpectedSources: sortRefs(unmappedExpected.map(toRef)),
    unmappedUmbrellaMissingQueue: sortRefs(unmappedUmbrellaMissingQueue.map(toRef)),
    gapsNeitherMappingNorQueue: sortRefs(gapsNeitherMappingNorQueue.map(toRef)),
    unmappedVirtualPeSports: sortRefs(
      unmappedVirtualPeSports.map((row) => ({
        ...toRef(row),
        virtualSportLabel: row.virtualSportLabel,
        virtualCourseId: row.virtualCourseId,
      })),
    ),
  };
}

function formatRef(row: PeMappingAuditRelationRef): string {
  return `${row.courseCode} / ${row.courseName} / ${row.sourceTeacherLabel} / ${row.sourceKind}`;
}

function formatList(rows: PeMappingAuditRelationRef[]): string {
  if (!rows.length) return "- （无）";
  return rows.map((row) => `- ${formatRef(row)}`).join("\n");
}

function formatFocus(focus: PeMappingAuditFocus): string {
  const lines = [
    `- 已映射: ${focus.mapped}`,
    `- 未映射预期来源: ${focus.unmappedExpected}`,
    `- 未映射 VIRTUAL_PE_SPORTS 教师来源: ${focus.virtualTeacherUnmapped}`,
    "",
    "行：",
  ];
  if (!focus.rows.length) {
    lines.push("- （无）");
    return lines.join("\n");
  }
  for (const row of focus.rows) {
    const mapped = row.isMapped
      ? `mapped:${row.mappedSpecialization ?? "?"}`
      : "unmapped";
    const virtual = row.virtualSportLabel
      ? ` virtual:${row.virtualSportLabel}`
      : "";
    lines.push(`- ${formatRef(row)} / ${mapped}${virtual}`);
  }
  return lines.join("\n");
}

export function formatPeMappingAuditMarkdown(report: PeMappingAuditReport): string {
  const specializationRows = report.specializations
    .map(
      (item) =>
        `| ${item.normalizedSpecialization} | ${item.mapped} | ${item.expectedDirectSkill} | ${item.unmappedExpected} |`,
    )
    .join("\n");
  return [
    "# 生产体育专项映射覆盖审计",
    "",
    `- 审计时间: ${report.auditedAt}`,
    `- 部署 SHA: ${report.deploySha}`,
    `- Worker version: ${report.workerVersionId ?? "（未取得）"}`,
    `- 只读: ${report.readOnly ? "是" : "否"}`,
    `- schema: ${report.schemaVersion}`,
    "",
    "## 数据范围",
    "",
    report.dataScope,
    "",
    "## 覆盖率",
    "",
    `- 已映射 / 预期来源: ${report.coverage.numerator} / ${report.coverage.denominator}`,
    `- 覆盖率: ${report.coverage.percent}`,
    `- mapping 表行数: ${report.coverage.mappingTableRows}`,
    `- 非预期来源的额外 mapping: ${report.coverage.extraMappings}`,
    `- 全部预期来源已映射: ${report.status.allExpectedMapped ? "是" : "否"}`,
    "",
    report.coverage.definition,
    "",
    "## 专项分布",
    "",
    "| 专项 | 已映射 | 预期 direct_skill | 未映射预期 |",
    "| --- | ---: | ---: | ---: |",
    specializationRows,
    "",
    "## 瑜伽",
    "",
    formatFocus(report.yoga),
    "",
    "## 武术",
    "",
    formatFocus(report.wushu),
    "",
    "## 人工复核队列",
    "",
    `- 队列总行数: ${report.queue.total}`,
    `- 未处理: ${report.queue.unprocessed}`,
    `- 已映射仍在队列: ${report.queue.staleMapped}`,
    `- 非预期来源队列行: ${report.queue.orphanNotExpected}`,
    `- 队列为空: ${report.status.queueEmpty ? "是" : "否"}`,
    "",
    report.queue.definition,
    "",
    "## 未映射预期来源",
    "",
    formatList(report.unmappedExpectedSources),
    "",
    "## 未映射伞形课未入队列",
    "",
    formatList(report.unmappedUmbrellaMissingQueue),
    "",
    "## 既无映射也无队列（缺口）",
    "",
    formatList(report.gapsNeitherMappingNorQueue),
    "",
    "## 未映射 VIRTUAL_PE_SPORTS 来源",
    "",
    report.unmappedVirtualPeSports.length
      ? report.unmappedVirtualPeSports
          .map(
            (row) =>
              `- ${formatRef(row)} / ${row.virtualSportLabel} / ${row.virtualCourseId}`,
          )
          .join("\n")
      : "- （无）",
    "",
    `VIRTUAL_PE_SPORTS 教师：${VIRTUAL_PE_SPORTS.map((sport) => `${sport.teacherNames.join("、")}/${sport.label}`).join("；")}`,
    "",
  ].join("\n");
}
