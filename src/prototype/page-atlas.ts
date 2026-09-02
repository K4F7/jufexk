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
export const ATLAS_NO_MATCH_QUERY = "_____atlas_empty_____";
export const ATLAS_TEACHER_QUERY = "林晓雯";
export const ATLAS_SECOND_TEACHER_NAME = "苏晚";
export const ATLAS_PUBLIC_CODE = "000001";
export const ATLAS_RESERVED_CODE = "000000";
export const ATLAS_PREVIEW_USER_ID = "a0000000000000000000000000000001";
export const ATLAS_MISSING_ID = 999999999;

export type AtlasAccess = "public" | "login" | "admin";

export type AtlasGroupId = "browse" | "account" | "admin" | "info";

export type AtlasTargets = {
  filledCourseId: number | null;
  emptyCourseId: number | null;
  filledTeacherId: number | null;
  secondTeacherId: number | null;
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
  return {
    filledCourseId: filled?.id ?? null,
    emptyCourseId: empty?.id ?? null,
    filledTeacherId: teacher?.id ?? primary?.id ?? null,
    secondTeacherId: secondary?.id ?? null,
  };
}

function courseHref(id: number | null, query: string, teacherId?: number | null) {
  if (id == null) return `/courses?q=${encodeURIComponent(query)}`;
  if (teacherId != null) return `/courses/${id}?teacher=${teacherId}`;
  return `/courses/${id}`;
}

