/** Public GitHub surfaces used by the footer and site-info pages. */
export const GITHUB_REPO_URL = "https://github.com/K4F7/jufexk";
export const GITHUB_ISSUES_URL = "https://github.com/K4F7/jufexk/issues";
export const CONTACT_EMAIL = "nonsein@foxmail.com";

/** Better Stack public status page and embeddable badge. */
export const STATUS_PAGE_URL = "https://xk-jxufe.betteruptime.com";

export function statusBadgeUrl(theme: "light" | "dark"): string {
  return `${STATUS_PAGE_URL}/badge?theme=${theme}`;
}

/** Official JUFE channels listed after the attribution block on /resources. */
export const SITE_OFFICIAL_CHANNELS = [
  { href: "https://www.jxufe.edu.cn/", title: "学校官网" },
  { href: "https://jwc.jxufe.edu.cn/", title: "教务处" },
  { href: "http://xk.jxufe.edu.cn/", title: "选课平台" },
  { href: "http://ehall.jxufe.edu.cn/", title: "智慧江财" },
  { href: "https://jwxt.jxufe.edu.cn/jxcjcaslogin", title: "本科教务" },
] as const;

export const SITE_RESOURCES = [
  {
    href: "https://courses.pinzhixiaoyuan.com/",
    title: "评知校园",
    note: "课评表单的分段和填写节奏参考了这家站点。",
  },
  {
    href: "https://github.com/USTC-iCourse/ustc-course",
    title: "USTC-iCourse / ustc-course",
    note: "公开浏览的页面结构和四维标签参考了这个仓库。",
  },
  {
    href: "https://github.com/XiaLing233/tongji-course-scheduler",
    title: "XiaLing233 / tongji-course-scheduler",
    note: "排课模拟的冲突检测、两步选课和周课表交互参考了这个项目。对象是课号加开课班。",
    extra: { href: "https://xk.xialing.icu", title: "线上演示" },
  },
  {
    href: "https://github.com/SeRazon/jufe_cas",
    title: "SeRazon / jufe_cas",
    note: "江财统一身份登录实现。",
  },
] as const;
