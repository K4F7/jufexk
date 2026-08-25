/**
 * DEV 页面图集：列出全部生产路由，方便进出对照 UI。
 * 课程 / 教师 ID 由本地 D1（pnpm db:seed-preview）解析，解析失败则退回搜索页。
 */

import { parseTeacherRef } from "../lib/course-relations";

export const ATLAS_HASH = "page-atlas";
export const ATLAS_PARAM = "atlas";
export const ATLAS_GALLERY_HREF = `/prototype?module=sky-tokens&variant=A#${ATLAS_HASH}`;

export const ATLAS_FILLED_COURSE_QUERY = "中级财务会计";
export const ATLAS_EMPTY_COURSE_QUERY = "预览空态课程";
export const ATLAS_TEACHER_QUERY = "林晓雯";
export const ATLAS_SECOND_TEACHER_NAME = "苏晚";
export const ATLAS_PUBLIC_CODE = "000001";
export const ATLAS_RESERVED_CODE = "000000";
export const ATLAS_PREVIEW_USER_ID = "a0000000000000000000000000000001";

export type AtlasAccess = "public" | "login" | "admin";

export type AtlasGroupId = "browse" | "account" | "admin" | "info";

export type AtlasTargets = {
  filledCourseId: number | null;
  emptyCourseId: number | null;
  filledTeacherId: number | null;
  secondTeacherId: number | null;
  announcementId: number | null;
};

export type AtlasPage = {
  id: string;
  title: string;
  description: string;
  href: string;
  access: AtlasAccess;
};

export type AtlasGroup = {
  id: AtlasGroupId;
  title: string;
  hint: string;
  pages: AtlasPage[];
};

const emptyTargets: AtlasTargets = {
  filledCourseId: null,
  emptyCourseId: null,
  filledTeacherId: null,
  secondTeacherId: null,
  announcementId: null,
};

export function withAtlasParam(path: string): string {
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const queryIndex = withoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const search = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(search);
  params.set(ATLAS_PARAM, "1");
  return `${pathname}?${params.toString()}${hash}`;
}

export function resolveAtlasTargets(input: {
  filledCourses: Array<{ id: number; name: string; teacher_refs?: string }>;
  emptyCourses: Array<{ id: number; name: string }>;
  teachers: Array<{ id: number; name: string }>;
  announcements: Array<{ id: number; title: string }>;
}): AtlasTargets {
  const filled =
    input.filledCourses.find((course) => course.name === ATLAS_FILLED_COURSE_QUERY) ??
    input.filledCourses[0] ??
    null;
  const empty =
    input.emptyCourses.find((course) => course.name === ATLAS_EMPTY_COURSE_QUERY) ??
    input.emptyCourses[0] ??
    null;
  const teacher =
    input.teachers.find((item) => item.name === ATLAS_TEACHER_QUERY) ??
    input.teachers[0] ??
    null;
  const refs = (filled?.teacher_refs || "")
    .split(",")
    .map((ref) => parseTeacherRef(ref.trim()))
    .filter((ref) => ref.id != null);
  const primary =
    refs.find((ref) => ref.name === ATLAS_TEACHER_QUERY) ?? refs[0] ?? null;
  const secondary =
    refs.find((ref) => ref.name === ATLAS_SECOND_TEACHER_NAME) ??
    refs.find((ref) => ref.id !== primary?.id) ??
    null;
  const announcement =
    input.announcements.find((item) => item.title.startsWith("【预览】")) ??
    input.announcements[0] ??
    null;
  return {
    filledCourseId: filled?.id ?? null,
    emptyCourseId: empty?.id ?? null,
    filledTeacherId: teacher?.id ?? primary?.id ?? null,
    secondTeacherId: secondary?.id ?? null,
    announcementId: announcement?.id ?? null,
  };
}

function courseHref(id: number | null, query: string, teacherId?: number | null) {
  if (id == null) return `/courses?q=${encodeURIComponent(query)}`;
  if (teacherId != null) return `/courses/${id}?teacher=${teacherId}`;
  return `/courses/${id}`;
}