function teacherHref(id: number | null, query: string) {
  return id == null ? `/courses?q=${encodeURIComponent(query)}` : `/teachers/${id}`;
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
          id: "courses-empty",
          title: "课程目录 · 筛选空态",
          description: "真实 D1：关键词无匹配",
          href: `/courses?q=${encodeURIComponent(ATLAS_NO_MATCH_QUERY)}`,
          access: "public",
        },
        {
          id: "courses-empty-catalog",
          title: "课程目录 · 真空目录",
          description: "DEV mock：目录暂无课程数据",
          href: "/courses?preview=empty-catalog",
          access: "public",
        },
        {
          id: "courses-error",
          title: "课程目录 · 加载失败",
          description: "DEV mock：错误虚线框 + 重试",
          href: "/courses?preview=error",
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
          id: "course-missing",
          title: "课程详情 · 不存在",
          description: "真实 API 404 / 加载失败",
          href: `/courses/${ATLAS_MISSING_ID}`,
          access: "public",
        },
        {
          id: "course-error",
          title: "课程详情 · 加载失败",
          description: "DEV mock：课程加载失败",
          href: "/courses/1?preview=error",
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
          id: "teacher-missing",
          title: "教师详情 · 不存在",
          description: "真实 API 404 / 加载失败",
          href: `/teachers/${ATLAS_MISSING_ID}`,
          access: "public",
        },
        {
          id: "teacher-error",
          title: "教师详情 · 加载失败",
          description: "DEV mock：教师资料加载失败",
          href: "/teachers/1?preview=error",
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
          id: "latest-filled",
          title: "最新课评 · 满态",
          description: "DEV mock：若干公开课评",
          href: "/latest?preview=filled",
          access: "public",
        },
        {
          id: "latest-empty",
          title: "最新课评 · 空态",
          description: "DEV mock：暂时还没有公开课评",
          href: "/latest?preview=empty",
          access: "public",
        },
        {
          id: "latest-error",
          title: "最新课评 · 加载失败",
          description: "DEV mock：最新课评加载失败",
          href: "/latest?preview=error",
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
          id: "public-user-filled",
          title: "公开用户页 · 满态",
          description: "DEV mock：匿名用户#000001 有过审点评",
          href: `/u/${ATLAS_PUBLIC_CODE}?preview=filled`,
          access: "public",
        },
        {
          id: "public-user-empty",
          title: "公开用户页 · 空态",
          description: "DEV mock：暂时还没有公开点评",
          href: `/u/${ATLAS_PUBLIC_CODE}?preview=empty`,
          access: "public",
        },
        {
          id: "public-user-error",
          title: "公开用户页 · 加载失败",
          description: "DEV mock：公开主页加载失败",
          href: `/u/${ATLAS_PUBLIC_CODE}?preview=error`,
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
          description: "CAS；DEV 有「本地测试登录」",
          href: "/login",
          access: "public",
        },
        {
          id: "login-mfa",
          title: "登录页 · 验证码",
          description: "DEV mock：四位企业微信验证码",
          href: "/login?preview=mfa",
          access: "public",
        },
        {
          id: "login-mfa-error",
          title: "登录页 · 验证码错误",
          description: "DEV mock：验证码不正确",
          href: "/login?preview=mfa-error",
          access: "public",
        },
        {
          id: "login-qr",
          title: "登录页 · 扫码加载",
          description: "DEV mock：中间二维码骨架，不请求校园接口",
          href: "/login?preview=qr",
          access: "public",
        },
        {
          id: "login-qr-scanned",
          title: "登录页 · 已扫码",
          description: "DEV mock：扫码成功，请在手机上确认",
          href: "/login?preview=qr-scanned",
          access: "public",
        },
        {
          id: "login-qr-expired",
          title: "登录页 · 二维码失效",
          description: "DEV mock：二维码已失效",
          href: "/login?preview=qr-expired",
          access: "public",
        },
        {
          id: "login-qr-error",
          title: "登录页 · 请求过频",
          description: "DEV mock：请求过于频繁，请稍后再试",
          href: "/login?preview=qr-error",
          access: "public",
        },
        {
          id: "login-qr-fail",
          title: "登录页 · 扫码失败",
          description: "DEV mock：登录失败，请稍后重试",
          href: "/login?preview=qr-fail",
          access: "public",
        },
        {
          id: "login-locked",
          title: "登录页 · 账号锁定",
          description: "DEV mock：账号已锁定，请稍后再试",
          href: "/login?preview=locked",
          access: "public",
        },
        {
          id: "login-password-update",
          title: "登录页 · 需改密",
          description: "DEV mock：密码已过期，请先修改密码",
          href: "/login?preview=password-update",
          access: "public",
        },
      ],
    },
    {
      id: "account",
      title: "登录后",
      hint: "先到登录页点「本地测试登录」，再进出这些页。图集入口带 atlas=1，不会再拦一层登录或确认卡。",
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
          id: "submit-filled",
          title: "写点评 · 填满预览",
          description: "DEV preview=filled：课×师与完整草稿",
          href: "/submit?preview=filled",
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
          description: "真实 D1：本地测试登录后的点评与关注",
          href: "/profile",
          access: "login",
        },
        {
          id: "profile-empty",
          title: "个人主页 · 空态",
          description: "DEV mock：还没有点评 / 关注",
          href: "/profile?preview=empty",
          access: "login",
        },
        {
          id: "profile-filled",
          title: "个人主页 · 满态/审核中",
          description: "DEV mock：过审、待审核、已驳回",
          href: "/profile?preview=filled",
          access: "login",
        },
        {
          id: "profile-error",
          title: "个人主页 · 加载失败",
          description: "DEV mock：个人主页暂时加载不了",
          href: "/profile?preview=error",
          access: "login",
        },
        {
          id: "notices",
          title: "消息下拉 · 未读/已读",
          description: "DEV mock：顶栏信封下拉（关注课评 / 认可 / 关注）",
          href: "/courses?preview=filled",
          access: "login",
        },
        {
          id: "notices-empty",
          title: "消息下拉 · 空态",
          description: "DEV mock：顶栏信封下拉「还没有消息哦」",
          href: "/courses?preview=notices-badge-zero",
          access: "login",
        },
        {
          id: "notices-badge",
          title: "消息未读",
          description: "DEV mock：顶栏信封红点 3（关注 + 关注课评）",
          href: "/courses?preview=notices-badge",
          access: "login",
        },
        {
          id: "notices-badge-zero",
          title: "消息已读",
          description: "DEV mock：顶栏信封无角标",
          href: "/courses?preview=notices-badge-zero",
          access: "login",
        },
        {
          id: "notices-error",
          title: "消息下拉 · 加载失败",
          description: "DEV mock：顶栏下拉「消息暂时加载不了」",
          href: "/courses?preview=notices-error",
          access: "login",
        },
        {
          id: "account",
          title: "账号 · 未登录",
          description: "DEV mock：访客账号卡（登录后默认进个人主页）",
          href: "/account?preview=guest",
          access: "public",
        },
      ],
    },
    {
      id: "admin",
      title: "管理后台",
      hint: "先本地测试登录。允许名单为空时打开 /admin 即成首位管理员。图集入口不拦门禁卡；权限不足见「无权」入口。",
      pages: [
        {
          id: "admin-forbidden",
          title: "管理后台 · 无权",
          description: "DEV mock：当前身份不是管理员",
          href: "/admin?preview=forbidden",
          access: "public",
        },
        {
          id: "admin-hub",
          title: "管理首页",
          description: "Banner、学号绑定、体育专项收口、目录补充、禁言入口",
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
          id: "admin-pe-queue",
          title: "体育专项收口",
          description: "历史未映射伞形课处置队列",
          href: "/admin/pe-queue",
          access: "admin",
        },
        {
          id: "admin-catalog-requests",
          title: "目录补充申请",
          description: "审核课程/教师补充；体育课指定专项",
          href: "/admin/catalog-requests",
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
