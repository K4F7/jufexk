import { describe, expect, it } from "vitest";
import {
  ATLAS_EMPTY_COURSE_QUERY,
  ATLAS_FILLED_COURSE_QUERY,
  ATLAS_GALLERY_HREF,
  ATLAS_HASH,
  ATLAS_PARAM,
  ATLAS_PREVIEW_USER_ID,
  ATLAS_PUBLIC_CODE,
  ATLAS_SECOND_TEACHER_NAME,
  ATLAS_TEACHER_QUERY,
  listAtlasPages,
  resolveAtlasTargets,
  withAtlasParam,
} from "../src/prototype/page-atlas";

describe("withAtlasParam", () => {
  it("marks a path so the page can return to the atlas", () => {
    expect(withAtlasParam("/courses")).toBe(`/courses?${ATLAS_PARAM}=1`);
    expect(withAtlasParam("/courses?q=会计")).toBe(
      `/courses?q=%E4%BC%9A%E8%AE%A1&${ATLAS_PARAM}=1`,
    );
    expect(withAtlasParam("/prototype#page-atlas")).toBe(
      `/prototype?${ATLAS_PARAM}=1#page-atlas`,
    );
    expect(ATLAS_GALLERY_HREF).toBe(
      `/prototype?module=sky-tokens&variant=A#${ATLAS_HASH}`,
    );
  });
});

describe("resolveAtlasTargets", () => {
  it("picks seeded course, empty course, both teachers and a preview announcement", () => {
    expect(
      resolveAtlasTargets({
        filledCourses: [
          {
            id: 8,
            name: ATLAS_FILLED_COURSE_QUERY,
            teacher_refs: `4:${ATLAS_SECOND_TEACHER_NAME},2:${ATLAS_TEACHER_QUERY}`,
          },
        ],
        emptyCourses: [{ id: 31, name: ATLAS_EMPTY_COURSE_QUERY }],
        teachers: [{ id: 2, name: ATLAS_TEACHER_QUERY }],
        announcements: [
          { id: 9, title: "【预览】欢迎使用本地种子" },
          { id: 8, title: "其他公告" },
        ],
      }),
    ).toEqual({
      filledCourseId: 8,
      emptyCourseId: 31,
      filledTeacherId: 2,
      secondTeacherId: 4,
      announcementId: 9,
    });
  });
});

describe("listAtlasPages", () => {
  it("covers every production surface so each UI can be entered from the gallery", () => {
    const pages = listAtlasPages({
      filledCourseId: 8,
      emptyCourseId: 31,
      filledTeacherId: 2,
      secondTeacherId: 4,
      announcementId: 9,
    });
    const hrefs = pages.map((page) => page.href);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/courses",
        "/courses?category=sports",
        "/courses?category=math",
        "/courses?category=ideology",
        "/courses?category=english",
        "/courses?category=mooc",
        `/courses?q=${encodeURIComponent(ATLAS_FILLED_COURSE_QUERY)}`,
        "/courses/8?teacher=2",
        "/courses/8?teacher=4",
        "/courses/31",
        "/teachers",
        "/teachers/2",
        "/latest",
        "/announcements",
        `/u/${ATLAS_PUBLIC_CODE}`,
        "/u/000000",
        "/login",
        "/submit",
        "/submit?courseId=8&teacherId=2",
        "/schedule",
        "/profile",
        "/notices",
        "/account",
        "/logout",
        "/admin",
        "/admin/banner",
        "/admin/admins",
        "/admin/announcements/new",
        "/admin/announcements/9",
        `/admin/users/${ATLAS_PREVIEW_USER_ID}`,
        "/about",
        "/contact",
        "/resources",
        "/terms",
        "/no-such-page-atlas",
      ]),
    );
    expect(pages.filter((page) => page.access === "login").map((page) => page.id)).toEqual(
      expect.arrayContaining(["submit", "profile", "notices", "account", "schedule"]),
    );
    expect(pages.filter((page) => page.access === "admin").map((page) => page.id)).toEqual(
      expect.arrayContaining(["admin-hub", "admin-banner", "admin-user"]),
    );
  });

  it("falls back to search when seed IDs are missing", () => {
    const pages = listAtlasPages();
    expect(pages.find((page) => page.id === "course-filled")?.href).toBe(
      `/courses?q=${encodeURIComponent(ATLAS_FILLED_COURSE_QUERY)}`,
    );
    expect(pages.find((page) => page.id === "teacher-detail")?.href).toBe(
      `/teachers?q=${encodeURIComponent(ATLAS_TEACHER_QUERY)}`,
    );
    expect(pages.find((page) => page.id === "submit-preset")?.href).toBe("/submit");
    expect(pages.find((page) => page.id === "admin-announcement-edit")?.href).toBe(
      "/admin/announcements/new",
    );
  });
});