function teacherHref(id: number | null, query: string) {
  return id == null ? `/teachers?q=${encodeURIComponent(query)}` : `/teachers/${id}`;
}

export function listAtlasGroups(targets: AtlasTargets = emptyTargets): AtlasGroup[] {
  const filledCourse = courseHref(targets.filledCourseId, ATLAS_FILLED_COURSE_QUERY);
  const filledPrimary = courseHref(
    targets.filledCourseId,
    ATLAS_FILLED_COURSE_QUERY,
    targets.filledTeacherId,
  );
  const filledSecondary = courseHref(
    targets.filledCourseId,
    ATLAS_FILLED_COURSE_QUERY,
    targets.secondTeacherId,
  );
  const emptyCourse = courseHref(targets.emptyCourseId, ATLAS_EMPTY_COURSE_QUERY);
  const teacher = teacherHref(targets.filledTeacherId, ATLAS_TEACHER_QUERY);
  const submitPreset =
    targets.filledCourseId != null && targets.filledTeacherId != null
      ? `/submit?courseId=${targets.filledCourseId}&teacherId=${targets.filledTeacherId}`
      : "/submit";
  const announcementEdit =
    targets.announcementId != null
      ? `/admin/announcements/${targets.announcementId}`
      : "/admin/announcements/new";

  return [
    {
      id: "browse",
      title: "公开浏览",
      hint: "访客即可打开。先看目录和详情，再对照空态、筛选与课评流。",
      pages: [
        {
          id: "courses",
          title: "课程目录",
          description: "搜索、通识/数学/思政/英语/体育筛选、分页",
          href: "/courses",
          access: "public",
        },
        {
          id: "courses-sports",
          title: "课程目录 · 体育",
          description: "类别筛选：羽毛球 / 乒乓球 / 游泳",
          href: "/courses?category=sports",
          access: "public",
        },
        {
          id: "courses-math",
          title: "课程目录 · 数学",
          description: "类别筛选：高等数学A",
          href: "/courses?category=math",
          access: "public",
        },
        {
          id: "courses-ideology",
          title: "课程目录 · 思政",
          description: "类别筛选：思想道德与法治",
          href: "/courses?category=ideology",
          access: "public",
        },
        {
          id: "courses-english",
          title: "课程目录 · 英语",
          description: "大学英语 I/II 各为独立公开展示课名",
          href: "/courses?category=english",
          access: "public",
        },
        {
          id: "courses-mooc",
          title: "课程目录 · 网课",
          description: "mooc 标签课：职业生涯规划",
          href: "/courses?category=mooc",
          access: "public",
        },
        {
          id: "courses-search",
          title: "课程搜索",
          description: `搜「${ATLAS_FILLED_COURSE_QUERY}」，应看到两位教师`,
          href: `/courses?q=${encodeURIComponent(ATLAS_FILLED_COURSE_QUERY)}`,
          access: "public",
        },
        {
          id: "course-filled",
          title: "课程详情 · 有点评",
          description: "管理员公告、AI 总结、v4 标签、历史文字",
          href: filledPrimary,
          access: "public",
        },
        {
          id: "course-second-teacher",
          title: "课程详情 · 另一位老师",
          description: "同课切换教师，对照关系页",
          href: filledSecondary === filledPrimary ? filledCourse : filledSecondary,
          access: "public",
        },
        {
          id: "course-empty",
          title: "课程详情 · 空态",
          description: "无点评课程，看空态与写点评入口",
          href: emptyCourse,
          access: "public",
        },
        {
          id: "teachers",
          title: "教师目录",
          description: "教师列表与搜索",
          href: "/teachers",
          access: "public",
        },
        {
          id: "teacher-detail",
          title: "教师详情",
          description: "任课课程表；教师页不展示跨课评价流",
          href: teacher,
          access: "public",
        },
        {
          id: "latest",
          title: "最新课评",
          description: "公开文字流、游标分页、无推荐度样本",
          href: "/latest",
          access: "public",
        },
        {
          id: "announcements",
          title: "公告栏",
          description: "公开公告列表",
          href: "/announcements",
          access: "public",
        },
        {
          id: "public-user",
          title: "公开用户页",
          description: `匿名用户#${ATLAS_PUBLIC_CODE} 的过审点评`,
          href: `/u/${ATLAS_PUBLIC_CODE}`,
          access: "public",
        },
        {
          id: "reserved-user",
          title: "匿名历史作者",
          description: "保留编号 #000000，未署名点评",
          href: `/u/${ATLAS_RESERVED_CODE}`,
          access: "public",
        },
        {
          id: "login",
          title: "登录页",
          description: "CAS / 邮箱；DEV 有「本地测试登录」",
          href: "/login",
          access: "public",
        },
      ],
    },
    {
      id: "account",
      title: "登录后",
      hint: "先到登录页点「本地测试登录」，再进出这些页。",
      pages: [
        {
          id: "submit",
          title: "写点评",
          description: "空白投稿表，选课选老师",
          href: "/submit",
          access: "login",
        },
        {
          id: "submit-preset",
          title: "写点评 · 预设关系",
          description: "从课程页「写点评」进来的预填状态",
          href: submitPreset,
          access: "login",
        },
        {
          id: "schedule",
          title: "排课模拟",
          description: "桌面课表；窄屏有提示",
          href: "/schedule",
          access: "login",
        },
        {
          id: "profile",
          title: "个人主页",
          description: "我的点评与关注",
          href: "/profile",
          access: "login",
        },
        {
          id: "notices",
          title: "站内消息",
          description: "未读 / 已读消息列表",
          href: "/notices",
          access: "login",
        },
        {
          id: "account",
          title: "账号",
          description: "会话、退出、注销",
          href: "/account",
          access: "login",
        },
        {
          id: "logout",
          title: "退出登录",
          description: "注销会话后的跳转",
          href: "/logout",
          access: "login",
        },
      ],
    },
    {
      id: "admin",
      title: "管理后台",
      hint: "允许名单为空时，校园学号登录后打开 /admin 即成为首位管理员。",
      pages: [
        {
          id: "admin-hub",
          title: "管理首页",
          description: "Banner、公告、学号绑定、禁言入口",
          href: "/admin",
          access: "admin",
        },
        {
          id: "admin-banner",
          title: "全站 Banner",
          description: "桌面 / 移动文案与历史",
          href: "/admin/banner",
          access: "admin",
        },
        {
          id: "admin-admins",
          title: "管理员学号",
          description: "绑定校园登录学号",
          href: "/admin/admins",
          access: "admin",
        },
        {
          id: "admin-announcement-new",
          title: "发布公告",
          description: "新建公告表单",
          href: "/admin/announcements/new",
          access: "admin",
        },
        {
          id: "admin-announcement-edit",
          title: "编辑公告",
          description: "打开一条预览公告",
          href: announcementEdit,
          access: "admin",
        },
        {
          id: "admin-user",
          title: "用户禁言",
          description: "预览用户站内 ID",
          href: `/admin/users/${ATLAS_PREVIEW_USER_ID}`,
          access: "admin",
        },
      ],
    },
    {
      id: "info",
      title: "站点说明与异常",
      hint: "页脚链出去的静态页，以及故意打错地址的 404。",
      pages: [
        {
          id: "about",
          title: "关于",
          description: "站点说明",
          href: "/about",
          access: "public",
        },
        {
          id: "contact",
          title: "联系",
          description: "反馈渠道",
          href: "/contact",
          access: "public",
        },
        {
          id: "resources",
          title: "资源",
          description: "相关链接",
          href: "/resources",
          access: "public",
        },
        {
          id: "terms",
          title: "条款",
          description: "使用说明",
          href: "/terms",
          access: "public",
        },
        {
          id: "not-found",
          title: "页面不存在",
          description: "404 空态",
          href: "/no-such-page-atlas",
          access: "public",
        },
      ],
    },
  ];
}

export function listAtlasPages(targets: AtlasTargets = emptyTargets): AtlasPage[] {
  return listAtlasGroups(targets).flatMap((group) => group.pages);
}
