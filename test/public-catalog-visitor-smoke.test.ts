import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { buildPeSpecializationMapping } from "../src/lib/pe-specialization-mapping";
import { publicPeCourseIdentity } from "../src/lib/public-pe-course-projection";

const origin = "https://example.com";
/** Same shape as #853: 40 spec×teacher extras × 3 reviews-sort binds + 2 scope args exceeds D1's 100-parameter cap without chunking. */
const PE_EXTRA_COUNT = 40;
const YOGA_IDENTITY = publicPeCourseIdentity("瑜伽");
const YOGA_PATH = `/api/courses/${encodeURIComponent(YOGA_IDENTITY)}`;
const HEADER_SEARCH_PATH =
  `/api/search/candidates?kind=course&q=${encodeURIComponent("测试课程")}&limit=200`;

type CatalogList = {
  items: unknown[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

type SmokeKind =
  | "list"
  | "items"
  | "config"
  | "banner"
  | "course"
  | "pe-course"
  | "teacher"
  | "reviews";

const SMOKES: Array<{ path: string; kind: SmokeKind }> = [
  { path: "/api/config", kind: "config" },
  { path: "/api/site/banner", kind: "banner" },
  { path: "/api/courses", kind: "list" },
  { path: "/api/courses?view=relations", kind: "list" },
  { path: "/api/courses?view=relations&sort=name", kind: "list" },
  { path: "/api/courses?view=relations&sort=rating", kind: "list" },
  { path: "/api/courses?category=sports", kind: "list" },
  { path: "/api/courses?view=relations&category=sports", kind: "list" },
  { path: "/api/courses/departments", kind: "items" },
  { path: "/api/courses/options", kind: "list" },
  { path: "/api/teachers", kind: "list" },
  { path: "/api/teachers/1", kind: "teacher" },
  { path: "/api/teachers/1/reviews", kind: "reviews" },
  { path: "/api/reviews/latest", kind: "reviews" },
  { path: HEADER_SEARCH_PATH, kind: "items" },
  { path: "/api/courses/1", kind: "course" },
  { path: "/api/courses/800001", kind: "pe-course" },
  { path: "/api/courses/pe%3A瑜伽", kind: "pe-course" },
  { path: YOGA_PATH, kind: "pe-course" },
  { path: "/api/courses/1/reviews", kind: "reviews" },
  { path: "/api/courses/800001/reviews", kind: "reviews" },
  { path: `${YOGA_PATH}/reviews`, kind: "reviews" },
];

async function smokeFetch(path: string): Promise<unknown> {
  const response = await SELF.fetch(`${origin}${path}`);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.status !== 200) {
    throw new Error(`GET ${path} returned ${response.status}`);
  }
  return body;
}

function assertCatalogList(path: string, body: unknown): CatalogList {
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as CatalogList).items) ||
    !Number.isInteger((body as CatalogList).page) ||
    !Number.isInteger((body as CatalogList).pageSize) ||
    !Number.isInteger((body as CatalogList).total) ||
    !Number.isInteger((body as CatalogList).pages)
  ) {
    throw new Error(
      `GET ${path} returned 200 without list JSON contract {items, page, pageSize, total, pages}`,
    );
  }
  return body as CatalogList;
}

function assertItems(path: string, body: unknown) {
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as { items?: unknown }).items)
  ) {
    throw new Error(`GET ${path} returned 200 without JSON items`);
  }
}

function courseIdentity(body: unknown): { id?: unknown; public_id?: unknown } {
  const course = (body as { course?: { id?: unknown; public_id?: unknown } })
    .course;
  return course && typeof course === "object" ? course : {};
}

