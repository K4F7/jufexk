import {
  buildPeSpecializationMapping,
  catalogAdditionPeRequirement,
  normalizeConfirmedPeSpecialization,
  type RelationPeEvidenceKind,
  type RelationPeSpecializationMapping,
} from "./pe-specialization-mapping";
import {
  formatVenueSkillCounts,
  majorityVenueSkill,
  VENUE_SKILL_MAJORITY_THRESHOLD,
} from "./pe-venue-evidence";
import {
  isUmbrellaPeCourseName,
  publicPeSkillLabel,
  VIRTUAL_PE_SPORTS,
} from "./public-course-presentation";

export const PE_QUEUE_DISPOSITIONS = [
  "mapped",
  "withheld_permanent_exception",
  "conflict_recapture",
] as const;

export const HISTORICAL_WITHHOLD_REASON =
  "no explicit specialization evidence at historical closeout";

export const HISTORICAL_CLOSEOUT_ACTOR = "historical-closeout-#852";

export const FAMILY_EXPANSION_CLOSEOUT_ACTOR = "historical-closeout-#860";

export const VENUE_EVIDENCE_CLOSEOUT_ACTOR = "historical-closeout-#862";

export const MIXED_VENUE_WITHHOLD_REASON = `umbrella venues below ${Math.round(VENUE_SKILL_MAJORITY_THRESHOLD * 100)}% unique skill`;

export const NO_VENUE_SKILL_WITHHOLD_REASON = "no unique venue skill evidence";

/** Named skill courses stay public; these umbrellas cannot be attributed. */
export const UMBRELLA_UNATTRIBUTABLE_MULTI_SKILL_TEACHERS = ["张晓英"] as const;

export const UMBRELLA_UNATTRIBUTABLE_MULTI_SKILL_REASON =
  "umbrella offerings cannot be attributed when the teacher has two skill courses";

export const PE_QUEUE_CLOSEOUT_REPORT_SCHEMA = "pe-queue-closeout-report/v1" as const;

export type PeQueueDisposition = (typeof PE_QUEUE_DISPOSITIONS)[number];

export type PeCloseoutEvidenceKind =
  | RelationPeEvidenceKind
  | "existing_mapping"
  | "no_explicit_specialization_evidence"
  | "conflicting_specialization_evidence";

export type PeCloseoutEvidenceItem = {
  kind: PeCloseoutEvidenceKind;
  specialization: string;
  sourceCourseCode: string;
  sourceCourseName: string;
  sourceTeacherLabel: string;
};

export type PeQueueRow = {
  courseId: number;
  teacherId: number;
  courseCode: string;
  courseName: string;
  sourceTeacherLabel: string;
  reason: string;
  disposition: PeQueueDisposition | null;
  dispositionReason: string;
  disposedBy: string;
  disposedAt: string | null;
};

export type ProposedPeDisposition = {
  courseId: number;
  teacherId: number;
  courseCode: string;
  courseName: string;
  sourceTeacherLabel: string;
  disposition: PeQueueDisposition;
  currentDisposition: PeQueueDisposition | null;
  currentReason: string;
  currentSpecialization: string | null;
  specialization: string | null;
  reason: string;
  evidence: PeCloseoutEvidenceItem[];
  mapping: RelationPeSpecializationMapping | null;
};

export type PeQueueCloseoutCounts = {
  mapped: number;
  withheld: number;
  conflict: number;
  open: number;
};

export type PeQueueCloseoutReportItem = {
  courseCode: string;
  courseName: string;
  sourceTeacherLabel: string;
  disposition: PeQueueDisposition | "open";
  specialization: string | null;
  reason: string;
};

export type PeQueueCloseoutReport = {
  schemaVersion: typeof PE_QUEUE_CLOSEOUT_REPORT_SCHEMA;
  generatedAt: string;
  liveEnqueueEnabled: boolean;
  counts: PeQueueCloseoutCounts;
  allDisposed: boolean;
  items: PeQueueCloseoutReportItem[];
};

