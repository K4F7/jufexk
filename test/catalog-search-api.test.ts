import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const origin = "https://example.com";
const department = "搜索学院";
const firstTeacher = "搜索甲师";
const secondTeacher = "搜索乙师";
const mathCourse = "搜索高数";
const linearCourse = "搜索线代";
const percentCourse = "搜索百分号100%课";
const underscoreCourse = "搜索A_下划线课";
const underscoreDecoy = "搜索AB下划线课";

let firstTeacherId = 0;

const search = async (path: string, query: string) => {
  const response = await SELF.fetch(
    `${origin}${path}?${query.replace(/\bq=([^&]*)/, (_, value) => `q=${encodeURIComponent(value)}`)}&pageSize=50`,
  );
  expect(response.status).toBe(200);
  return response.json<{
    items: Array<{ name: string; teachers?: string | null }>;
    total: number;
  }>();
};

const courseNames = async (query: string) =>
  (await search("/api/courses", query)).items.map((item) => item.name);

beforeAll(async () => {
  const insertTeacher = (name: string) =>
    env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
    ).bind(name, name, department);
  const insertCourse = (code: string, name: string) =>
    env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,'general',?)",
    ).bind(code, name, department);

  const [first, second, math, linear] = await env.DB.batch([
    insertTeacher(firstTeacher),
    insertTeacher(secondTeacher),
    insertCourse("SEARCH-MATH", mathCourse),
    insertCourse("SEARCH-LINEAR", linearCourse),
    insertCourse("SEARCH-PCT", percentCourse),
    insertCourse("SEARCH-UNDERSCORE", underscoreCourse),
    insertCourse("SEARCH-DECOY", underscoreDecoy),
  ]);
  firstTeacherId = Number(first.meta.last_row_id);
  const secondTeacherId = Number(second.meta.last_row_id);
  const mathId = Number(math.meta.last_row_id);
  const linearId = Number(linear.meta.last_row_id);

  await env.DB.batch([
    // 搜索高数 由两位教师任课；搜索线代 只有甲师。
    env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
    ).bind(mathId, firstTeacherId),
    env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
    ).bind(mathId, secondTeacherId),
    env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
    ).bind(linearId, firstTeacherId),
  ]);
});

describe("目录搜索把通配符当字面量", () => {
  it("% 只匹配课名里真的有 % 的课程", async () => {
    const names = await courseNames("q=%");
    expect(names).toContain(percentCourse);
    expect(names).not.toContain(mathCourse);
  });

  it("_ 不再当单字符通配符", async () => {
    const names = await courseNames("q=A_");
    expect(names).toContain(underscoreCourse);
    expect(names).not.toContain(underscoreDecoy);
  });

  it("教师搜索同样不把 % 当通配符", async () => {
    const body = await search("/api/teachers", "q=%");
    expect(body.items.map((item) => item.name)).not.toContain(firstTeacher);
  });

  it("投稿课程选项同样不把 % 当通配符", async () => {
    const body = await search("/api/courses/options", "q=%");
    expect(body.items.map((item) => item.name)).not.toContain(mathCourse);
  });
});

describe("目录搜索按空格分词并 AND 组合", () => {
  it("课名 + 教师只返回同时命中的课程", async () => {
    expect(await courseNames(`q=${mathCourse} ${firstTeacher}`)).toEqual([
      mathCourse,
    ]);
    expect(await courseNames(`q=${linearCourse} ${firstTeacher}`)).toEqual([
      linearCourse,
    ]);
  });

  it("全角空格也分词", async () => {
    expect(await courseNames(`q=${mathCourse}　${firstTeacher}`)).toEqual([
      mathCourse,
    ]);
  });

  it("两位教师的词条要落在同一门课上", async () => {
    const body = await search(
      "/api/courses",
      `q=${firstTeacher} ${secondTeacher}`,
    );
    expect(body.items.map((item) => item.name)).toEqual([mathCourse]);
    expect(body.total).toBe(1);
  });

  it("互相排斥的词条返回空结果", async () => {
    expect(await courseNames(`q=${mathCourse} ${linearCourse}`)).toEqual([]);
  });

  it("课名 + 院系词条一起生效", async () => {
    expect(await courseNames(`q=${mathCourse} ${department}`)).toEqual([
      mathCourse,
    ]);
  });

  it("与类别、院系、教师筛选和课名排序组合时参数不错位", async () => {
    expect(
      await courseNames(`q=${firstTeacher} ${secondTeacher}&category=sports`),
    ).toEqual([]);
    expect(
      await courseNames(
        `q=${firstTeacher} ${secondTeacher}&department=${encodeURIComponent(department)}`,
      ),
    ).toEqual([mathCourse]);
    expect(
      await courseNames(
        `q=${firstTeacher} ${secondTeacher}&teacherId=${firstTeacherId}`,
      ),
    ).toEqual([mathCourse]);
    expect(
      await courseNames(`q=${firstTeacher} ${secondTeacher}&sort=name`),
    ).toEqual([mathCourse]);
  });

  it("词条数达到上限时语句仍在 D1 的绑定参数预算内", async () => {
    // 课程列表仍是绑定最多的一条：固定参数 + 每词 1～2 个包含绑定，上限 6 个词条。
    const body = await search(
      "/api/courses",
      `q=${mathCourse} ${department} 甲 乙 丙 丁&teacherId=${firstTeacherId}&sort=reviews`,
    );
    expect(body.items).toEqual([]);
  });

  it("教师搜索支持姓名 + 院系", async () => {
    const matched = await search("/api/teachers", `q=${firstTeacher} ${department}`);
    expect(matched.items.map((item) => item.name)).toEqual([firstTeacher]);
    expect(matched.total).toBe(1);

    const mismatched = await search("/api/teachers", `q=${firstTeacher} 人文`);
    expect(mismatched.items).toEqual([]);
    expect(mismatched.total).toBe(0);
  });

  it("投稿课程选项支持课名 + 教师", async () => {
    const body = await search(
      "/api/courses/options",
      `q=${mathCourse} ${firstTeacher}`,
    );
    expect(body.items.map((item) => item.name)).toEqual([mathCourse]);
    expect(body.total).toBe(1);
  });
});

