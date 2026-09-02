import {
  catalogAdditionMapping,
  collectRowEvidence,
  countCloseoutRows,
  isNoOpCloseoutProposal,
  isPeQueueDisposition,
  isRedisposablePeQueueDisposition,
  mappingFromCloseoutEvidence,
  parsePeQueueDisposition,
  proposeHistoricalDisposition,
  publicPeSkillLabel,
  sanitizeCloseoutReportItem,
  type PeCloseoutEvidenceItem,
  type PeQueueCloseoutReport,
  type PeQueueDisposition,
  type PeQueueRow,
  type ProposedPeDisposition,
  PE_QUEUE_CLOSEOUT_REPORT_SCHEMA,
} from "./lib/pe-queue-closeout";
import {
  buildDirectSkillMappingBackfillSql,
  normalizeConfirmedPeSpecialization,
  type RelationPeSpecializationMapping,
} from "./lib/pe-specialization-mapping";

type QueueStateRow = {
  live_enqueue_enabled: number;
};

type QueueSqlRow = {
  course_id: number;
  teacher_id: number;
  course_code: string;
  course_name: string;
  source_teacher_label: string;
  reason: string;
  disposition: string | null;
  disposition_reason: string;
  disposed_by: string;
  disposed_at: string | null;
};

type MappingSqlRow = {
  course_id: number;
  teacher_id: number;
  course_code: string;
  course_name: string;
  source_teacher_label: string;
  source_kind: string;
  normalized_specialization: string;
};

type SkillNameRow = {
  teacher_id: number | null;
  source_teacher_label: string;
  course_code: string;
  course_name: string;
};

export type PeQueueAdminError = {
  error: string;
  status: number;
};

function asQueueRow(row: QueueSqlRow): PeQueueRow {
  return {
    courseId: Number(row.course_id),
    teacherId: Number(row.teacher_id),
    courseCode: row.course_code,
    courseName: row.course_name,
    sourceTeacherLabel: row.source_teacher_label,
    reason: row.reason,
    disposition: parsePeQueueDisposition(row.disposition),
    dispositionReason: row.disposition_reason || "",
    disposedBy: row.disposed_by || "",
    disposedAt: row.disposed_at,
  };
}

function skillEvidence(
  kind: PeCloseoutEvidenceItem["kind"],
  row: SkillNameRow,
): PeCloseoutEvidenceItem | null {
  const specialization = publicPeSkillLabel(row.course_name);
  const teacher = row.source_teacher_label?.trim() ?? "";
  if (!specialization || !teacher) return null;
  return {
    kind,
    specialization,
    sourceCourseCode: row.course_code,
    sourceCourseName: row.course_name,
    sourceTeacherLabel: teacher,
  };
}

export async function loadPeQueueState(db: D1Database): Promise<{
  liveEnqueueEnabled: boolean;
}> {
  const row = await db
    .prepare(
      "SELECT live_enqueue_enabled FROM catalog_pe_specialization_queue_state WHERE singleton=1",
    )
    .first<QueueStateRow>();
  return { liveEnqueueEnabled: row?.live_enqueue_enabled === 1 };
}

export async function loadPeQueueRows(
  db: D1Database,
  status: string,
): Promise<PeQueueRow[]> {
  const filter =
    status === "open"
      ? "WHERE q.disposition IS NULL"
      : status === "all"
        ? ""
        : "WHERE q.disposition=?";
  const binds = status === "open" || status === "all" ? [] : [status];
  const { results } = await db
    .prepare(
      `SELECT q.course_id,q.teacher_id,q.course_code,q.course_name,q.source_teacher_label,
              q.reason,q.disposition,q.disposition_reason,q.disposed_by,q.disposed_at
       FROM catalog_pe_specialization_review_queue q
       ${filter}
       ORDER BY q.course_code,q.source_teacher_label,q.course_id,q.teacher_id`,
    )
    .bind(...binds)
    .all<QueueSqlRow>();
  return (results ?? []).map(asQueueRow);
}

