import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import seedSql from "../scripts/prototype-local-seed.sql?raw";

const origin = "https://example.com";

const PREVIEW_TEACHERS = [
  "林晓雯",
  "陈启明",
  "王若舟",
  "赵敏",
  "刘洋",
  "周慧",
  "黄志远",
  "吴桐",
  "苏晚",
  "何岚",
  "郑齐",
  "高宁",
] as const;

const PREVIEW_COURSE_CODES = [
  "ACC2101",
  "FIN1203",
  "ECO1101",
  "LAW1002",
  "MIS2205",
  "STA1301",
  "MGT2001",
  "GEN0108",
  "GEN0215",
  "PE0120",
  "PE0142",
  "ACC3108",
  "FIN2306",
  "ECO2104",
  "LAW2201",
  "MIS3102",
  "STA2204",
  "MGT3105",
  "GEN0302",
  "ACC1101",
  "FIN1101",
  "ECO1001",
  "LAW1105",
  "MIS1101",
  "PE0160",
  "EMPTY001",
  "MAR1001",
  "MAT1101",
  "ENG1001",
  "ENG1002",
  "GEN0401",
] as const;

const PREVIEW_REVIEW_COUNT = 52;

function seedStatements(sql: string) {
  return sql
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !/^PRAGMA\b/i.test(statement));
}

async function applyPrototypeSeed() {
  const statements = seedStatements(seedSql);
  const chunkSize = 40;
  for (let index = 0; index < statements.length; index += chunkSize) {
    const chunk = statements.slice(index, index + chunkSize);
    await env.DB.batch(chunk.map((statement) => env.DB.prepare(statement)));
  }
}

