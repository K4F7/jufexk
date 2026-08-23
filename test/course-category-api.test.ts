import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { categoryLabel } from "../src/lib/labels";
import { normalizeReviewTemplateKind } from "../src/lib/review-template-kind";

const origin = "https://example.com";

async function login() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": "198.18.30.1",
    },
    body: JSON.stringify({ password: "test-password" }),
  });
  const body = await response.json<{ csrfToken: string }>();
  const cookie = (response.headers as Headers & { getSetCookie(): string[] })
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  return {
    "Content-Type": "application/json",
    Cookie: cookie,
    Origin: origin,
    "X-CSRF-Token": body.csrfToken,
  };
}

describe("review template kind API contract", () => {
  it("offers general, sports, english, ideology, and math public filters", async () => {
    const sports = await SELF.fetch(`${origin}/api/courses?category=sports`);
    const sportsBody = await sports.json<{
      items: Array<{ name: string; category: string }>;
    }>();
    expect(sports.status).toBe(200);
    expect(sportsBody.items.length).toBeGreaterThan(0);
    expect(sportsBody.items.every((item) => item.category === "sports")).toBe(
      true,
    );

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO courses(id,code,name,category,department,scheme_key) VALUES
          (33701,'EN33701','大学英语1','general','外国语学院','english'),
          (33702,'ID33702','思想道德与法治','general','马克思主义学院','ideology'),
          (33703,'MA33703','高等数学A','general','统计学院','math'),
          (33704,'PE33704','大学体育理论','general','体育学院','pe'),
          (33705,'MJ33705','计量经济学','general','经济学院','major'),
          (33706,'PB33706','公共基础导论','general','教务处','public_basic')`,
      ),
    ]);

    const sportsAfter = await SELF.fetch(`${origin}/api/courses?category=sports`);
    const sportsAfterBody = await sportsAfter.json<{
      items: Array<{ name: string; category: string }>;
    }>();
    expect(sportsAfter.status).toBe(200);
    const sportsNames = sportsAfterBody.items.map((item) => item.name);
    expect(sportsNames).toContain("测试体育课");
    expect(sportsNames).toContain("大学体育理论");
    expect(sportsNames).not.toContain("大学英语1");
    expect(sportsNames).not.toContain("思想道德与法治");
    expect(sportsNames).not.toContain("高等数学A");
    expect(sportsNames).not.toContain("计量经济学");
    expect(sportsNames).not.toContain("公共基础导论");
    expect(
      sportsAfterBody.items.find((item) => item.name === "大学体育理论")
        ?.category,
    ).toBe("general");

    for (const [category, name] of [
      ["english", "大学英语"],
      ["ideology", "思想道德与法治"],
      ["math", "高等数学A"],
    ] as const) {
      const response = await SELF.fetch(
        `${origin}/api/courses?category=${category}`,
      );
      const body = await response.json<{
        items: Array<{ name: string; category: string }>;
      }>();
      expect(response.status).toBe(200);
      const names = body.items.map((item) => item.name);
      expect(names).toContain(name);
      expect(names).not.toContain("测试体育课");
      expect(names).not.toContain("计量经济学");
      expect(names).not.toContain("公共基础导论");
      expect(names).not.toContain("大学体育理论");
      expect(body.items.find((item) => item.name === name)?.category).toBe(
        "general",
      );
    }

    // Issue #415：通识课（general）含 major + public_basic；旧键同义。
    for (const category of ["general", "major", "public_basic"] as const) {
      const response = await SELF.fetch(
        `${origin}/api/courses?category=${category}`,
      );
      const body = await response.json<{
        items: Array<{ name: string; category: string }>;
      }>();
      expect(response.status).toBe(200);
      const names = body.items.map((item) => item.name);
      expect(names).toContain("计量经济学");
      expect(names).toContain("公共基础导论");
      expect(names).not.toContain("测试体育课");
      expect(names).not.toContain("大学英语");
      expect(names).not.toContain("思想道德与法治");
      expect(names).not.toContain("高等数学A");
      expect(names).not.toContain("大学体育理论");
    }

    for (const obsolete of ["required", "elective", "pe"])
      expect(
        (await SELF.fetch(`${origin}/api/courses?category=${obsolete}`)).status,
      ).toBe(400);

    await env.DB.prepare(
      "DELETE FROM courses WHERE id BETWEEN 33701 AND 33706",
    ).run();
  });

  it("applies the same 通识课 grouping on view=relations", async () => {
    await env.DB.prepare(
      `INSERT INTO courses(id,code,name,category,department,scheme_key) VALUES
        (33711,'MJ33711','计量经济学','general','经济学院','major'),
        (33712,'PB33712','公共基础导论','general','教务处','public_basic'),
        (33713,'MA33713','高等数学A','general','统计学院','math')`,
    ).run();

    const relations = await SELF.fetch(
      `${origin}/api/courses?view=relations&category=general`,
    );
    expect(relations.status).toBe(200);
    const relationNames = (
      await relations.json<{ items: Array<{ name: string }> }>()
    ).items.map((item) => item.name);
    expect(relationNames).toContain("计量经济学");
    expect(relationNames).toContain("公共基础导论");
    expect(relationNames).not.toContain("高等数学A");

    await env.DB.prepare(
      "DELETE FROM courses WHERE id BETWEEN 33711 AND 33713",
    ).run();
  });

  it("groups mooc-tagged courses under 网课 and keeps them out of other chips", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO courses(id,code,name,category,department,scheme_key) VALUES
          (38101,'ID38101','思政网课样本','general','马克思主义学院','ideology'),
          (38102,'EN38102','英语网课样本','general','外国语学院','english'),
          (38103,'EN38103','线下英语样本','general','外国语学院','english'),
          (38104,'PE38104','网球网课样本','sports','体育学院','pe')`,
      ),
      env.DB.prepare(
        "INSERT INTO course_tags(course_id,tag) VALUES(38101,'mooc'),(38102,'mooc'),(38104,'mooc')",
      ),
    ]);

    const mooc = await SELF.fetch(`${origin}/api/courses?category=mooc`);
    const moocBody = await mooc.json<{ items: Array<{ name: string }> }>();
    expect(mooc.status).toBe(200);
    const moocNames = moocBody.items.map((item) => item.name);
    expect(moocNames).toContain("思政网课样本");
    expect(moocNames).toContain("英语网课样本");
    expect(moocNames).toContain("网球网课样本");
    expect(moocNames).not.toContain("线下英语样本");

    const ideology = await SELF.fetch(
      `${origin}/api/courses?category=ideology`,
    );
    expect(
      (await ideology.json<{ items: Array<{ name: string }> }>()).items.map(
        (item) => item.name,
      ),
    ).not.toContain("思政网课样本");

    const english = await SELF.fetch(`${origin}/api/courses?category=english`);
    const englishNames = (
      await english.json<{ items: Array<{ name: string }> }>()
    ).items.map((item) => item.name);
    expect(englishNames).toContain("线下英语样本");
    expect(englishNames).not.toContain("英语网课样本");

    const sportsNames = (
      await (
        await SELF.fetch(`${origin}/api/courses?category=sports`)
      ).json<{ items: Array<{ name: string }> }>()
    ).items.map((item) => item.name);
    expect(sportsNames).not.toContain("网球网课样本");

    const allNames = (
      await (
        await SELF.fetch(`${origin}/api/courses`)
      ).json<{ items: Array<{ name: string }> }>()
    ).items.map((item) => item.name);
    expect(allNames).toContain("思政网课样本");
    expect(allNames).toContain("英语网课样本");
    expect(allNames).toContain("线下英语样本");

    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM course_tags WHERE course_id IN (38101,38102,38104)",
      ),
      env.DB.prepare("DELETE FROM courses WHERE id BETWEEN 38101 AND 38104"),
    ]);
  });

  it("accepts all new values and rejects old or missing values on writes", async () => {
    const headers = await login();
    for (const [index, category] of ["general", "sports"].entries()) {
      const response = await SELF.fetch(`${origin}/api/admin/courses`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          code: `CATEGORY-${index}`,
          name: `类别课程 ${index}`,
          category,
        }),
      });
      expect(response.status).toBe(200);
    }
    for (const category of ["", "required", "elective", "major", "pe"]) {
      const response = await SELF.fetch(`${origin}/api/admin/courses`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          code: `WRITE-${category || "EMPTY"}`,
          name: "写入类别",
          category,
        }),
      });
      expect(response.status).toBe(400);
    }
  });

  it("maps leftover catalog values onto general or sports so labels never fall through to 其他", () => {
    expect(normalizeReviewTemplateKind("required")).toBe("general");
    expect(normalizeReviewTemplateKind("elective")).toBe("general");
    expect(normalizeReviewTemplateKind("major")).toBe("general");
    expect(normalizeReviewTemplateKind("general")).toBe("general");
    expect(normalizeReviewTemplateKind("unknown")).toBe("general");
    expect(normalizeReviewTemplateKind("pe")).toBe("sports");
    expect(normalizeReviewTemplateKind("sports")).toBe("sports");
    expect(normalizeReviewTemplateKind("")).toBe("");
    expect(normalizeReviewTemplateKind(null)).toBe("");
    expect(categoryLabel("required")).toBe("普通课程");
    expect(categoryLabel("major")).toBe("普通课程");
    expect(categoryLabel("general")).toBe("普通课程");
    expect(categoryLabel("pe")).toBe("体育课");
    expect(categoryLabel("")).toBe("未确定");
  });

  it("normalizes leftover categories on public teacher and course payloads", async () => {
    await env.DB.prepare("PRAGMA ignore_check_constraints=ON").run();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO teachers(id,source_teacher_label,name) VALUES(15101,'程序设计教师','程序设计教师')",
      ),
      env.DB.prepare(
        `INSERT INTO courses(id,code,name,category) VALUES
          (15101,'1005400514','Java程序设计','required'),
          (15102,'1005400724','Python程序设计基础','major'),
          (15103,'PE-151','大学体育','pe')`,
      ),
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(15101,15101),(15102,15101),(15103,15101)",
      ),
    ]);
    await env.DB.prepare("PRAGMA ignore_check_constraints=OFF").run();

    const teacherResponse = await SELF.fetch(`${origin}/api/teachers/15101`);
    const teacherBody = await teacherResponse.json<{
      courses: Array<{ name: string; category: string }>;
    }>();
    expect(teacherResponse.status).toBe(200);
    expect(
      Object.fromEntries(
        teacherBody.courses.map((course) => [course.name, course.category]),
      ),
    ).toEqual({
      Java程序设计: "general",
      Python程序设计基础: "general",
      大学体育: "sports",
    });
    for (const course of teacherBody.courses)
      expect(categoryLabel(course.category)).not.toBe("其他");

    const courseResponse = await SELF.fetch(`${origin}/api/courses/15101`);
    const courseBody = await courseResponse.json<{
      course: { name: string; category: string };
    }>();
    expect(courseResponse.status).toBe(200);
    expect(courseBody.course).toMatchObject({
      name: "Java程序设计",
      category: "general",
    });
    expect(categoryLabel(courseBody.course.category)).toBe("普通课程");
  });

  it("hides umbrella 体育1/体育2 and surfaces skill PE courses as sports", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO teachers(id,source_teacher_label,name) VALUES(18101,'击剑教师','击剑教师')",
      ),
      env.DB.prepare(
        `INSERT INTO courses(id,code,name,category) VALUES
          (18101,'1005000641','体育1','sports'),
          (18102,'1005000651','体育2','sports'),
          (18106,'1005000661','体育3','sports'),
          (18107,'1005000671','体育4','sports'),
          (18108,'1005000681','体育Ⅰ（留）','sports'),
          (18103,'1005002272','网球','general'),
          (18115,'1005001552','网球2','general'),
          (18104,'1005002536','击剑专项理论与实践1','general'),
          (18110,'1005002546','击剑专项理论与实践2','general'),
          (18111,'1005000472','篮球','general'),
          (18112,'1005000492','篮球2','general'),
          (18113,'1005000242','健身教练2','general'),
          (18114,'1005002192','健身教练','general'),
          (18105,'1004001943','会计学','general'),
          (18116,'1005000701','大学体育1','sports'),
          (18117,'1005000731','大学体育4','sports')`,
      ),
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(18101,18101),(18102,18101),(18103,18101),(18104,18101),(18105,18101),(18106,18101),(18107,18101),(18108,18101),(18110,18101),(18111,18101),(18112,18101),(18113,18101),(18114,18101),(18115,18101),(18116,18101),(18117,18101)",
      ),
    ]);

    const hiddenNames = [
      "体育1",
      "体育2",
      "体育3",
      "体育4",
      "体育Ⅰ（留）",
      "大学体育1",
      "大学体育4",
    ];
    for (const name of hiddenNames) {
      const hidden = await SELF.fetch(
        `${origin}/api/courses?q=${encodeURIComponent(name)}`,
      );
      const hiddenBody = await hidden.json<{ items: Array<{ name: string }> }>();
      expect(hidden.status).toBe(200);
      expect(hiddenBody.items.map((item) => item.name)).not.toContain(name);
    }

    const listed = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent("网球")}`,
    );
    const listedBody = await listed.json<{
      items: Array<{ name: string; category: string }>;
    }>();
    expect(listed.status).toBe(200);
    expect(
      listedBody.items.find((item) => item.name === "网球")?.category,
    ).toBe("sports");

    const sports = await SELF.fetch(`${origin}/api/courses?category=sports`);
    const sportsBody = await sports.json<{
      items: Array<{ name: string; category: string }>;
    }>();
    expect(sports.status).toBe(200);
    const sportsNames = sportsBody.items.map((item) => item.name);
    expect(sportsNames).toContain("网球");
    expect(sportsNames).toContain("击剑");
    expect(sportsNames).toContain("篮球");
    expect(sportsNames).toContain("健美操");
    expect(sportsNames).toContain("测试体育课");
    expect(sportsNames).not.toContain("击剑专项理论与实践1");
    expect(sportsNames).not.toContain("击剑专项理论与实践2");
    expect(sportsNames).not.toContain("网球2");
    expect(sportsNames).not.toContain("篮球2");
    expect(sportsNames).not.toContain("健身教练");
    expect(sportsNames).not.toContain("健身教练2");
    for (const name of hiddenNames) expect(sportsNames).not.toContain(name);
    expect(sportsNames).not.toContain("会计学");
    expect(
      sportsBody.items.every((item) => item.category === "sports"),
    ).toBe(true);

    const options = await SELF.fetch(
      `${origin}/api/courses/options?q=${encodeURIComponent("体育")}`,
    );
    const optionsBody = await options.json<{ items: Array<{ name: string }> }>();
    expect(options.status).toBe(200);
    for (const name of hiddenNames)
      expect(optionsBody.items.map((item) => item.name)).not.toContain(name);

    const fencingSearch = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent("击剑专项理论与实践2")}`,
    );
    const fencingSearchBody = await fencingSearch.json<{
      items: Array<{ name: string }>;
    }>();
    expect(fencingSearch.status).toBe(200);
    expect(fencingSearchBody.items.map((item) => item.name)).toEqual(["击剑"]);

    const aerobicsSearch = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent("健美操")}`,
    );
    const aerobicsSearchBody = await aerobicsSearch.json<{
      items: Array<{ name: string }>;
    }>();
    expect(aerobicsSearch.status).toBe(200);
    expect(aerobicsSearchBody.items.map((item) => item.name)).toContain("健美操");

    const tennis = await SELF.fetch(`${origin}/api/courses/18103`);
    const tennisBody = await tennis.json<{
      course: { name: string; category: string };
    }>();
    expect(tennis.status).toBe(200);
    expect(tennisBody.course).toMatchObject({
      name: "网球",
      category: "sports",
    });
    expect(categoryLabel(tennisBody.course.category)).toBe("体育课");

    const fencing = await SELF.fetch(`${origin}/api/courses/18104`);
    const fencingBody = await fencing.json<{
      course: { name: string; category: string };
    }>();
    expect(fencing.status).toBe(200);
    expect(fencingBody.course).toMatchObject({
      name: "击剑",
      category: "sports",
    });

    const aerobics = await SELF.fetch(`${origin}/api/courses/18114`);
    const aerobicsBody = await aerobics.json<{
      course: { name: string; category: string };
    }>();
    expect(aerobics.status).toBe(200);
    expect(aerobicsBody.course).toMatchObject({
      name: "健美操",
      category: "sports",
    });

    const stored = await env.DB.prepare(
      "SELECT name,category FROM courses WHERE id IN (18104,18114) ORDER BY id",
    ).all<{ name: string; category: string }>();
    expect(stored.results).toEqual([
      { name: "击剑专项理论与实践1", category: "general" },
      { name: "健身教练", category: "general" },
    ]);

    const admin = await SELF.fetch(`${origin}/api/admin/courses`, {
      headers: await login(),
    });
    const adminBody = await admin.json<
      Array<{ id: number; name: string; category: string }>
    >();
    expect(admin.status).toBe(200);
    expect(adminBody.find((course) => course.id === 18103)).toMatchObject({
      name: "网球",
      category: "general",
    });
    expect(adminBody.find((course) => course.id === 18104)).toMatchObject({
      name: "击剑专项理论与实践1",
      category: "general",
    });
    expect(adminBody.find((course) => course.id === 18114)).toMatchObject({
      name: "健身教练",
      category: "general",
    });

    const teacher = await SELF.fetch(`${origin}/api/teachers/18101`);
    const teacherBody = await teacher.json<{
      teacher: { course_count: number };
      courses: Array<{ name: string; category: string }>;
    }>();
    expect(teacher.status).toBe(200);
    expect(teacherBody.courses.map((course) => course.name)).toEqual([
      "会计学",
      "健美操",
      "击剑",
      "篮球",
      "网球",
    ]);
    expect(teacherBody.teacher.course_count).toBe(5);
    expect(
      Object.fromEntries(
        teacherBody.courses.map((course) => [course.name, course.category]),
      ),
    ).toMatchObject({
      网球: "sports",
      击剑: "sports",
      篮球: "sports",
      健美操: "sports",
      会计学: "general",
    });
  });

  it("publishes 瑜伽 and 武术 as visible PE names instead of 体育1", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO teachers(id,source_teacher_label,name) VALUES(19401,'黄丽萍','黄丽萍'),(19402,'刘春来','刘春来')",
      ),
      env.DB.prepare(
        "INSERT INTO courses(id,code,name,category) VALUES(19410,'PE19410','体育1','sports'),(19411,'PE19411','体育心理学','general')",
      ),
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(19410,19401),(19410,19402),(19411,19402)",
      ),
    ]);

    const sports = await SELF.fetch(`${origin}/api/courses?category=sports`);
    const sportsBody = await sports.json<{
      items: Array<{ id: number; name: string }>;
    }>();
    expect(sports.status).toBe(200);
    const sportsNames = sportsBody.items.map((item) => item.name);
    expect(sportsNames).toContain("瑜伽");
    expect(sportsNames).toContain("武术");
    expect(sportsNames).toContain("健美操");
    expect(sportsNames).not.toContain("体育1");
    expect(sportsNames).not.toContain("健身教练");

    const yoga = await SELF.fetch(`${origin}/api/courses/800001`);
    const yogaBody = await yoga.json<{
      course: { name: string; category: string; teachers: Array<{ name: string }> };
    }>();
    expect(yoga.status).toBe(200);
    expect(yogaBody.course.name).toBe("瑜伽");
    expect(yogaBody.course.category).toBe("sports");
    expect(yogaBody.course.teachers.map((teacher) => teacher.name)).toContain(
      "黄丽萍",
    );

    const ping = await SELF.fetch(`${origin}/api/teachers/19401`);
    const pingBody = await ping.json<{
      teacher: { course_count: number };
      courses: Array<{ name: string }>;
    }>();
    expect(ping.status).toBe(200);
    expect(pingBody.courses.map((course) => course.name)).toContain("瑜伽");
    expect(pingBody.teacher.course_count).toBe(1);

    const wushu = await SELF.fetch(`${origin}/api/teachers/19402`);
    const wushuBody = await wushu.json<{
      teacher: { course_count: number };
      courses: Array<{ name: string }>;
    }>();
    expect(wushu.status).toBe(200);
    expect(wushuBody.courses.map((course) => course.name)).toEqual([
      "体育心理学",
      "武术",
    ]);
    expect(wushuBody.teacher.course_count).toBe(2);

    const hidden = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent("体育1")}`,
    );
    const hiddenBody = await hidden.json<{ items: Array<{ name: string }> }>();
    expect(hiddenBody.items.map((item) => item.name)).not.toContain("体育1");

    const stored = await env.DB.prepare(
      "SELECT name FROM courses WHERE id=19410",
    ).first<{ name: string }>();
    expect(stored?.name).toBe("体育1");
  });

  it("collapses 大学英语 I–IV in public browse but keeps option and catalog names", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO teachers(id,source_teacher_label,name) VALUES(36701,'英语教师','英语教师')",
      ),
      env.DB.prepare(
        `INSERT INTO courses(id,code,name,category,department,scheme_key) VALUES
          (36701,'1004600232','大学英语I','general','外国语学院','english'),
          (36702,'1004600282','大学英语II','general','外国语学院','english'),
          (36703,'1004600332','大学英语III','general','外国语学院','english'),
          (36704,'1004600382','大学英语IV','general','外国语学院','english'),
          (36705,'1004600262','大学英语I(涉外)','general','外国语学院','english'),
          (36706,'1004606742','大学英语I(艺体）','general','外国语学院','english'),
          (36707,'1004606782','大学英语I（运训）','general','外国语学院','english'),
          (36708,'1004600502','大学英语预备级','general','外国语学院','english')`,
      ),
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(36701,36701),(36702,36701),(36703,36701),(36704,36701),(36705,36701),(36706,36701),(36707,36701),(36708,36701)",
      ),
    ]);

    const listed = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent("大学英语")}&category=english`,
    );
    const listedBody = await listed.json<{ items: Array<{ name: string }> }>();
    expect(listed.status).toBe(200);
    const listedNames = listedBody.items.map((item) => item.name);
    expect(listedNames.filter((name) => name === "大学英语")).toHaveLength(1);
    expect(listedNames).not.toContain("大学英语I");
    expect(listedNames).not.toContain("大学英语II");
    expect(listedNames).not.toContain("大学英语III");
    expect(listedNames).not.toContain("大学英语IV");
    expect(listedNames).toContain("大学英语I(涉外)");
    expect(listedNames).toContain("大学英语I(艺体）");
    expect(listedNames).toContain("大学英语I（运训）");
    expect(listedNames).toContain("大学英语预备级");

    const searchTwo = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent("大学英语II")}`,
    );
    const searchTwoBody = await searchTwo.json<{
      items: Array<{ name: string }>;
    }>();
    expect(searchTwo.status).toBe(200);
    expect(searchTwoBody.items.map((item) => item.name)).toContain("大学英语");
    expect(searchTwoBody.items.map((item) => item.name)).not.toContain(
      "大学英语II",
    );

    const options = await SELF.fetch(
      `${origin}/api/courses/options?q=${encodeURIComponent("大学英语")}`,
    );
    const optionsBody = await options.json<{ items: Array<{ name: string }> }>();
    expect(options.status).toBe(200);
    const optionNames = optionsBody.items.map((item) => item.name);
    expect(optionNames).toEqual(
      expect.arrayContaining([
        "大学英语I",
        "大学英语II",
        "大学英语III",
        "大学英语IV",
      ]),
    );

    const teacher = await SELF.fetch(`${origin}/api/teachers/36701`);
    const teacherBody = await teacher.json<{
      teacher: { course_count: number };
      courses: Array<{ name: string }>;
    }>();
    expect(teacher.status).toBe(200);
    expect(
      teacherBody.courses.filter((course) => course.name === "大学英语"),
    ).toHaveLength(1);
    expect(teacherBody.courses.map((course) => course.name)).toEqual(
      expect.arrayContaining([
        "大学英语",
        "大学英语I(涉外)",
        "大学英语I(艺体）",
        "大学英语I（运训）",
        "大学英语预备级",
      ]),
    );
    expect(teacherBody.teacher.course_count).toBe(5);

    const detail = await SELF.fetch(`${origin}/api/courses/36702`);
    const detailBody = await detail.json<{
      course: {
        name: string;
        teachers: Array<{ name: string }>;
      };
    }>();
    expect(detail.status).toBe(200);
    expect(detailBody.course.name).toBe("大学英语");
    expect(detailBody.course.teachers.map((teacher) => teacher.name)).toContain(
      "英语教师",
    );

    const stored = await env.DB.prepare(
      "SELECT name FROM courses WHERE id IN (36701,36702) ORDER BY id",
    ).all<{ name: string }>();
    expect(stored.results.map((row) => row.name)).toEqual([
      "大学英语I",
      "大学英语II",
    ]);
  });
});