export function isPeQueueDisposition(value: unknown): value is PeQueueDisposition {
  return (
    typeof value === "string" &&
    (PE_QUEUE_DISPOSITIONS as readonly string[]).includes(value)
  );
}

export function parsePeQueueDisposition(value: unknown): PeQueueDisposition | null {
  if (value == null || value === "") return null;
  return isPeQueueDisposition(value) ? value : null;
}

export function isRedisposablePeQueueDisposition(
  value: PeQueueDisposition | null,
): boolean {
  return value !== "mapped";
}

export function isUmbrellaUnattributableMultiSkillTeacher(
  label?: string | null,
): boolean {
  const trimmed = label?.trim() ?? "";
  return (UMBRELLA_UNATTRIBUTABLE_MULTI_SKILL_TEACHERS as readonly string[]).includes(
    trimmed,
  );
}

export function umbrellaUnattributableReason(skills: string[]): string {
  const labels = [...new Set(skills.filter(Boolean))];
  return labels.length
    ? `${UMBRELLA_UNATTRIBUTABLE_MULTI_SKILL_REASON}: ${labels.join("、")}`
    : UMBRELLA_UNATTRIBUTABLE_MULTI_SKILL_REASON;
}

export function virtualPeSportForTeacherLabel(label?: string | null) {
  const trimmed = label?.trim() ?? "";
  if (!trimmed) return null;
  return (
    VIRTUAL_PE_SPORTS.find((sport) =>
      (sport.teacherNames as readonly string[]).includes(trimmed),
    ) ?? null
  );
}

export function uniqueSpecializations(items: PeCloseoutEvidenceItem[]): string[] {
  return [...new Set(items.map((item) => item.specialization).filter(Boolean))];
}

function mappingEvidenceKind(
  kind: PeCloseoutEvidenceKind,
): RelationPeEvidenceKind {
  if (kind === "catalog_course_name") return "catalog_course_name";
  if (kind === "virtual_pe_sports") return "virtual_pe_sports";
  if (kind === "historical_visible_binding") return "historical_visible_binding";
  if (kind === "offering_skill_name") return "offering_skill_name";
  if (kind === "inventory_venue") return "inventory_venue";
  return "human_decision";
}

export function mappingFromCloseoutEvidence(input: {
  row: Pick<
    PeQueueRow,
    "courseCode" | "courseName" | "sourceTeacherLabel"
  >;
  specialization: string;
  evidence: PeCloseoutEvidenceItem;
}): RelationPeSpecializationMapping {
  return buildPeSpecializationMapping({
    sourceKind: "umbrella",
    normalizedSpecialization: input.specialization,
    evidenceKind: mappingEvidenceKind(input.evidence.kind),
    sourceCourseCode: input.evidence.sourceCourseCode || input.row.courseCode,
    sourceCourseName: input.evidence.sourceCourseName || input.row.courseName,
    sourceTeacherLabel:
      input.evidence.sourceTeacherLabel || input.row.sourceTeacherLabel,
    rawSpecializationName: input.specialization,
  });
}

function proposedBase(
  row: PeQueueRow,
  currentSpecialization: string | null = null,
): Pick<
  ProposedPeDisposition,
  | "courseId"
  | "teacherId"
  | "courseCode"
  | "courseName"
  | "sourceTeacherLabel"
  | "currentDisposition"
  | "currentReason"
  | "currentSpecialization"
> {
  return {
    courseId: row.courseId,
    teacherId: row.teacherId,
    courseCode: row.courseCode,
    courseName: row.courseName,
    sourceTeacherLabel: row.sourceTeacherLabel,
    currentDisposition: row.disposition,
    currentReason: row.dispositionReason,
    currentSpecialization,
  };
}

