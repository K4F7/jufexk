/**
 * 从生产公开目录与 CTA 索引生成教师院系回填计划。
 *
 *   pnpm teacher-dept-backfill
 *   pnpm teacher-dept-backfill --catalog-origin=https://courses.sein.moe
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  createHttpCtaClient,
  fetchCtaTeacherDirectory,
} from "../../src/cta-teacher-sync";
import {
  catalogDepartmentLabels,
  planTeacherDepartmentBackfill,
  summarizeTeacherDepartmentBackfill,
  type TeacherDepartmentBackfillInput,
} from "../../src/teacher-department-backfill";

const PAGE_SIZE = 50;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return (await response.json()) as T;
}

async function fetchPaged<T>(
  origin: string,
  path: string,
  readItems: (body: T) => Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const firstUrl = `${origin}${path}${path.includes("?") ? "&" : "?"}page=1&pageSize=${PAGE_SIZE}`;
  const first = await fetchJson<T & { pages?: number }>(firstUrl);
  const items = [...readItems(first)];
  const pages = Math.max(1, Number(first.pages) || 1);
  let next = 2;
  const concurrency = 8;
  async function run() {
    while (next <= pages) {
      const page = next;
      next += 1;
      const body = await fetchJson<T>(
        `${origin}${path}${path.includes("?") ? "&" : "?"}page=${page}&pageSize=${PAGE_SIZE}`,
      );
      items.push(...readItems(body));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(0, pages - 1)) }, () =>
      run(),
    ),
  );
  return items;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "catalog-origin": {
        type: "string",
        default: "https://courses.sein.moe",
      },
      output: {
        type: "string",
        default: ".local-data/teacher-department-backfill",
      },
    },
  });
  const origin = values["catalog-origin"] || "https://courses.sein.moe";
  const output = resolve(
    values.output || ".local-data/teacher-department-backfill",
  );
  await mkdir(output, { recursive: true });

  console.log("fetching catalog teachers from", origin);
  const teacherRows = await fetchPaged(
    origin,
    "/api/teachers",
    (body) =>
      ((body as { items?: Array<Record<string, unknown>> }).items ?? []),
  );
  console.log("catalog teachers", teacherRows.length);

  console.log("fetching course relations");
  const relationRows = await fetchPaged(
    origin,
    "/api/courses?view=relations",
    (body) =>
      ((body as { items?: Array<Record<string, unknown>> }).items ?? []),
  );
  console.log("course relations", relationRows.length);

  const departmentsBody = await fetchJson<{ items?: string[] }>(
    `${origin}/api/courses/departments`,
  );
  const catalogLabels = catalogDepartmentLabels(departmentsBody.items ?? []);

  const courseDepartmentsByTeacher = new Map<number, string[]>();
  for (const row of relationRows) {
    const teacherId = Number(row.teacher_id);
    if (!Number.isSafeInteger(teacherId) || teacherId <= 0) continue;
    const department = String(row.department ?? "").trim();
    if (!department) continue;
    const list = courseDepartmentsByTeacher.get(teacherId) ?? [];
    list.push(department);
    courseDepartmentsByTeacher.set(teacherId, list);
  }

  const teachers: TeacherDepartmentBackfillInput[] = teacherRows.map((row) => {
    const id = Number(row.id);
    return {
      id,
      name: String(row.name ?? "").trim(),
      department:
        typeof row.department === "string" ? row.department : null,
      courseDepartments: courseDepartmentsByTeacher.get(id) ?? [],
    };
  });

  console.log("fetching CTA public index");
  const directory = await fetchCtaTeacherDirectory(createHttpCtaClient());
  console.log("cta teachers", directory.length);
  await writeFile(
    resolve(output, "cta-index.json"),
    JSON.stringify(directory, null, 2),
  );

  const fills = planTeacherDepartmentBackfill(
    teachers,
    directory,
    catalogLabels,
  );
  const summary = {
    ...summarizeTeacherDepartmentBackfill(teachers, fills),
    catalogLabels,
    sampleCatalog: fills
      .filter((fill) => fill.source === "catalog")
      .slice(0, 8),
    sampleCta: fills.filter((fill) => fill.source === "cta").slice(0, 8),
  };
  await writeFile(resolve(output, "plan.json"), JSON.stringify(fills, null, 2));
  await writeFile(
    resolve(output, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

await main();
