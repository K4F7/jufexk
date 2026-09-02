import { describe, expect, it, vi } from "vitest";
import {
  aliasCoursePath,
  assertHttpGetOnly,
  canonicalCoursePath,
  colonEncodedPePath,
  DEFAULT_PRODUCTION_ORIGIN,
  publicGetJson,
  reviewsPath,
  type HttpCapture,
} from "../scripts/pe-alias-equivalence/http";
import {
  PE_ALIAS_EQUIVALENCE_SCHEMA,
  PE_ALIAS_PAIRS,
  buildPeAliasEquivalenceReport,
  deniedPrivacyKeys,
  formatPeAliasEquivalenceMarkdown,
  inferReadTarget,
  isDeniedPrivacyKey,
} from "../scripts/pe-alias-equivalence/report";
import { runPeAliasEquivalence } from "../scripts/pe-alias-equivalence/run";
import { publicPeCourseIdentity } from "../src/lib/public-pe-course-projection";

const SECRET_REVIEW_BODY = "SECRET_REVIEW_BODY_SHOULD_NOT_APPEAR";
const SECRET_NOTE = "moderator secret note";

function capture(path: string, status: number, json: unknown): HttpCapture {
  return {
    method: "GET",
    path,
    url: `https://courses.sein.moe${path}`,
    status,
    ok: status >= 200 && status < 300,
    json,
    headerNames: ["content-type"],
    setCookiePresent: false,
    error: null,
  };
}

function yogaDetail(id: number | null = 800001) {
  return {
    course: {
      id,
      public_id: publicPeCourseIdentity("瑜伽"),
      name: "体育1-4 [瑜伽]",
      category: "sports",
      teachers: [{ id: 11, name: "黄丽萍", review_count: 0 }],
    },
    reviewCount: 0,
  };
}

function wushuDetail(id: number | null = 800002) {
  return {
    course: {
      id,
      public_id: publicPeCourseIdentity("武术"),
      name: "体育1-4 [武术]",
      category: "sports",
      teachers: [{ id: 22, name: "刘春来", review_count: 0 }],
    },
    reviewCount: 0,
  };
}

function emptyReviews() {
  return { items: [], nextCursor: null, total: 0 };
}

function yogaSpec() {
  return PE_ALIAS_PAIRS.find((pair) => pair.label === "瑜伽")!;
}

function wushuSpec() {
  return PE_ALIAS_PAIRS.find((pair) => pair.label === "武术")!;
}

function equivalentPairInput() {
  const yoga = yogaSpec();
  const wushu = wushuSpec();
  const yogaAlias = aliasCoursePath(yoga.aliasId);
  const yogaCanonical = canonicalCoursePath(yoga.canonicalPublicId);
  const wushuAlias = aliasCoursePath(wushu.aliasId);
  const wushuCanonical = canonicalCoursePath(wushu.canonicalPublicId);
  const yogaTeacherReviews = capture(
    reviewsPath(yogaAlias, 11),
    200,
    emptyReviews(),
  );
  const wushuTeacherReviews = capture(
    reviewsPath(wushuAlias, 22),
    200,
    emptyReviews(),
  );
  return [
    {
      spec: yoga,
      aliasDetail: capture(yogaAlias, 200, yogaDetail()),
      aliasReviews: capture(reviewsPath(yogaAlias), 200, emptyReviews()),
      aliasTeacherReviews: [yogaTeacherReviews],
      canonicalDetail: capture(yogaCanonical, 200, yogaDetail()),
      canonicalReviews: capture(reviewsPath(yogaCanonical), 200, emptyReviews()),
      canonicalTeacherReviews: [
        capture(reviewsPath(yogaCanonical, 11), 200, emptyReviews()),
      ],
      extraCanonical: [capture(colonEncodedPePath("瑜伽"), 200, yogaDetail())],
    },
    {
      spec: wushu,
      aliasDetail: capture(wushuAlias, 200, wushuDetail()),
      aliasReviews: capture(reviewsPath(wushuAlias), 200, emptyReviews()),
      aliasTeacherReviews: [wushuTeacherReviews],
      canonicalDetail: capture(wushuCanonical, 200, wushuDetail()),
      canonicalReviews: capture(reviewsPath(wushuCanonical), 200, emptyReviews()),
      canonicalTeacherReviews: [
        capture(reviewsPath(wushuCanonical, 22), 200, emptyReviews()),
      ],
      extraCanonical: [capture(colonEncodedPePath("武术"), 200, wushuDetail())],
    },
  ];
}