describe.sequential("visitor public catalog API smoke", () => {
  beforeAll(async () => {
    const stamp = `PESMOKE${Date.now()}`;
    const department = `${stamp}院`;
    const course = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department,scheme_key) VALUES(?,?,?,?,?)",
    )
      .bind(`${stamp}-B`, "篮球", "sports", department, "pe")
      .run();
    const courseId = Number(course.meta.last_row_id);
    await env.DB.batch(
      Array.from({ length: PE_EXTRA_COUNT }, (_, index) =>
        env.DB.prepare(
          "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
        ).bind(`${stamp}师${index}`, `${stamp}师${index}`, department),
      ),
    );
    const teachers = (
      await env.DB.prepare(
        "SELECT id,name FROM teachers WHERE source_teacher_label LIKE ? ORDER BY id",
      )
        .bind(`${stamp}师%`)
        .all<{ id: number; name: string }>()
    ).results ?? [];
    expect(teachers, `seeded ${teachers.length} PE teachers`).toHaveLength(
      PE_EXTRA_COUNT,
    );
    await env.DB.batch(
      teachers.map((row) =>
        env.DB.prepare(
          "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
        ).bind(courseId, row.id),
      ),
    );
    await env.DB.batch(
      teachers.map((row) => {
        const mapping = buildPeSpecializationMapping({
          sourceKind: "direct_skill",
          normalizedSpecialization: "篮球",
          evidenceKind: "catalog_course_name",
          sourceCourseCode: `${stamp}-B`,
          sourceCourseName: "篮球",
          sourceTeacherLabel: row.name,
          rawSpecializationName: "篮球",
        });
        return env.DB.prepare(
          `INSERT INTO catalog_relation_pe_specializations(
            course_id,teacher_id,source_kind,normalized_specialization,display_semantics,evidence_json
          ) VALUES(?,?,?,?,?,?)`,
        ).bind(
          courseId,
          row.id,
          mapping.sourceKind,
          mapping.normalizedSpecialization,
          mapping.displaySemantics,
          JSON.stringify(mapping.evidence),
        );
      }),
    );
    await env.DB.prepare(
      "INSERT OR IGNORE INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
    )
      .bind("黄丽萍", "黄丽萍", "体育学院")
      .run();
  });

  it.each(SMOKES)("GET $path returns 200", async ({ path, kind }) => {
    const body = await smokeFetch(path);
    if (kind === "list") {
      const list = assertCatalogList(path, body);
      if (path === "/api/courses?view=relations") {
        expect(
          list.total,
          `GET ${path} returned 200 but total=${list.total} < ${PE_EXTRA_COUNT} PE extras`,
        ).toBeGreaterThanOrEqual(PE_EXTRA_COUNT);
      }
      return;
    }
    if (kind === "items" || kind === "reviews") {
      assertItems(path, body);
      return;
    }
    if (kind === "config") {
      const config = body as { siteName?: unknown; universityName?: unknown };
      if (
        typeof config.siteName !== "string" ||
        typeof config.universityName !== "string"
      ) {
        throw new Error(`GET ${path} returned 200 without site identity fields`);
      }
      return;
    }
    if (kind === "banner") {
      const banner = body as { desktopHtml?: unknown; mobileHtml?: unknown };
      if (
        typeof banner.desktopHtml !== "string" ||
        typeof banner.mobileHtml !== "string"
      ) {
        throw new Error(`GET ${path} returned 200 without banner HTML fields`);
      }
      return;
    }
    if (kind === "course") {
      if (courseIdentity(body).id !== 1) {
        throw new Error(`GET ${path} returned 200 without course id 1`);
      }
      return;
    }
    if (kind === "pe-course") {
      const identity = courseIdentity(body);
      if (identity.public_id !== YOGA_IDENTITY && identity.id !== 800001) {
        throw new Error(
          `GET ${path} returned 200 without PE identity ${YOGA_IDENTITY}`,
        );
      }
      return;
    }
    const teacher = (body as { teacher?: { id?: unknown } }).teacher;
    if (teacher?.id !== 1) {
      throw new Error(`GET ${path} returned 200 without teacher id 1`);
    }
  });
});