describe("按教师命中的课程行", () => {
  it("列出该课全部任课教师，而不只是命中的那位", async () => {
    const body = await search("/api/courses", `q=${secondTeacher}`);
    const row = body.items.find((item) => item.name === mathCourse);
    expect(row?.teachers?.split(",")).toEqual(
      expect.arrayContaining([firstTeacher, secondTeacher]),
    );
  });
});

describe("拼音与首字母检索", () => {
  const advancedMath = "高等数学";
  const zhangTeacher = "张拼音师";

  beforeAll(async () => {
    const [course, teacher] = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
      ).bind("PINYIN-MATH", advancedMath, "general", department),
      env.DB.prepare(
        "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
      ).bind(zhangTeacher, zhangTeacher, department),
    ]);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
    )
      .bind(Number(course.meta.last_row_id), Number(teacher.meta.last_row_id))
      .run();
    await env.DB.prepare(
      "UPDATE public_precompute_state SET fingerprint='stale' WHERE id=1",
    ).run();
  });

  it("gaoshu 与 gdsx 能命中高等数学类课名", async () => {
    expect(await courseNames("q=gaoshu")).toContain(advancedMath);
    expect(await courseNames("q=gdsx")).toContain(advancedMath);
  });

  it("zhang 能命中姓张的教师及其任课", async () => {
    const teachers = await search("/api/teachers", "q=zhang");
    expect(teachers.items.map((item) => item.name)).toContain(zhangTeacher);
    expect(await courseNames("q=zhang")).toContain(advancedMath);
  });

  it("汉字查询与通配符字面量保持原行为", async () => {
    expect(await courseNames(`q=${advancedMath}`)).toContain(advancedMath);
    const names = await courseNames("q=%");
    expect(names).not.toContain(advancedMath);
    expect(names).not.toContain(mathCourse);
  });
});

describe("预计算 match_text", () => {
  const staleFingerprint = () =>
    env.DB.prepare(
      "UPDATE public_precompute_state SET fingerprint='stale' WHERE id=1",
    ).run();

  it("课名变体写入后能搜到该课", async () => {
    const linear = await env.DB.prepare(
      "SELECT id FROM courses WHERE name=?",
    )
      .bind(linearCourse)
      .first<{ id: number }>();
    expect(linear?.id).toBeTruthy();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO course_name_variants(course_id,name) VALUES(?,?)",
    )
      .bind(linear!.id, "搜索线代别名")
      .run();
    await staleFingerprint();
    expect(await courseNames("q=搜索线代别名")).toEqual([linearCourse]);
  });

  it("改课名后下一次公开列表能搜到新名字", async () => {
    const renamed = "搜索高数改名";
    await env.DB.prepare("UPDATE courses SET name=? WHERE name=?")
      .bind(renamed, mathCourse)
      .run();
    await staleFingerprint();
    try {
      expect(await courseNames(`q=${renamed}`)).toEqual([renamed]);
    } finally {
      await env.DB.prepare("UPDATE courses SET name=? WHERE name=?")
        .bind(mathCourse, renamed)
        .run();
      await staleFingerprint();
      await courseNames(`q=${mathCourse}`);
    }
  });
});
