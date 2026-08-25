import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { fail, integer } from "./support";

type PublicScheduleOffering = {
  key: string;
  courseCode: string;
  courseName: string;
  teacherName: string;
  termId: string;
  campus: string;
  weekText: string;
  timeText: string;
  place: string;
  catalogCourseId: number;
  catalogTeacherId: number | null;
};

const scheduleOfferingRoutes = new Hono<AppEnv>();

scheduleOfferingRoutes.get("/api/schedule-offerings", async (c) => {
  const courseId = integer(c.req.query("courseId"));
  const term = (c.req.query("term") || "").trim();
  if (!courseId) return fail(c, "courseId is required");
  if (!term) return fail(c, "term is required");

  const mirrored = (
    await c.env.DB.prepare(
      `SELECT
        'jwxt-' || id AS key,
        course_code AS courseCode,
        course_name AS courseName,
        teacher_source_label AS teacherName,
        term_id AS termId,
        campus,
        week_text AS weekText,
        time_text AS timeText,
        place,
        catalog_course_id AS catalogCourseId,
        catalog_teacher_id AS catalogTeacherId
      FROM jwxt_sync_offerings
      WHERE catalog_course_id=? AND term_id=? AND status='active'
      ORDER BY teacher_source_label,time_text,place,id`,
    )
      .bind(courseId, term)
      .all<PublicScheduleOffering>()
  ).results;
  if (mirrored.length > 0) return c.json(mirrored);

  const legacy = (
    await c.env.DB.prepare(
      `SELECT
        'catalog-' || o.id AS key,
        c.code AS courseCode,
        c.name AS courseName,
        COALESCE(GROUP_CONCAT(t.name),'') AS teacherName,
        o.term AS termId,
        o.campus AS campus,
        '' AS weekText,
        o.schedule AS timeText,
        '' AS place,
        o.course_id AS catalogCourseId,
        CASE WHEN COUNT(t.id)=1 THEN MIN(t.id) ELSE NULL END AS catalogTeacherId
      FROM offerings o
      JOIN courses c ON c.id=o.course_id
      LEFT JOIN offering_teachers ot ON ot.offering_id=o.id
      LEFT JOIN teachers t ON t.id=ot.teacher_id
      WHERE o.course_id=? AND o.term=? AND o.status='active'
      GROUP BY o.id
      ORDER BY o.schedule,o.id`,
    )
      .bind(courseId, term)
      .all<PublicScheduleOffering>()
  ).results;
  return c.json(legacy);
});

export default scheduleOfferingRoutes;