describe("PE alias equivalence HTTP helpers", () => {
  it("builds alias, encoded canonical, and colon-only PE paths", () => {
    expect(aliasCoursePath("800001")).toBe("/api/courses/800001");
    expect(canonicalCoursePath("pe:瑜伽")).toBe(
      `/api/courses/${encodeURIComponent("pe:瑜伽")}`,
    );
    expect(colonEncodedPePath("瑜伽")).toBe("/api/courses/pe%3A瑜伽");
    expect(reviewsPath("/api/courses/800001", 11)).toBe(
      "/api/courses/800001/reviews?teacherId=11&pageSize=50",
    );
    expect(() => aliasCoursePath("pe:瑜伽")).toThrow(/alias id/);
    expect(() => assertHttpGetOnly("POST")).toThrow(/GET/);
    expect(() => assertHttpGetOnly("GET")).not.toThrow();
  });

  it("sends GET without cookies and records JSON", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("cookie")).toBeNull();
      expect(String(input)).toBe("https://courses.sein.moe/api/courses/800001");
      return new Response(JSON.stringify(yogaDetail()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await publicGetJson({
      origin: DEFAULT_PRODUCTION_ORIGIN,
      path: "/api/courses/800001",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toMatchObject({
      method: "GET",
      status: 200,
      ok: true,
      path: "/api/courses/800001",
    });
    expect(result.json).toEqual(yogaDetail());
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("PE alias equivalence comparison rules", () => {
  it("locks JSON shape and passes equivalent virtual fallback fixtures", () => {
    const report = buildPeAliasEquivalenceReport({
      requestedAt: "2026-09-02T12:00:00.000Z",
      origin: DEFAULT_PRODUCTION_ORIGIN,
      deploySha: "c08ebe05824c1d4dcf03fa061385c6ea4c6657fe",
      workerVersionId: "version-abc",
      pairs: equivalentPairInput(),
    });
    expect(report.schemaVersion).toBe(PE_ALIAS_EQUIVALENCE_SCHEMA);
    expect(report.readOnly).toBe(true);
    expect(report.method).toBe("GET");
    expect(Object.keys(report).sort()).toEqual([
      "criteria",
      "dataScope",
      "deploySha",
      "equivalent",
      "fallbackVirtual",
      "leftoverFor847",
      "method",
      "origin",
      "pairs",
      "readOnly",
      "requestedAt",
      "schemaVersion",
      "workerVersionId",
    ]);
    expect(report.equivalent).toBe(true);
    expect(report.fallbackVirtual).toBe(true);
    expect(report.criteria.aliasReadable.pass).toBe(true);
    expect(report.criteria.identityEquivalent.pass).toBe(true);
    expect(report.criteria.teacherScope.pass).toBe(true);
    expect(report.criteria.reviewScope.pass).toBe(true);
    expect(report.criteria.privacy.pass).toBe(true);
    expect(report.criteria.metadataPresent.pass).toBe(true);
    expect(report.pairs.map((pair) => pair.readTarget)).toEqual(["virtual", "virtual"]);
    expect(Object.keys(report.pairs[0]!.reviews).sort()).toEqual([
      "aliasIds",
      "canonicalIds",
      "courseNames",
      "crossSportReviewIds",
      "unscopedAliasIds",
      "unscopedCanonicalIds",
    ]);
    expect(inferReadTarget(yogaDetail(), 200)).toBe("virtual");
    expect(inferReadTarget(yogaDetail(null), 200)).toBe("mapped");
    expect(inferReadTarget({ error: "课程不存在" }, 404)).toBe("missing");
  });

  it("records alias 200 + canonical 404 as not equivalent", () => {
    const yoga = yogaSpec();
    const wushu = wushuSpec();
    const report = buildPeAliasEquivalenceReport({
      requestedAt: "2026-09-02T12:00:00.000Z",
      origin: DEFAULT_PRODUCTION_ORIGIN,
      deploySha: "deadbeef",
      workerVersionId: null,
      pairs: [
        {
          spec: yoga,
          aliasDetail: capture(aliasCoursePath("800001"), 200, yogaDetail()),
          aliasReviews: capture(reviewsPath(aliasCoursePath("800001")), 200, emptyReviews()),
          aliasTeacherReviews: [],
          canonicalDetail: capture(canonicalCoursePath("pe:瑜伽"), 404, {
            error: "课程不存在",
          }),
          canonicalReviews: capture(reviewsPath(canonicalCoursePath("pe:瑜伽")), 404, {
            error: "课程不存在",
          }),
          canonicalTeacherReviews: [],
          extraCanonical: [
            capture(colonEncodedPePath("瑜伽"), 404, { error: "课程不存在" }),
          ],
        },
        {
          spec: wushu,
          aliasDetail: capture(aliasCoursePath("800002"), 200, wushuDetail()),
          aliasReviews: capture(reviewsPath(aliasCoursePath("800002")), 200, emptyReviews()),
          aliasTeacherReviews: [],
          canonicalDetail: capture(canonicalCoursePath("pe:武术"), 404, {
            error: "课程不存在",
          }),
          canonicalReviews: capture(reviewsPath(canonicalCoursePath("pe:武术")), 404, {
            error: "课程不存在",
          }),
          canonicalTeacherReviews: [],
          extraCanonical: [],
        },
      ],
    });
    expect(report.equivalent).toBe(false);
    expect(report.criteria.aliasReadable.pass).toBe(true);
    expect(report.criteria.identityEquivalent.pass).toBe(false);
    expect(report.pairs[0]?.canonical.detail.status).toBe(404);
    expect(report.pairs[0]?.alias.detail.status).toBe(200);
    expect(report.pairs[0]?.readTarget).toBe("mixed");
  });

  it("fails identity when public_id or display name differs", () => {
    const [yoga, wushu] = equivalentPairInput();
    yoga.canonicalDetail = capture(yoga.canonicalDetail.path, 200, {
      ...yogaDetail(),
      course: { ...yogaDetail().course, name: "瑜伽" },
    });
    const report = buildPeAliasEquivalenceReport({
      requestedAt: "2026-09-02T12:00:00.000Z",
      origin: DEFAULT_PRODUCTION_ORIGIN,
      deploySha: "sha",
      pairs: [yoga, wushu],
    });
    expect(report.pairs[0]?.identityMatch).toBe(false);
    expect(report.criteria.identityEquivalent.pass).toBe(false);
    expect(report.equivalent).toBe(false);
  });

  it("fails teacher scope when the other specialization teacher appears", () => {
    const [yoga, wushu] = equivalentPairInput();
    yoga.aliasDetail = capture(yoga.aliasDetail.path, 200, {
      course: {
        ...yogaDetail().course,
        teachers: [
          { id: 11, name: "黄丽萍" },
          { id: 22, name: "刘春来" },
        ],
      },
      reviewCount: 0,
    });
    yoga.canonicalDetail = yoga.aliasDetail;
    const report = buildPeAliasEquivalenceReport({
      requestedAt: "2026-09-02T12:00:00.000Z",
      origin: DEFAULT_PRODUCTION_ORIGIN,
      deploySha: "sha",
      pairs: [yoga, wushu],
    });
    expect(report.pairs[0]?.teachers.unexpectedNames).toEqual(["刘春来"]);
    expect(report.criteria.teacherScope.pass).toBe(false);
  });

  it("fails review scope when review ids differ and strips review bodies from the report", () => {
    const [yoga, wushu] = equivalentPairInput();
    yoga.aliasReviews = capture(yoga.aliasReviews.path, 200, {
      items: [
        {
          id: "review:1",
          teacher_id: 11,
          course_id: 9,
          course_name: "体育1",
          comment: SECRET_REVIEW_BODY,
          note: SECRET_NOTE,
        },
      ],
      nextCursor: null,
    });
    yoga.canonicalReviews = capture(yoga.canonicalReviews.path, 200, {
      items: [
        {
          id: "review:2",
          teacher_id: 11,
          course_id: 9,
          course_name: "体育1",
          comment: SECRET_REVIEW_BODY,
        },
      ],
      nextCursor: null,
    });
    const report = buildPeAliasEquivalenceReport({
      requestedAt: "2026-09-02T12:00:00.000Z",
      origin: DEFAULT_PRODUCTION_ORIGIN,
      deploySha: "sha",
      pairs: [yoga, wushu],
    });
    expect(report.criteria.reviewScope.pass).toBe(false);
    expect(report.pairs[0]?.reviews.aliasIds).toEqual(["review:1"]);
    expect(report.pairs[0]?.reviews.canonicalIds).toEqual(["review:2"]);
    expect(report.pairs[0]?.reviews.courseNames).toEqual(["体育1"]);
    const json = JSON.stringify(report);
    const markdown = formatPeAliasEquivalenceMarkdown(report);
    expect(json).not.toContain(SECRET_REVIEW_BODY);
    expect(json).not.toContain(SECRET_NOTE);
    expect(markdown).not.toContain(SECRET_REVIEW_BODY);
    expect(markdown).not.toContain(SECRET_NOTE);
    expect(markdown).toContain("review:1");
    expect(markdown).toContain("未通过");
  });

  it("fails privacy when denylisted keys appear and locks markdown metadata", () => {
    const [yoga, wushu] = equivalentPairInput();
    yoga.aliasDetail = capture(yoga.aliasDetail.path, 200, {
      ...yogaDetail(),
      email: "student@example.com",
      student_id: "2021001",
    });
    const report = buildPeAliasEquivalenceReport({
      requestedAt: "2026-09-02T12:00:00.000Z",
      origin: DEFAULT_PRODUCTION_ORIGIN,
      deploySha: "c08ebe05824c1d4dcf03fa061385c6ea4c6657fe",
      workerVersionId: "version-abc",
      pairs: [yoga, wushu],
    });
    expect(isDeniedPrivacyKey("email")).toBe(true);
    expect(isDeniedPrivacyKey("student_id")).toBe(true);
    expect(isDeniedPrivacyKey("moderator_note")).toBe(true);
    expect(isDeniedPrivacyKey("comment")).toBe(false);
    expect(deniedPrivacyKeys(yoga.aliasDetail.json)).toEqual(["email", "student_id"]);
    expect(report.criteria.privacy.pass).toBe(false);
    const markdown = formatPeAliasEquivalenceMarkdown(report);
    expect(markdown).toContain("2026-09-02T12:00:00.000Z");
    expect(markdown).toContain("c08ebe05824c1d4dcf03fa061385c6ea4c6657fe");
    expect(markdown).toContain("version-abc");
    expect(markdown).toContain("/api/courses/800001");
    expect(markdown).not.toContain("student@example.com");
    expect(markdown).not.toContain("2021001");
    expect(markdown).not.toMatch(/CASTGC|JSESSIONID|Set-Cookie/i);
  });
});

describe("PE alias equivalence CLI", () => {
  it("walks alias and canonical GETs with a mocked fetch", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      const url = new URL(String(input));
      seen.push(`${url.pathname}${url.search}`);
      const path = `${url.pathname}${url.search}`;
      if (path.includes("/reviews")) {
        return new Response(JSON.stringify(emptyReviews()), { status: 200 });
      }
      if (path.includes("800002") || decodeURIComponent(path).includes("武术")) {
        return new Response(JSON.stringify(wushuDetail()), { status: 200 });
      }
      return new Response(JSON.stringify(yogaDetail()), { status: 200 });
    });
    const { report, printed } = await runPeAliasEquivalence(
      [
        "--origin",
        DEFAULT_PRODUCTION_ORIGIN,
        "--format",
        "markdown",
        "--deploy-sha",
        "abc123",
        "--worker-version",
        "worker-1",
        "--requested-at",
        "2026-09-02T12:00:00.000Z",
      ],
      { fetch: fetchImpl as unknown as typeof fetch },
    );
    expect(report.equivalent).toBe(true);
    expect(report.deploySha).toBe("abc123");
    expect(report.workerVersionId).toBe("worker-1");
    expect(printed).toContain("总体等价: 是");
    expect(printed).toContain("abc123");
    expect(seen.some((path) => path.includes("/api/courses/800001"))).toBe(true);
    expect(seen.some((path) => path.includes("/api/courses/800002"))).toBe(true);
    expect(
      seen.some((path) => decodeURIComponent(path).includes("pe:瑜伽")),
    ).toBe(true);
    expect(fetchImpl.mock.calls.every((call) => call[1]?.method === "GET")).toBe(
      true,
    );
  });
});