function proposeUmbrellaVenueDisposition(input: {
  row: PeQueueRow;
  venueSkillCounts: Record<string, number>;
  currentSpecialization?: string | null;
}): ProposedPeDisposition {
  const base = proposedBase(input.row, input.currentSpecialization ?? null);
  const majority = majorityVenueSkill(input.venueSkillCounts);
  if (majority) {
    const evidence: PeCloseoutEvidenceItem = {
      kind: "inventory_venue",
      specialization: majority.skill,
      sourceCourseCode: input.row.courseCode,
      sourceCourseName: input.row.courseName,
      sourceTeacherLabel: input.row.sourceTeacherLabel,
    };
    return {
      ...base,
      disposition: "mapped",
      specialization: majority.skill,
      reason: `inventory_venue:${majority.skill} (${majority.count}/${majority.total})`,
      evidence: [evidence],
      mapping: mappingFromCloseoutEvidence({
        row: input.row,
        specialization: majority.skill,
        evidence,
      }),
    };
  }
  const counts = formatVenueSkillCounts(input.venueSkillCounts);
  return {
    ...base,
    disposition: "withheld_permanent_exception",
    specialization: null,
    reason: counts
      ? `${MIXED_VENUE_WITHHOLD_REASON}: ${counts}`
      : NO_VENUE_SKILL_WITHHOLD_REASON,
    evidence: [
      {
        kind: "no_explicit_specialization_evidence",
        specialization: "",
        sourceCourseCode: input.row.courseCode,
        sourceCourseName: input.row.courseName,
        sourceTeacherLabel: input.row.sourceTeacherLabel,
      },
    ],
    mapping: null,
  };
}

export function proposeHistoricalDisposition(input: {
  row: PeQueueRow;
  evidence: PeCloseoutEvidenceItem[];
  venueSkillCounts?: Record<string, number>;
  currentSpecialization?: string | null;
}): ProposedPeDisposition {
  if (
    isUmbrellaPeCourseName(input.row.courseName) &&
    input.venueSkillCounts !== undefined
  ) {
    return proposeUmbrellaVenueDisposition({
      row: input.row,
      venueSkillCounts: input.venueSkillCounts,
      currentSpecialization: input.currentSpecialization,
    });
  }
  const existing = input.evidence.filter(
    (item) => item.kind === "existing_mapping",
  );
  const rest = input.evidence.filter((item) => item.kind !== "existing_mapping");
  const chosen = existing.length ? existing : rest;
  const specializations = uniqueSpecializations(chosen);
  const base = proposedBase(input.row, input.currentSpecialization ?? null);
  if (
    isUmbrellaPeCourseName(input.row.courseName) &&
    isUmbrellaUnattributableMultiSkillTeacher(input.row.sourceTeacherLabel)
  ) {
    const skills = uniqueSpecializations(rest.length ? rest : chosen);
    return {
      ...base,
      disposition: "withheld_permanent_exception",
      specialization: null,
      reason: umbrellaUnattributableReason(skills),
      evidence: chosen.length ? chosen : rest,
      mapping: null,
    };
  }
  if (specializations.length === 1) {
    const specialization = specializations[0];
    const evidence = chosen.filter((item) => item.specialization === specialization);
    const primary = evidence[0];
    return {
      ...base,
      disposition: "mapped",
      specialization,
      reason: `${primary.kind}:${specialization}`,
      evidence,
      mapping: mappingFromCloseoutEvidence({
        row: input.row,
        specialization,
        evidence: primary,
      }),
    };
  }
  if (specializations.length > 1) {
    return {
      ...base,
      disposition: "conflict_recapture",
      specialization: null,
      reason: `conflicting specialization evidence: ${specializations.join("、")}`,
      evidence: chosen,
      mapping: null,
    };
  }
  return {
    ...base,
    disposition: "withheld_permanent_exception",
    specialization: null,
    reason: HISTORICAL_WITHHOLD_REASON,
    evidence: [
      {
        kind: "no_explicit_specialization_evidence",
        specialization: "",
        sourceCourseCode: input.row.courseCode,
        sourceCourseName: input.row.courseName,
        sourceTeacherLabel: input.row.sourceTeacherLabel,
      },
    ],
    mapping: null,
  };
}

