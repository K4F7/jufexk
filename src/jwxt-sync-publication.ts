export type JwxtSyncMode = "pilot" | "incremental" | "full";

export type JwxtSyncStagedRow = {
  sourceKey: string;
  sourceRowSha256: string;
  courseCode: string;
  courseName: string;
  teacherSourceLabel: string;
  termId: string;
  campus: string;
  weekText: string;
  timeText: string;
  place: string;
  classNumber: string;
};

export type JwxtSyncGenerationInput = {
  generationId: string;
  mode: JwxtSyncMode;
  sourceSha256: string;
  complete: boolean;
  capturedAt: string;
  expectedRowCount?: number;
  rows: JwxtSyncStagedRow[];
};

export type D1BatchQuery = { sql: string; params: Array<string | number | null> };

const STAGE_ROW_SQL = `INSERT INTO jwxt_sync_generation_rows(
  generation_id,source_key,source_row_sha256,course_code,course_name,
  teacher_source_label,term_id,campus,week_text,time_text,place,class_number
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`;

function expectedCount(input: JwxtSyncGenerationInput): number {
  return input.expectedRowCount ?? input.rows.length;
}

export function stageJwxtSyncQueries(input: JwxtSyncGenerationInput): D1BatchQuery[] {
  return [
    {
      sql: `INSERT INTO jwxt_sync_generations(
        id,mode,source_sha256,state,complete,expected_row_count,captured_at
      ) VALUES(?,?,?,'staging',?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        mode=excluded.mode,
        source_sha256=excluded.source_sha256,
        complete=excluded.complete,
        expected_row_count=excluded.expected_row_count,
        captured_at=excluded.captured_at
      WHERE jwxt_sync_generations.state='staging'`,
      params: [
        input.generationId,
        input.mode,
        input.sourceSha256,
        input.complete ? 1 : 0,
        expectedCount(input),
        input.capturedAt,
      ],
    },
    {
      sql: `DELETE FROM jwxt_sync_generation_rows
        WHERE generation_id=?
          AND EXISTS(
            SELECT 1 FROM jwxt_sync_generations
            WHERE id=? AND state='staging'
          )`,
      params: [input.generationId, input.generationId],
    },
    ...input.rows.map((row) => ({
      sql: STAGE_ROW_SQL,
      params: [
        input.generationId,
        row.sourceKey,
        row.sourceRowSha256,
        row.courseCode,
        row.courseName,
        row.teacherSourceLabel,
        row.termId,
        row.campus,
        row.weekText,
        row.timeText,
        row.place,
        row.classNumber,
      ],
    })),
  ];
}

export function publishJwxtSyncQueries(input: JwxtSyncGenerationInput): D1BatchQuery[] {
  const queries: D1BatchQuery[] = [];
  if (input.mode === "full") {
    queries.push({
      sql: `UPDATE jwxt_sync_offerings
        SET missing_complete_runs=missing_complete_runs+1,
            status=CASE WHEN missing_complete_runs+1>=2 THEN 'offline' ELSE status END,
            offline_at=CASE
              WHEN missing_complete_runs+1>=2 THEN COALESCE(offline_at,CURRENT_TIMESTAMP)
              ELSE offline_at
            END
        WHERE source_key NOT IN (
          SELECT source_key FROM jwxt_sync_generation_rows WHERE generation_id=?
        )`,
      params: [input.generationId],
    });
  }
  queries.push(
    {
      sql: `INSERT INTO jwxt_sync_offerings(
        source_key,source_row_sha256,course_code,course_name,teacher_source_label,
        term_id,campus,week_text,time_text,place,class_number,
        catalog_course_id,catalog_teacher_id,last_seen_generation_id,
        missing_complete_runs,status,last_seen_at,offline_at
      )
      SELECT
        row.source_key,row.source_row_sha256,row.course_code,row.course_name,
        row.teacher_source_label,row.term_id,row.campus,row.week_text,row.time_text,
        row.place,row.class_number,
        (SELECT id FROM courses WHERE code=row.course_code LIMIT 1),
        (SELECT id FROM teachers WHERE source_teacher_label=row.teacher_source_label LIMIT 1),
        row.generation_id,0,'active',CURRENT_TIMESTAMP,NULL
      FROM jwxt_sync_generation_rows row
      WHERE row.generation_id=?
      ON CONFLICT(source_key) DO UPDATE SET
        source_row_sha256=excluded.source_row_sha256,
        course_code=excluded.course_code,
        course_name=excluded.course_name,
        teacher_source_label=excluded.teacher_source_label,
        term_id=excluded.term_id,
        campus=excluded.campus,
        week_text=excluded.week_text,
        time_text=excluded.time_text,
        place=excluded.place,
        class_number=excluded.class_number,
        catalog_course_id=excluded.catalog_course_id,
        catalog_teacher_id=excluded.catalog_teacher_id,
        last_seen_generation_id=excluded.last_seen_generation_id,
        missing_complete_runs=0,
        status='active',
        last_seen_at=CURRENT_TIMESTAMP,
        offline_at=NULL`,
      params: [input.generationId],
    },
    {
      sql: "UPDATE jwxt_sync_generations SET state='superseded' WHERE state='published' AND id<>?",
      params: [input.generationId],
    },
    {
      sql: `UPDATE jwxt_sync_generations
        SET state='published',published_at=COALESCE(published_at,CURRENT_TIMESTAMP)
        WHERE id=? AND state='staging'`,
      params: [input.generationId],
    },
    {
      sql: `UPDATE jwxt_sync_state
        SET active_generation_id=?,updated_at=CURRENT_TIMESTAMP
        WHERE singleton=1`,
      params: [input.generationId],
    },
  );
  return queries;
}

async function executeBatch(db: D1Database, queries: D1BatchQuery[]): Promise<void> {
  if (queries.length === 0) return;
  await db.batch(queries.map((query) => db.prepare(query.sql).bind(...query.params)));
}

export async function stageJwxtSyncGeneration(
  db: D1Database,
  input: JwxtSyncGenerationInput,
): Promise<void> {
  await executeBatch(db, stageJwxtSyncQueries(input));
}

export async function publishJwxtSyncGeneration(
  db: D1Database,
  input: JwxtSyncGenerationInput,
): Promise<void> {
  const generation = await db.prepare(
    `SELECT state,complete,expected_row_count FROM jwxt_sync_generations WHERE id=?`,
  )
    .bind(input.generationId)
    .first<{ state: string; complete: number; expected_row_count: number }>();
  if (!generation) throw new Error("generation is not staged");
  if (generation.state === "published" || generation.state === "superseded") return;
  if (generation.complete !== 1) throw new Error("generation is incomplete");
  const count = await db.prepare(
    "SELECT COUNT(*) count FROM jwxt_sync_generation_rows WHERE generation_id=?",
  )
    .bind(input.generationId)
    .first<{ count: number }>();
  if (Number(count?.count) !== generation.expected_row_count) {
    throw new Error("staged row count does not match the manifest row count");
  }
  if (input.mode === "full" && generation.expected_row_count === 0) {
    throw new Error("full generation row count must not be zero");
  }
  await executeBatch(db, publishJwxtSyncQueries(input));
}
