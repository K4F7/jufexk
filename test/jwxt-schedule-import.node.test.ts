import { afterEach, describe, expect, it } from "vitest";
import {
  isJwxtImportHostname,
  jwxtImportBookmarkletSource,
} from "../src/lib/jwxt-import-bookmarklet";
import {
  matchImportedRelation,
  mergeImportedCourses,
  stagedCoursesFromJwxtImport,
} from "../src/lib/jwxt-schedule-import";
import {
  clearPendingJwxtImport,
  encodeJwxtImportPayload,
  extractJwxtImportRows,
  extractJwxtImportRowsFromText,
  JWXT_IMPORT_HASH_PREFIX,
  JWXT_PENDING_IMPORT_KEY,
  mergeAdjacentSlots,
  parseJwxtTimeText,
  parseJwxtWeeks,
  peekPendingJwxtImport,
  readJwxtImportHash,
  splitCourseCell,
  stashPendingJwxtImport,
} from "../src/lib/jwxt-schedule-text";
import { defaultWeeks, type StagedCourse } from "../src/lib/schedule-plan";
import type { CourseRelation } from "../src/lib/types";

describe("jwxt schedule text", () => {
  it("parses weekday, periods, and week column without treating 节次 as周次", () => {
    expect(parseJwxtWeeks("1-16")).toEqual(defaultWeeks());
    expect(parseJwxtWeeks("1-8,10-16")).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16,
    ]);
    expect(parseJwxtTimeText("星期一 第1-2节", "1-16")).toEqual([
      { weekday: 1, startPeriod: 1, endPeriod: 2, weeks: defaultWeeks() },
    ]);
    expect(parseJwxtTimeText("周一第3,4节；星期三 第5节", "单周")).toEqual([
      {
        weekday: 1,
        startPeriod: 3,
        endPeriod: 4,
        weeks: defaultWeeks().filter((week) => week % 2 === 1),
      },
      {
        weekday: 3,
        startPeriod: 5,
        endPeriod: 5,
        weeks: defaultWeeks().filter((week) => week % 2 === 1),
      },
    ]);
    expect(parseJwxtTimeText("星期一 第1-2节[1-8周]")).toEqual([
      { weekday: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3, 4, 5, 6, 7, 8] },
    ]);
  });

  it("extracts list tables and splits course codes", () => {
    expect(splitCourseCell("1012345678 高等数学")).toEqual({
      courseCode: "1012345678",
      courseName: "高等数学",
    });
    const rows = extractJwxtImportRows(`
      <table>
        <tr><th>课程</th><th>任课教师</th><th>周次</th><th>上课时间</th></tr>
        <tr><td>1012345678 高等数学</td><td>张三</td><td>1-16</td><td>星期一 第1-2节</td></tr>
      </table>
    `);
    expect(rows).toEqual([
      {
        courseName: "高等数学",
        courseCode: "1012345678",
        teacherName: "张三",
        weekText: "1-16",
        timeText: "星期一 第1-2节",
      },
    ]);
  });

  it("extracts a weekly grid and merges adjacent periods", () => {
    const rows = extractJwxtImportRows(`
      <table>
        <tr><th>节次</th><th>星期一</th><th>星期二</th><th>星期三</th></tr>
        <tr><td>第1节</td><td>高等数学<br/>张三</td><td></td><td></td></tr>
        <tr><td>第2节</td><td>高等数学<br/>张三</td><td></td><td></td></tr>
      </table>
    `);
    const { courses } = stagedCoursesFromJwxtImport(rows);
    expect(courses).toHaveLength(1);
    expect(courses[0].slots).toEqual([
      expect.objectContaining({ weekday: 1, startPeriod: 1, endPeriod: 2 }),
    ]);
  });

  it("keeps grid header period ranges so 第1-2节 becomes endPeriod 2", () => {
    const rows = extractJwxtImportRows(`
      <table>
        <tr><th>节次</th><th>星期一</th><th>星期二</th><th>星期三</th></tr>
        <tr><td>第1-2节</td><td>高等数学<br/>张三</td><td></td><td></td></tr>
      </table>
    `);
    expect(rows[0]?.timeText).toBe("星期一 第1-2节");
    const { courses } = stagedCoursesFromJwxtImport(rows);
    expect(courses[0].slots).toEqual([
      expect.objectContaining({ weekday: 1, startPeriod: 1, endPeriod: 2 }),
    ]);
  });

  it("merges overlapping slots on the same weekday and weeks", () => {
    expect(
      mergeAdjacentSlots([
        { weekday: 1, startPeriod: 1, endPeriod: 2, weeks: defaultWeeks() },
        { weekday: 1, startPeriod: 2, endPeriod: 4, weeks: defaultWeeks() },
      ]),
    ).toEqual([
      { weekday: 1, startPeriod: 1, endPeriod: 4, weeks: defaultWeeks() },
    ]);
  });

  it("parses pasted lines and rejects cookie-like payloads", () => {
    expect(
      extractJwxtImportRowsFromText("高等数学 张三 星期一 第1-2节"),
    ).toEqual([
      {
        courseName: "高等数学",
        courseCode: "",
        teacherName: "张三",
        weekText: "",
        timeText: "星期一 第1-2节",
      },
    ]);
    expect(
      extractJwxtImportRowsFromText("1012345678 高等数学 张三 星期一 第1-2节"),
    ).toEqual([
      {
        courseName: "高等数学",
        courseCode: "1012345678",
        teacherName: "张三",
        weekText: "",
        timeText: "星期一 第1-2节",
      },
    ]);
    const encoded = encodeJwxtImportPayload({
      v: 1,
      rows: [
        {
          courseName: "CASTGC=secret",
          courseCode: "",
          teacherName: "",
          weekText: "",
          timeText: "星期一 第1-2节",
        },
      ],
    });
    expect(readJwxtImportHash(`#${JWXT_IMPORT_HASH_PREFIX}${encoded}`)).toBeNull();
    const passwd = encodeJwxtImportPayload({
      v: 1,
      rows: [
        {
          courseName: "passwd=secret",
          courseCode: "",
          teacherName: "",
          weekText: "",
          timeText: "星期一 第1-2节",
        },
      ],
    });
    expect(readJwxtImportHash(`#${JWXT_IMPORT_HASH_PREFIX}${passwd}`)).toBeNull();
  });

  it("round-trips a hash payload", () => {
    const hash = `#${JWXT_IMPORT_HASH_PREFIX}${encodeJwxtImportPayload({
      v: 1,
      rows: [
        {
          courseName: "高等数学",
          courseCode: "",
          teacherName: "张三",
          weekText: "1-16",
          timeText: "星期一 第1-2节",
        },
      ],
    })}`;
    expect(readJwxtImportHash(hash)?.rows[0].courseName).toBe("高等数学");
  });
});