export function isNoOpCloseoutProposal(
  proposal: ProposedPeDisposition,
  options?: { rewriteMappedUmbrellas?: boolean },
): boolean {
  if (proposal.currentDisposition === "mapped" && !options?.rewriteMappedUmbrellas) {
    return true;
  }
  if (
    options?.rewriteMappedUmbrellas &&
    proposal.currentDisposition === "mapped" &&
    proposal.disposition === "mapped" &&
    proposal.currentSpecialization === proposal.specialization
  ) {
    return true;
  }
  return (
    proposal.currentDisposition === proposal.disposition &&
    proposal.currentReason === proposal.reason
  );
}

export function collectRowEvidence(input: {
  row: PeQueueRow;
  existingMappings: PeCloseoutEvidenceItem[];
  siblingMappings: PeCloseoutEvidenceItem[];
  historicalBindings: PeCloseoutEvidenceItem[];
  offeringSkills: PeCloseoutEvidenceItem[];
}): PeCloseoutEvidenceItem[] {
  const evidence: PeCloseoutEvidenceItem[] = [];
  const own = input.existingMappings.filter(
    (item) =>
      item.sourceCourseCode === input.row.courseCode &&
      item.sourceTeacherLabel === input.row.sourceTeacherLabel,
  );
  evidence.push(...own);
  const virtual = virtualPeSportForTeacherLabel(input.row.sourceTeacherLabel);
  if (virtual) {
    evidence.push({
      kind: "virtual_pe_sports",
      specialization: virtual.label,
      sourceCourseCode: input.row.courseCode,
      sourceCourseName: input.row.courseName,
      sourceTeacherLabel: input.row.sourceTeacherLabel,
    });
  }
  const sameTeacher = (item: PeCloseoutEvidenceItem) =>
    item.sourceTeacherLabel === input.row.sourceTeacherLabel;
  evidence.push(...input.historicalBindings.filter(sameTeacher));
  evidence.push(...input.offeringSkills.filter(sameTeacher));
  const siblings = input.siblingMappings.filter(sameTeacher);
  const siblingSpecs = uniqueSpecializations(siblings);
  if (siblingSpecs.length === 1) evidence.push(...siblings);
  else if (siblingSpecs.length > 1) evidence.push(...siblings);
  return evidence;
}

export function catalogAdditionMapping(input: {
  kind: string;
  courseCode: string;
  courseName: string;
  sourceTeacherLabel: string;
  peSpecialization?: string | null;
}):
  | { ok: true; mapping: RelationPeSpecializationMapping | null }
  | { ok: false; error: string } {
  const requirement = catalogAdditionPeRequirement({
    kind: input.kind,
    courseName: input.courseName,
  });
  if (requirement.kind === "none") {
    return { ok: true, mapping: null };
  }
  if (!input.courseCode || !input.sourceTeacherLabel) {
    return { ok: false, error: "体育课补充申请必须同时填写课号和来源教师名" };
  }
  if (requirement.kind === "direct_skill") {
    return {
      ok: true,
      mapping: buildPeSpecializationMapping({
        sourceKind: "direct_skill",
        normalizedSpecialization: requirement.specialization,
        evidenceKind: "catalog_course_name",
        sourceCourseCode: input.courseCode,
        sourceCourseName: input.courseName,
        sourceTeacherLabel: input.sourceTeacherLabel,
        rawSpecializationName: input.courseName,
      }),
    };
  }
  const specialization = normalizeConfirmedPeSpecialization(input.peSpecialization);
  if (!specialization) {
    return { ok: false, error: "体育伞形课必须指定归一化具体专项名" };
  }
  return {
    ok: true,
    mapping: buildPeSpecializationMapping({
      sourceKind: "umbrella",
      normalizedSpecialization: specialization,
      evidenceKind: "human_decision",
      sourceCourseCode: input.courseCode,
      sourceCourseName: input.courseName,
      sourceTeacherLabel: input.sourceTeacherLabel,
      rawSpecializationName: input.peSpecialization?.trim() || specialization,
    }),
  };
}