async function loadMappingEvidence(db: D1Database): Promise<MappingSqlRow[]> {
  const { results } = await db
    .prepare(
      `SELECT m.course_id,m.teacher_id,c.code course_code,c.name course_name,
              t.source_teacher_label,m.source_kind,m.normalized_specialization
       FROM catalog_relation_pe_specializations m
       JOIN courses c ON c.id=m.course_id
       JOIN teachers t ON t.id=m.teacher_id`,
    )
    .all<MappingSqlRow>();
  return results ?? [];
}

async function loadHistoricalSkillBindings(
  db: D1Database,
): Promise<PeCloseoutEvidenceItem[]> {
  const { results } = await db
    .prepare(
      `SELECT phr.teacher_id,t.source_teacher_label,c.code course_code,c.name course_name
       FROM public_historical_reviews phr
       JOIN courses c ON c.id=phr.course_id
       JOIN teachers t ON t.id=phr.teacher_id`,
    )
    .all<SkillNameRow>();
  return (results ?? [])
    .map((row) => skillEvidence("historical_visible_binding", row))
    .filter((item): item is PeCloseoutEvidenceItem => item != null);
}

async function loadOfferingSkillEvidence(
  db: D1Database,
): Promise<PeCloseoutEvidenceItem[]> {
  const { results } = await db
    .prepare(
      `SELECT o.catalog_teacher_id teacher_id,o.teacher_source_label source_teacher_label,
              o.course_code,o.course_name
       FROM jwxt_sync_offerings o
       WHERE o.status='active'`,
    )
    .all<SkillNameRow>();
  return (results ?? [])
    .map((row) => skillEvidence("offering_skill_name", row))
    .filter((item): item is PeCloseoutEvidenceItem => item != null);
}

async function loadCatalogSkillEvidence(
  db: D1Database,
): Promise<PeCloseoutEvidenceItem[]> {
  const { results } = await db
    .prepare(
      `SELECT ct.teacher_id,t.source_teacher_label,c.code course_code,c.name course_name
       FROM course_teachers ct
       JOIN courses c ON c.id=ct.course_id
       JOIN teachers t ON t.id=ct.teacher_id`,
    )
    .all<SkillNameRow>();
  return (results ?? [])
    .map((row) => skillEvidence("catalog_course_name", row))
    .filter((item): item is PeCloseoutEvidenceItem => item != null);
}

function mappingEvidenceItems(
  rows: MappingSqlRow[],
  kind: "existing_mapping" | "catalog_course_name",
): PeCloseoutEvidenceItem[] {
  return rows.map((row) => ({
    kind,
    specialization: row.normalized_specialization,
    sourceCourseCode: row.course_code,
    sourceCourseName: row.course_name,
    sourceTeacherLabel: row.source_teacher_label,
  }));
}

export async function proposeHistoricalCloseout(
  db: D1Database,
): Promise<ProposedPeDisposition[]> {
  const [allRows, mappings, historical, offerings, catalogSkills] = await Promise.all([
    loadPeQueueRows(db, "all"),
    loadMappingEvidence(db),
    loadHistoricalSkillBindings(db),
    loadOfferingSkillEvidence(db),
    loadCatalogSkillEvidence(db),
  ]);
  const targetRows = allRows.filter((row) =>
    isRedisposablePeQueueDisposition(row.disposition),
  );
  return targetRows.map((row) => {
    const own = mappings.filter(
      (mapping) =>
        mapping.course_id === row.courseId && mapping.teacher_id === row.teacherId,
    );
    const siblings = mappings.filter(
      (mapping) =>
        mapping.teacher_id === row.teacherId &&
        mapping.source_kind === "direct_skill" &&
        mapping.course_id !== row.courseId,
    );
    return proposeHistoricalDisposition({
      row,
      evidence: collectRowEvidence({
        row,
        existingMappings: mappingEvidenceItems(own, "existing_mapping"),
        siblingMappings: [
          ...mappingEvidenceItems(siblings, "catalog_course_name"),
          ...catalogSkills,
        ],
        historicalBindings: historical,
        offeringSkills: offerings,
      }),
    });
  });
}