describe("jwxt schedule import merge", () => {
  const relation: CourseRelation = {
    course_id: 8,
    code: "MA101",
    name: "高等数学",
    category: "general",
    department: "数学",
    teacher_id: 9,
    teacher_name: "张三",
    rating: 4.2,
    review_count: 6,
  };

  it("matches a public relation and merges slots onto an existing plan course", () => {
    expect(
      matchImportedRelation(
        { courseName: "高等数学", teacherName: "张三" },
        [relation],
      )?.course_id,
    ).toBe(8);
    const { courses } = stagedCoursesFromJwxtImport(
      [
        {
          courseName: "高等数学",
          courseCode: "",
          teacherName: "张三",
          weekText: "",
          timeText: "星期一 第1-2节",
        },
      ],
      [relation],
    );
    expect(courses[0].id).toBe("8:9");
    const existing: StagedCourse = {
      ...courses[0],
      slots: [],
    };
    const merged = mergeImportedCourses([existing], courses);
    expect(merged[0].slots).toHaveLength(1);
  });
});

describe("jwxt import bookmarklet", () => {
  it("stays on jwxt, reads tables, and only sends schedule rows back", () => {
    const source = jwxtImportBookmarkletSource("https://xk.sein.moe");
    expect(source).toContain("jwxt.jxufe.edu.cn");
    expect(source).toContain('host!=="jwxt.jxufe.edu.cn"');
    expect(source).toContain('host.endsWith(".jwxt.jxufe.edu.cn")');
    expect(source).not.toContain("/jwxt\\.jxufe\\.edu\\.cn$/i");
    expect(source).toContain("上课时间");
    expect(source).toContain(JWXT_IMPORT_HASH_PREFIX);
    expect(source).toContain("https://xk.sein.moe");
    expect(source).toContain('origin+"/schedule#');
    expect(source).not.toContain("document.cookie");
    expect(source).toContain("/CASTGC|JSESSIONID|password|passwd|cookie/i");
    expect(source).toContain("/^(\\d{8,12})\\s+(.+)$/");
    expect(source).toContain("courseCode: codeMatch?codeMatch[1]:\"\"");
  });

  it("accepts jwxt hostnames and rejects lookalikes such as notjwxt.jxufe.edu.cn", () => {
    expect(isJwxtImportHostname("jwxt.jxufe.edu.cn")).toBe(true);
    expect(isJwxtImportHostname("JWXT.JXUFE.EDU.CN")).toBe(true);
    expect(isJwxtImportHostname("cas.jwxt.jxufe.edu.cn")).toBe(true);
    expect(isJwxtImportHostname("notjwxt.jxufe.edu.cn")).toBe(false);
    expect(isJwxtImportHostname("evil.example")).toBe(false);
  });
});

describe("pending jwxt import storage", () => {
  const store = new Map<string, string>();
  const mockSessionStorage = {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };

  afterEach(() => {
    store.clear();
    Reflect.deleteProperty(globalThis, "sessionStorage");
  });

  it("peeks without removing and only clears on demand", () => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: mockSessionStorage,
    });
    const payload = {
      v: 1 as const,
      rows: [
        {
          courseName: "高等数学",
          courseCode: "1012345678",
          teacherName: "张三",
          weekText: "1-16",
          timeText: "星期一 第1-2节",
        },
      ],
    };
    stashPendingJwxtImport(payload);
    expect(peekPendingJwxtImport()?.rows[0].courseName).toBe("高等数学");
    expect(peekPendingJwxtImport()?.rows[0].courseCode).toBe("1012345678");
    clearPendingJwxtImport();
    expect(peekPendingJwxtImport()).toBeNull();
  });

  it("drops invalid pending import JSON from sessionStorage", () => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: mockSessionStorage,
    });
    mockSessionStorage.setItem(JWXT_PENDING_IMPORT_KEY, "{not-json");
    expect(peekPendingJwxtImport()).toBeNull();
    expect(mockSessionStorage.getItem(JWXT_PENDING_IMPORT_KEY)).toBeNull();
  });
});
