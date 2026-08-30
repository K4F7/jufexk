/**
 * 回填 teachers.department：先用 JWXT/目录承担单位，再回退 CTA deptName。
 * 不发明院系，不覆盖已有非空院系。
 */
import { homeUnitLabel } from "./lib/catalog-majors";
import {
  chooseCtaMatch,
  departmentsCompatible,
  normalizeDepartmentHint,
  type CtaTeacherCandidate,
} from "./cta-teacher-homepage";

const MAX_DEPARTMENT_CHARS = 80;

export type TeacherDepartmentSource = "catalog" | "cta";

export type TeacherDepartmentFill = {
  teacherId: number;
  department: string;
  source: TeacherDepartmentSource;
};

export type TeacherDepartmentBackfillInput = {
  id: number;
  name: string;
  department?: string | null;
  courseDepartments: readonly (string | null | undefined)[];
};

export type TeacherDepartmentBackfillSummary = {
  teachers: number;
  unlabeledBefore: number;
  unlabeledAfter: number;
  filled: number;
  filledFromCatalog: number;
  filledFromCta: number;
};

export function storedDepartmentIsEmpty(
  department: string | null | undefined,
): boolean {
  return !String(department ?? "").trim();
}

export function clipDepartmentLabel(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_DEPARTMENT_CHARS);
}

export function catalogDepartmentLabels(
  rawDepartments: Iterable<string | null | undefined>,
): string[] {
  const labels = new Set<string>();
  for (const raw of rawDepartments) {
    const label = clipDepartmentLabel(homeUnitLabel(String(raw ?? "").trim()));
    if (label) labels.add(label);
  }
  return [...labels].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export function uniqueCatalogTeacherDepartment(
  courseDepartments: readonly (string | null | undefined)[],
): string | null {
  const labels = catalogDepartmentLabels(courseDepartments);
  return labels.length === 1 ? labels[0] : null;
}

export function mapCtaDeptNameToCatalog(
  ctaDeptName: string | null | undefined,
  catalogLabels: readonly string[],
): string | null {
  const hint = normalizeDepartmentHint(ctaDeptName);
  if (!hint) return null;
  const exact = catalogLabels.filter((label) => label === hint);
  if (exact.length === 1) return clipDepartmentLabel(exact[0]);
  const compatible = catalogLabels.filter((label) =>
    departmentsCompatible(label, hint),
  );
  if (compatible.length === 1) return clipDepartmentLabel(compatible[0]);
  return clipDepartmentLabel(hint);
}

export function planTeacherDepartmentBackfill(
  teachers: readonly TeacherDepartmentBackfillInput[],
  ctaDirectory: readonly CtaTeacherCandidate[],
  catalogLabels: readonly string[],
): TeacherDepartmentFill[] {
  const fills: TeacherDepartmentFill[] = [];
  for (const teacher of teachers) {
    if (!Number.isSafeInteger(teacher.id) || teacher.id <= 0) continue;
    if (!storedDepartmentIsEmpty(teacher.department)) continue;
    const catalog = uniqueCatalogTeacherDepartment(teacher.courseDepartments);
    if (catalog) {
      fills.push({
        teacherId: teacher.id,
        department: catalog,
        source: "catalog",
      });
      continue;
    }
    const decision = chooseCtaMatch(
      { name: teacher.name, department: teacher.department },
      ctaDirectory,
    );
    if (decision.kind !== "unique") continue;
    const mapped = mapCtaDeptNameToCatalog(
      decision.candidate.deptName,
      catalogLabels,
    );
    if (!mapped) continue;
    fills.push({
      teacherId: teacher.id,
      department: mapped,
      source: "cta",
    });
  }
  return fills;
}

export function summarizeTeacherDepartmentBackfill(
  teachers: readonly TeacherDepartmentBackfillInput[],
  fills: readonly TeacherDepartmentFill[],
): TeacherDepartmentBackfillSummary {
  const unlabeledBefore = teachers.filter((teacher) =>
    storedDepartmentIsEmpty(teacher.department),
  ).length;
  const filledFromCatalog = fills.filter(
    (fill) => fill.source === "catalog",
  ).length;
  const filledFromCta = fills.filter((fill) => fill.source === "cta").length;
  return {
    teachers: teachers.length,
    unlabeledBefore,
    unlabeledAfter: unlabeledBefore - fills.length,
    filled: fills.length,
    filledFromCatalog,
    filledFromCta,
  };
}