function mappingInsertStatement(
  db: D1Database,
  mapping: RelationPeSpecializationMapping,
  courseCode: string,
  sourceTeacherLabel: string,
) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO catalog_relation_pe_specializations(
         course_id,teacher_id,source_kind,normalized_specialization,display_semantics,evidence_json
       )
       SELECT c.id,t.id,?,?,?,?
       FROM courses c,teachers t
       WHERE c.code=? AND t.source_teacher_label=?`,
    )
    .bind(
      mapping.sourceKind,
      mapping.normalizedSpecialization,
      mapping.displaySemantics,
      JSON.stringify(mapping.evidence),
      courseCode,
      sourceTeacherLabel,
    );
}

function queueUpdateStatement(
  db: D1Database,
  input: {
    courseId: number;
    teacherId: number;
    disposition: PeQueueDisposition;
    reason: string;
    evidence: unknown;
    actor: string;
  },
) {
  return db
    .prepare(
      `UPDATE catalog_pe_specialization_review_queue
       SET disposition=?,disposition_reason=?,disposition_evidence_json=?,
           disposed_by=?,disposed_at=CURRENT_TIMESTAMP
       WHERE course_id=? AND teacher_id=?
         AND (disposition IS NULL OR disposition IN ('withheld_permanent_exception','conflict_recapture'))`,
    )
    .bind(
      input.disposition,
      input.reason,
      JSON.stringify(input.evidence),
      input.actor,
      input.courseId,
      input.teacherId,
    );
}

export async function applyPeQueueDisposition(
  db: D1Database,
  input: {
    courseId: number;
    teacherId: number;
    disposition: string;
    specialization?: string | null;
    reason?: string | null;
    actor: string;
  },
): Promise<{ ok: true; disposition: PeQueueDisposition } | PeQueueAdminError> {
  if (!input.courseId || !input.teacherId) {
    return { error: "无效任课关系", status: 400 };
  }
  if (!isPeQueueDisposition(input.disposition)) {
    return { error: "处置状态必须是 mapped、withheld_permanent_exception 或 conflict_recapture", status: 400 };
  }
  const row = (
    await db
      .prepare(
        `SELECT q.course_id,q.teacher_id,q.course_code,q.course_name,q.source_teacher_label,
                q.reason,q.disposition,q.disposition_reason,q.disposed_by,q.disposed_at
         FROM catalog_pe_specialization_review_queue q
         WHERE q.course_id=? AND q.teacher_id=?`,
      )
      .bind(input.courseId, input.teacherId)
      .first<QueueSqlRow>()
  );
  if (!row) return { error: "队列记录不存在", status: 404 };
  const current = asQueueRow(row);
  if (current.disposition === "mapped") {
    return { error: "已映射记录不能直接改写", status: 409 };
  }

  let mapping: RelationPeSpecializationMapping | null = null;
  let specialization: string | null = null;
  let reason = (input.reason || "").trim();
  if (input.disposition === "mapped") {
    specialization = normalizeConfirmedPeSpecialization(input.specialization);
    if (!specialization) return { error: "映射必须指定归一化具体专项名", status: 400 };
    const existing = await db
      .prepare(
        "SELECT normalized_specialization FROM catalog_relation_pe_specializations WHERE course_id=? AND teacher_id=?",
      )
      .bind(input.courseId, input.teacherId)
      .first<{ normalized_specialization: string }>();
    if (existing && existing.normalized_specialization !== specialization) {
      return { error: "已有不同专项映射，请标记为冲突", status: 409 };
    }
    mapping = mappingFromCloseoutEvidence({
      row: current,
      specialization,
      evidence: {
        kind: "human_decision",
        specialization,
        sourceCourseCode: current.courseCode,
        sourceCourseName: current.courseName,
        sourceTeacherLabel: current.sourceTeacherLabel,
      },
    });
    if (!reason) reason = `mapped:${specialization}`;
  } else if (input.disposition === "withheld_permanent_exception") {
    if (!reason) {
      return { error: "暂不公开必须填写原因", status: 400 };
    }
  } else if (!reason) {
    reason = "conflict_recapture";
  }

  const statements: D1PreparedStatement[] = [];
  if (mapping) {
    statements.push(
      mappingInsertStatement(db, mapping, current.courseCode, current.sourceTeacherLabel),
    );
  }
  statements.push(
    queueUpdateStatement(db, {
      courseId: current.courseId,
      teacherId: current.teacherId,
      disposition: input.disposition,
      reason,
      evidence: mapping
        ? mapping.evidence
        : {
            kind:
              input.disposition === "withheld_permanent_exception"
                ? "no_explicit_specialization_evidence"
                : "conflicting_specialization_evidence",
            specialization: specialization ?? "",
            sourceCourseCode: current.courseCode,
            sourceCourseName: current.courseName,
            sourceTeacherLabel: current.sourceTeacherLabel,
            reason,
          },
      actor: input.actor,
    }),
  );
  const results = await db.batch(statements);
  const updated = results.at(-1)?.meta.changes || 0;
  if (!updated) return { error: "已映射记录不能直接改写", status: 409 };
  return { ok: true, disposition: input.disposition };
}

export async function applyHistoricalPeQueueCloseout(
  db: D1Database,
  actor: string,
): Promise<{
  mapped: number;
  withheld: number;
  conflict: number;
  skipped: number;
}> {
  await db.prepare(buildDirectSkillMappingBackfillSql()).run();
  const proposals = await proposeHistoricalCloseout(db);
  let mapped = 0;
  let withheld = 0;
  let conflict = 0;
  let skipped = 0;
  for (const proposal of proposals) {
    if (isNoOpCloseoutProposal(proposal)) {
      skipped += 1;
      continue;
    }
    const result = await applyPeQueueDisposition(db, {
      courseId: proposal.courseId,
      teacherId: proposal.teacherId,
      disposition: proposal.disposition,
      specialization: proposal.specialization,
      reason: proposal.reason,
      actor,
    });
    if ("error" in result) {
      skipped += 1;
      continue;
    }
    if (result.disposition === "mapped") mapped += 1;
    else if (result.disposition === "withheld_permanent_exception") withheld += 1;
    else conflict += 1;
  }
  return { mapped, withheld, conflict, skipped };
}

export async function loadPeQueueCloseoutReport(
  db: D1Database,
  generatedAt = new Date().toISOString(),
): Promise<PeQueueCloseoutReport> {
  const [rows, mappings, state] = await Promise.all([
    loadPeQueueRows(db, "all"),
    loadMappingEvidence(db),
    loadPeQueueState(db),
  ]);
  const mappingByKey = new Map(
    mappings.map((row) => [
      `${row.course_id}:${row.teacher_id}`,
      row.normalized_specialization,
    ]),
  );
  const reportRows = rows.map((row) =>
    sanitizeCloseoutReportItem({
      courseCode: row.courseCode,
      courseName: row.courseName,
      sourceTeacherLabel: row.sourceTeacherLabel,
      disposition: row.disposition,
      specialization: mappingByKey.get(`${row.courseId}:${row.teacherId}`) ?? null,
      reason: row.dispositionReason || row.reason,
    }),
  );
  const counts = countCloseoutRows(rows);
  return {
    schemaVersion: PE_QUEUE_CLOSEOUT_REPORT_SCHEMA,
    generatedAt,
    liveEnqueueEnabled: state.liveEnqueueEnabled,
    counts,
    allDisposed: counts.open === 0,
    items: reportRows,
  };
}

export function catalogRequestPeMappingStatement(
  db: D1Database,
  input: {
    kind: string;
    courseCode: string;
    courseName: string;
    sourceTeacherLabel: string;
    requestId: number;
    peSpecialization?: string | null;
  },
):
  | { ok: true; statement: D1PreparedStatement | null }
  | { ok: false; error: string } {
  const result = catalogAdditionMapping(input);
  if (!result.ok) return result;
  if (!result.mapping) return { ok: true, statement: null };
  return {
    ok: true,
    statement: db
      .prepare(
        `INSERT OR IGNORE INTO catalog_relation_pe_specializations(
           course_id,teacher_id,source_kind,normalized_specialization,display_semantics,evidence_json
         )
         SELECT c.id,t.id,?,?,?,?
         FROM courses c,teachers t
         WHERE c.code=? AND t.source_teacher_label=?
           AND EXISTS(SELECT 1 FROM catalog_requests WHERE id=? AND status='pending')`,
      )
      .bind(
        result.mapping.sourceKind,
        result.mapping.normalizedSpecialization,
        result.mapping.displaySemantics,
        JSON.stringify(result.mapping.evidence),
        input.courseCode,
        input.sourceTeacherLabel,
        input.requestId,
      ),
  };
}
