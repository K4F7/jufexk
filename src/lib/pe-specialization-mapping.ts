import { normalizeCourseNameForPolicy } from "./course-catalog-policy";
import {
  UMBRELLA_PE_COURSE_NAMES,
  isUmbrellaPeCourseName,
  publicPeSkillFamilySql,
  publicPeSkillLabel,
} from "./public-course-presentation";

export const RELATION_PE_SOURCE_KINDS = ["umbrella", "direct_skill"] as const;
export const RELATION_PE_DISPLAY_SEMANTICS = ["umbrella_prefixed", "keep_source_name"] as const;
export const RELATION_PE_EVIDENCE_KINDS = [
  "catalog_course_name",
  "human_decision",
  "virtual_pe_sports",
  "historical_visible_binding",
  "offering_skill_name",
] as const;

export type RelationPeSourceKind = (typeof RELATION_PE_SOURCE_KINDS)[number];
export type RelationPeDisplaySemantics = (typeof RELATION_PE_DISPLAY_SEMANTICS)[number];
export type RelationPeEvidenceKind = (typeof RELATION_PE_EVIDENCE_KINDS)[number];

export interface RelationPeSpecializationEvidence {
  kind: RelationPeEvidenceKind;
  sourceCourseCode: string;
  sourceCourseName: string;
  sourceTeacherLabel: string;
  rawSpecializationName: string;
}

export interface RelationPeSpecializationMapping {
  sourceKind: RelationPeSourceKind;
  normalizedSpecialization: string;
  displaySemantics: RelationPeDisplaySemantics;
  evidence: RelationPeSpecializationEvidence;
}

export type PeSourceCourseClassification =
  | { sourceKind: "direct_skill"; normalizedSpecialization: string }
  | { sourceKind: "umbrella"; normalizedSpecialization: null }
  | { sourceKind: "none"; normalizedSpecialization: null };

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function peDisplaySemantics(sourceKind: RelationPeSourceKind): RelationPeDisplaySemantics {
  return sourceKind === "umbrella" ? "umbrella_prefixed" : "keep_source_name";
}

export function classifyPeSourceCourseName(name?: string | null): PeSourceCourseClassification {
  const normalized = normalizeCourseNameForPolicy(name ?? "");
  if (!normalized) return { sourceKind: "none", normalizedSpecialization: null };
  if (isUmbrellaPeCourseName(normalized)) return { sourceKind: "umbrella", normalizedSpecialization: null };
  const label = publicPeSkillLabel(normalized);
  if (label) return { sourceKind: "direct_skill", normalizedSpecialization: label };
  return { sourceKind: "none", normalizedSpecialization: null };
}

export function normalizeConfirmedPeSpecialization(raw?: string | null): string | null {
  const normalized = normalizeCourseNameForPolicy(raw ?? "");
  if (!normalized || isUmbrellaPeCourseName(normalized)) return null;
  return publicPeSkillLabel(normalized) ?? normalized;
}

export function buildPeSpecializationMapping(input: {
  sourceKind: RelationPeSourceKind;
  normalizedSpecialization: string;
  evidenceKind: RelationPeEvidenceKind;
  sourceCourseCode: string;
  sourceCourseName: string;
  sourceTeacherLabel: string;
  rawSpecializationName: string;
}): RelationPeSpecializationMapping {
  return {
    sourceKind: input.sourceKind,
    normalizedSpecialization: input.normalizedSpecialization,
    displaySemantics: peDisplaySemantics(input.sourceKind),
    evidence: {
      kind: input.evidenceKind,
      sourceCourseCode: input.sourceCourseCode,
      sourceCourseName: input.sourceCourseName,
      sourceTeacherLabel: input.sourceTeacherLabel,
      rawSpecializationName: input.rawSpecializationName,
    },
  };
}

export type CatalogAdditionPeRequirement =
  | { kind: "none" }
  | { kind: "direct_skill"; specialization: string }
  | { kind: "umbrella" };

/** Catalog-addition admin review: PE umbrellas need an explicit 具体专项. */
export function catalogAdditionPeRequirement(input: {
  kind?: string | null;
  courseName?: string | null;
}): CatalogAdditionPeRequirement {
  if (input.kind !== "course") return { kind: "none" };
  const classified = classifyPeSourceCourseName(input.courseName);
  if (classified.sourceKind === "direct_skill") {
    return {
      kind: "direct_skill",
      specialization: classified.normalizedSpecialization,
    };
  }
  if (classified.sourceKind === "umbrella") return { kind: "umbrella" };
  return { kind: "none" };
}

export function mappingFromDirectSkillCourseName(input: {
  courseCode: string;
  courseName: string;
  sourceTeacherLabel: string;
}): RelationPeSpecializationMapping | undefined {
  const classified = classifyPeSourceCourseName(input.courseName);
  if (classified.sourceKind !== "direct_skill") return undefined;
  return buildPeSpecializationMapping({
    sourceKind: "direct_skill",
    normalizedSpecialization: classified.normalizedSpecialization,
    evidenceKind: "catalog_course_name",
    sourceCourseCode: input.courseCode,
    sourceCourseName: input.courseName,
    sourceTeacherLabel: input.sourceTeacherLabel,
    rawSpecializationName: input.courseName,
  });
}

export function isRelationPeSpecializationMapping(
  value: unknown,
): value is RelationPeSpecializationMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const mapping = value as Partial<RelationPeSpecializationMapping>;
  const evidence = mapping.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  if (!(RELATION_PE_SOURCE_KINDS as readonly string[]).includes(String(mapping.sourceKind))) return false;
  if (!(RELATION_PE_DISPLAY_SEMANTICS as readonly string[]).includes(String(mapping.displaySemantics))) return false;
  if (peDisplaySemantics(mapping.sourceKind as RelationPeSourceKind) !== mapping.displaySemantics) return false;
  if (typeof mapping.normalizedSpecialization !== "string" || !normalizeCourseNameForPolicy(mapping.normalizedSpecialization)) return false;
  if (!(RELATION_PE_EVIDENCE_KINDS as readonly string[]).includes(String(evidence.kind))) return false;
  return [evidence.sourceCourseCode, evidence.sourceCourseName, evidence.sourceTeacherLabel, evidence.rawSpecializationName]
    .every((field) => typeof field === "string" && field.length > 0);
}

export function peDirectSkillNormalizedSql(alias = "c"): string {
  return publicPeSkillFamilySql(alias);
}

export function peUmbrellaCourseNamePredicate(alias = "c"): string {
  const names = UMBRELLA_PE_COURSE_NAMES.map(sqlStringLiteral).join(",");
  return `${alias}.name IN (${names})`;
}
