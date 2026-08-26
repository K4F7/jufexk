import { describe, expect, it } from "vitest";
import {
  ATLAS_EMPTY_COURSE_QUERY,
  ATLAS_FILLED_COURSE_QUERY,
  ATLAS_GALLERY_HREF,
  ATLAS_HASH,
  ATLAS_MISSING_ID,
  ATLAS_NO_MATCH_QUERY,
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
        `/courses?q=${encodeURIComponent(ATLAS_NO_MATCH_QUERY)}`,
        "/courses?preview=empty-catalog",
        "/courses?preview=error",
        "/courses/8?teacher=2",
        "/courses/8?teacher=4",
        "/courses/31",
        `/courses/${ATLAS_MISSING_ID}`,
        "/courses/1?preview=error",
        "/teachers",
        `/teachers?q=${encodeURIComponent(ATLAS_NO_MATCH_QUERY)}`,
        "/teachers?preview=error",
        "/teachers/2",
        `/teachers/${ATLAS_MISSING_ID}`,
        "/teachers/1?preview=error",
        "/latest",
        "/latest?preview=empty",
        "/latest?preview=error",
        "/announcements",
        "/announcements?preview=empty",
        "/announcements?preview=error",
        "/announcements?preview=admin",
        `/u/${ATLAS_PUBLIC_CODE}`,
        `/u/${ATLAS_PUBLIC_CODE}?preview=empty`,
        `/u/${ATLAS_PUBLIC_CODE}?preview=error`,
        "/u/000000",
        "/login",
        "/login?preview=mfa",
        "/login?preview=mfa-error",
        "/login?preview=qr",
        "/login?preview=qr-scanned",
        "/login?preview=qr-expired",
        "/login?preview=qr-error",
        "/login?preview=qr-fail",
        "/login?preview=locked",
        "/login?preview=password-update",
        "/submit",
        "/submit?courseId=8&teacherId=2",
        "/schedule",
        "/profile",
        "/profile?preview=empty",
        "/profile?preview=filled",
        "/profile?preview=error",
        "/notices",
        "/notices?preview=empty",
        "/notices?preview=filled",
        "/notices?preview=error",
        "/account?preview=guest",
        "/logout?preview=confirm",
        "/logout?preview=done",
        "/logout?preview=error",
        "/admin?preview=forbidden",
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
      expect.arrayContaining(["submit", "profile", "notices", "schedule"]),
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
