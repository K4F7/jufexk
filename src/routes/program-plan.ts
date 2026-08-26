import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { listProgramPlanCourses } from "../program-plan-import";
import { fail } from "./support";

const programPlanRoutes = new Hono<AppEnv>();

programPlanRoutes.get("/api/program-plan", async (c) => {
  const grade = (c.req.query("grade") || "").trim();
  const major = (c.req.query("major") || "").trim();
  if (!grade) return fail(c, "grade is required");
  if (!major) return fail(c, "major is required");
  const items = await listProgramPlanCourses(c.env.DB, grade, major);
  return c.json({ items });
});

export default programPlanRoutes;