export function emptyCloseoutCounts(): PeQueueCloseoutCounts {
  return { mapped: 0, withheld: 0, conflict: 0, open: 0 };
}

export function countCloseoutRows(
  rows: Array<{ disposition: PeQueueDisposition | null }>,
): PeQueueCloseoutCounts {
  const counts = emptyCloseoutCounts();
  for (const row of rows) {
    if (row.disposition === "mapped") counts.mapped += 1;
    else if (row.disposition === "withheld_permanent_exception") counts.withheld += 1;
    else if (row.disposition === "conflict_recapture") counts.conflict += 1;
    else counts.open += 1;
  }
  return counts;
}

export function sanitizeCloseoutReportItem(input: {
  courseCode: string;
  courseName: string;
  sourceTeacherLabel: string;
  disposition: PeQueueDisposition | null;
  specialization?: string | null;
  reason: string;
}): PeQueueCloseoutReportItem {
  return {
    courseCode: input.courseCode,
    courseName: input.courseName,
    sourceTeacherLabel: input.sourceTeacherLabel,
    disposition: input.disposition ?? "open",
    specialization: input.specialization ?? null,
    reason: input.reason,
  };
}

export function buildPeQueueCloseoutReport(input: {
  generatedAt: string;
  liveEnqueueEnabled: boolean;
  rows: Array<{
    courseCode: string;
    courseName: string;
    sourceTeacherLabel: string;
    disposition: PeQueueDisposition | null;
    specialization?: string | null;
    reason: string;
  }>;
}): PeQueueCloseoutReport {
  const counts = countCloseoutRows(input.rows);
  return {
    schemaVersion: PE_QUEUE_CLOSEOUT_REPORT_SCHEMA,
    generatedAt: input.generatedAt,
    liveEnqueueEnabled: input.liveEnqueueEnabled,
    counts,
    allDisposed: counts.open === 0,
    items: input.rows.map((row) => sanitizeCloseoutReportItem(row)),
  };
}

export function formatPeQueueCloseoutMarkdown(report: PeQueueCloseoutReport): string {
  const lines = [
    "# 体育专项历史队列收口报告",
    "",
    `- 生成时间: ${report.generatedAt}`,
    `- schema: ${report.schemaVersion}`,
    `- 长期队列已冻结: ${report.liveEnqueueEnabled ? "否" : "是"}`,
    `- 已映射: ${report.counts.mapped}`,
    `- 暂不公开: ${report.counts.withheld}`,
    `- 冲突待重采: ${report.counts.conflict}`,
    `- 未处置: ${report.counts.open}`,
    `- 100% 已处置: ${report.allDisposed && report.counts.open === 0 ? "是" : "否"}`,
    "",
    "本报告不含 Cookie、CAS 凭据、学生身份或投稿正文。",
    "",
    "| 课号 | 课名 | 来源教师名 | 处置 | 专项 / 原因 |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const item of report.items) {
    const detail =
      item.disposition === "mapped"
        ? item.specialization ?? ""
        : item.reason;
    lines.push(
      `| ${item.courseCode} | ${item.courseName} | ${item.sourceTeacherLabel} | ${item.disposition} | ${detail} |`,
    );
  }
  if (!report.items.length) lines.push("| （无） |  |  |  |  |");
  return `${lines.join("\n")}\n`;
}

export function reportContainsForbiddenPayload(text: string): boolean {
  return /CASTGC=|JSESSIONID=|submitter_hash|pending_review_json|"cookie":|student_id\s*[:=]/i.test(
    text,
  );
}

export { catalogAdditionPeRequirement, publicPeSkillLabel };