describe("prototype-local-seed.sql 对齐现行 schema", () => {
  it("课程 category 只用 general|sports，评价规则写入 scheme_key", () => {
    expect(seedSql).toMatch(/source_teacher_label/);
    expect(seedSql).toMatch(/scheme_key/);
    const coursesInsert =
      seedSql.match(/INSERT OR IGNORE INTO courses\([\s\S]*?VALUES[\s\S]*?;/)?.[0] ?? "";
    expect(coursesInsert).toMatch(/'general'/);
    expect(coursesInsert).toMatch(/'sports'/);
    expect(coursesInsert).not.toMatch(/'major'/);
    expect(coursesInsert).not.toMatch(/'pe'/);
  });
});

describe("pnpm db:seed-preview 灌进公开目录", () => {
  beforeAll(async () => {
    await applyPrototypeSeed();
    await SELF.fetch(`${origin}/api/courses?pageSize=1`);
  });

  it("写入全部预览教师、课程、任课关系和评价", async () => {
    const teachers = await env.DB.prepare(
      `SELECT name FROM teachers WHERE source_teacher_label IN (${PREVIEW_TEACHERS.map(() => "?").join(",")}) ORDER BY name`,
    )
      .bind(...PREVIEW_TEACHERS)
      .all<{ name: string }>();
    expect(teachers.results.map((row) => row.name).sort()).toEqual(
      [...PREVIEW_TEACHERS].sort(),
    );

    const courses = await env.DB.prepare(
      `SELECT code,category FROM courses WHERE code IN (${PREVIEW_COURSE_CODES.map(() => "?").join(",")})`,
    )
      .bind(...PREVIEW_COURSE_CODES)
      .all<{ code: string; category: string }>();
    expect(courses.results).toHaveLength(PREVIEW_COURSE_CODES.length);
    expect(
      courses.results.every((row) => row.category === "general" || row.category === "sports"),
    ).toBe(true);
    expect(
      courses.results.filter((row) => row.category === "sports").map((row) => row.code).sort(),
    ).toEqual(["PE0120", "PE0142", "PE0160"]);

    const relations = await env.DB.prepare(
      `SELECT COUNT(*) n FROM course_teachers ct
       JOIN courses c ON c.id=ct.course_id
       WHERE c.code IN (${PREVIEW_COURSE_CODES.map(() => "?").join(",")})`,
    )
      .bind(...PREVIEW_COURSE_CODES)
      .first<{ n: number }>();
    expect(relations?.n).toBeGreaterThanOrEqual(PREVIEW_COURSE_CODES.length);

    const reviews = await env.DB.prepare(
      "SELECT COUNT(*) n FROM reviews WHERE submitter_hash LIKE 'proto-r-%'",
    ).first<{ n: number }>();
    expect(reviews?.n).toBe(PREVIEW_REVIEW_COUNT);
  });

  it("覆盖现行评价形态、空态课、网课标签和预览用户", async () => {
    const acc = await env.DB.prepare(
      `SELECT r.submitter_hash,r.scheme_key,r.scheme_version,r.scores,r.overall,
              r.headline,r.comment_format,r.login_only,r.status,r.author_user_id
       FROM reviews r
       JOIN courses c ON c.id=r.course_id
       WHERE c.code='ACC2101' AND r.submitter_hash IN (
         'proto-r-001','proto-r-037','proto-r-038','proto-r-039',
         'proto-r-040','proto-r-041','proto-r-042','proto-r-043'
       )`,
    ).all<{
      submitter_hash: string;
      scheme_key: string | null;
      scheme_version: number | null;
      scores: string | null;
      overall: number | null;
      headline: string;
      comment_format: string | null;
      login_only: number;
      status: string;
      author_user_id: string | null;
    }>();
    const byHash = Object.fromEntries(acc.results.map((row) => [row.submitter_hash, row]));
    expect(byHash["proto-r-001"]).toMatchObject({
      scheme_key: "major",
      scheme_version: 4,
      overall: 5,
      headline: "例题扎实值得选",
      author_user_id: "a0000000000000000000000000000001",
      login_only: 0,
      status: "approved",
    });
    expect(byHash["proto-r-001"]?.scores).toContain('"difficulty":2');
    expect(byHash["proto-r-037"]).toMatchObject({ scheme_version: 3 });
    expect(byHash["proto-r-037"]?.scores).toContain('"attendance":2');
    expect(byHash["proto-r-038"]).toMatchObject({ scheme_version: 1 });
    expect(byHash["proto-r-039"]).toMatchObject({
      overall: null,
      scores: null,
      headline: "只写点评不评分",
    });
    expect(byHash["proto-r-040"]).toMatchObject({ comment_format: "html" });
    expect(byHash["proto-r-041"]).toMatchObject({ login_only: 1, status: "approved" });
    expect(byHash["proto-r-042"]).toMatchObject({ status: "pending" });
    expect(byHash["proto-r-043"]).toMatchObject({ status: "rejected" });

    const empty = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM reviews r WHERE r.course_id=c.id) review_n,
         (SELECT COUNT(*) FROM course_teachers ct WHERE ct.course_id=c.id) teacher_n
       FROM courses c WHERE c.code='EMPTY001'`,
    ).first<{ review_n: number; teacher_n: number }>();
    expect(empty).toEqual({ review_n: 0, teacher_n: 1 });

    const mooc = await env.DB.prepare(
      `SELECT tag FROM course_tags
       WHERE course_id=(SELECT id FROM courses WHERE code='GEN0401')`,
    ).first<{ tag: string }>();
    expect(mooc?.tag).toBe("mooc");

    const teachersOnAcc = await env.DB.prepare(
      `SELECT t.source_teacher_label name
       FROM course_teachers ct
       JOIN courses c ON c.id=ct.course_id
       JOIN teachers t ON t.id=ct.teacher_id
       WHERE c.code='ACC2101'
       ORDER BY t.source_teacher_label`,
    ).all<{ name: string }>();
    expect(teachersOnAcc.results.map((row) => row.name)).toEqual(["林晓雯", "苏晚"]);

    const users = await env.DB.prepare(
      "SELECT public_code FROM users WHERE id LIKE 'a000000000000000000000000000000%' ORDER BY public_code",
    ).all<{ public_code: number }>();
    expect(users.results.map((row) => row.public_code)).toEqual([1, 2, 3]);

    const historical = await env.DB.prepare(
      "SELECT COUNT(*) n FROM public_historical_reviews WHERE id LIKE 'proto-hist-%'",
    ).first<{ n: number }>();
    expect(historical?.n).toBe(2);
  });

  it("重复执行不会追加重复行", async () => {
    await applyPrototypeSeed();
    const teachers = await env.DB.prepare(
      `SELECT COUNT(*) n FROM teachers WHERE source_teacher_label IN (${PREVIEW_TEACHERS.map(() => "?").join(",")})`,
    )
      .bind(...PREVIEW_TEACHERS)
      .first<{ n: number }>();
    const courses = await env.DB.prepare(
      `SELECT COUNT(*) n FROM courses WHERE code IN (${PREVIEW_COURSE_CODES.map(() => "?").join(",")})`,
    )
      .bind(...PREVIEW_COURSE_CODES)
      .first<{ n: number }>();
    const reviews = await env.DB.prepare(
      "SELECT COUNT(*) n FROM reviews WHERE submitter_hash LIKE 'proto-r-%'",
    ).first<{ n: number }>();
    expect(teachers?.n).toBe(PREVIEW_TEACHERS.length);
    expect(courses?.n).toBe(PREVIEW_COURSE_CODES.length);
    expect(reviews?.n).toBe(PREVIEW_REVIEW_COUNT);
  });

  it("公开课程和教师接口能读到预览行", async () => {
    const courses = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent("中级财务会计")}`,
    ).then((response) =>
      response.json<{
        items: Array<{
          name: string;
          teachers?: string;
          enrollment_category?: string;
          teaching_type?: string;
          course_level?: string;
        }>;
      }>(),
    );
    const accounting = courses.items.find((item) => item.name === "中级财务会计");
    expect(accounting?.teachers).toContain("林晓雯");
    expect(accounting?.teachers).toContain("苏晚");
    expect(accounting).toMatchObject({
      enrollment_category: "专业必修课",
      teaching_type: "理论课",
      course_level: "专业必修课",
    });

    const teachers = await SELF.fetch(
      `${origin}/api/teachers?q=${encodeURIComponent("林晓雯")}`,
    ).then((response) => response.json<{ items: Array<{ name: string }> }>());
    expect(teachers.items.some((item) => item.name === "林晓雯")).toBe(true);

    const sports = await SELF.fetch(`${origin}/api/courses?category=sports&pageSize=50`).then(
      (response) => response.json<{ items: Array<{ name: string }> }>(),
    );
    expect(sports.items.map((item) => item.name)).toEqual(
      expect.arrayContaining(["体育1-4 [羽毛球]", "体育1-4 [乒乓球]", "游泳"]),
    );

    const empty = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent("预览空态课程")}`,
    ).then((response) =>
      response.json<{ items: Array<{ name: string; review_count?: number }> }>(),
    );
    expect(empty.items.some((item) => item.name === "预览空态课程")).toBe(true);

    const math = await SELF.fetch(`${origin}/api/courses?category=math&pageSize=50`).then(
      (response) => response.json<{ items: Array<{ name: string }> }>(),
    );
    expect(math.items.map((item) => item.name)).toEqual(expect.arrayContaining(["高等数学A"]));

    const ideology = await SELF.fetch(
      `${origin}/api/courses?category=ideology&pageSize=50`,
    ).then((response) => response.json<{ items: Array<{ name: string }> }>());
    expect(ideology.items.map((item) => item.name)).toEqual(
      expect.arrayContaining(["思想道德与法治"]),
    );

    const english = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent("大学英语")}`,
    ).then((response) => response.json<{ items: Array<{ name: string }> }>());
    expect(english.items.map((item) => item.name)).toEqual(
      expect.arrayContaining(["大学英语I", "大学英语II"]),
    );

    const mooc = await SELF.fetch(`${origin}/api/courses?category=mooc&pageSize=50`).then(
      (response) => response.json<{ items: Array<{ name: string }> }>(),
    );
    expect(mooc.items.map((item) => item.name)).toEqual(
      expect.arrayContaining(["职业生涯规划"]),
    );
  });

  it("课程详情、最新课评、Banner 和公开用户页能读到预览状态", async () => {
    const catalog = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent("中级财务会计")}`,
    ).then((response) =>
      response.json<{
        items: Array<{
          id: number;
          name: string;
          enrollment_category?: string;
          teaching_type?: string;
          course_level?: string;
        }>;
      }>(),
    );
    const courseId = catalog.items.find((item) => item.name === "中级财务会计")?.id;
    expect(courseId).toEqual(expect.any(Number));

    const detail = await SELF.fetch(`${origin}/api/courses/${courseId}`).then((response) =>
      response.json<{
        course: {
          admin_notice?: string;
          teachers: Array<{
            id: number;
            name: string;
            follow_count?: number;
            recommend_count?: number;
            not_recommend_count?: number;
          }>;
        };
        summaries?: Record<string, { html: string }>;
      }>(),
    );
    expect(detail.course.admin_notice).toContain("期末闭卷");
    expect(detail.course.teachers.map((teacher) => teacher.name).sort()).toEqual(
      ["林晓雯", "苏晚"],
    );
    const lin = detail.course.teachers.find((teacher) => teacher.name === "林晓雯");
    expect(lin).toBeTruthy();
    expect(lin?.follow_count).toBeGreaterThan(0);
    expect((lin?.recommend_count ?? 0) + (lin?.not_recommend_count ?? 0)).toBeGreaterThan(0);
    expect(detail.summaries?.[String(lin!.id)]?.html).toContain("例题扎实");

    const reviews = await SELF.fetch(
      `${origin}/api/courses/${courseId}/reviews?teacherId=${lin!.id}&pageSize=50`,
    ).then((response) =>
      response.json<{
        items: Array<{
          headline?: string;
          overall: number | null;
          login_only?: number;
          dimensionLabels?: Array<{ id: string; label: string }>;
          comment: string;
          endorsement_count?: number;
          author_public_code?: number;
        }>;
      }>(),
    );
    expect(reviews.items.some((item) => item.headline === "例题扎实值得选")).toBe(true);
    expect(
      reviews.items.some(
        (item) =>
          item.headline === "例题扎实值得选" &&
          item.author_public_code === 1 &&
          (item.endorsement_count ?? 0) >= 2 &&
          item.dimensionLabels?.some((label) => label.id === "difficulty"),
      ),
    ).toBe(true);
    expect(reviews.items.some((item) => item.overall == null)).toBe(true);
    expect(
      reviews.items.some((item) =>
        item.dimensionLabels?.some((label) => label.label === "考勤松紧"),
      ),
    ).toBe(true);
    expect(
      reviews.items.some((item) => item.comment.includes("仅登录用户可见的预览点评正文")),
    ).toBe(false);

    const latest = await SELF.fetch(`${origin}/api/reviews/latest?pageSize=50`).then(
      (response) =>
        response.json<{
          items: Array<{
            comment: string;
            headline?: string;
            author_public_code?: number;
          }>;
        }>(),
    );
    expect(latest.items.some((item) => item.comment.includes("历史文字资料预览"))).toBe(true);
    expect(latest.items.some((item) => item.headline === "只写点评不评分")).toBe(true);
    expect(latest.items.some((item) => item.author_public_code === 1)).toBe(true);
    expect(
      latest.items.some((item) => item.comment.includes("仅登录用户可见的预览点评正文")),
    ).toBe(false);
    expect(latest.items.some((item) => item.comment.includes("待审核的预览点评"))).toBe(false);

    const banner = await SELF.fetch(`${origin}/api/site/banner`).then((response) =>
      response.json<{ desktopHtml: string; mobileHtml: string }>(),
    );
    expect(banner.desktopHtml).toContain("桌面");
    expect(banner.mobileHtml).toContain("移动");

    const profile = await SELF.fetch(`${origin}/api/u/000001`).then((response) =>
      response.json<{ handle: string; review_count: number }>(),
    );
    expect(profile.handle).toBe("匿名用户#000001");
    expect(profile.review_count).toBeGreaterThan(0);
  });
});
