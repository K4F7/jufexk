/** Public GitHub surfaces used by the footer and site-info pages. */
export const GITHUB_REPO_URL = "https://github.com/K4F7/jufexk";
export const GITHUB_ISSUES_URL = "https://github.com/K4F7/jufexk/issues";
export const CONTACT_EMAIL = "nonsein@foxmail.com";

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
    note: "课评表单的分段结构、对象绑定与填写节奏是本站投稿问卷的重要参考。",
  },
  {
    href: "https://github.com/USTC-iCourse/ustc-course",
    title: "USTC-iCourse / ustc-course",
    note: "前端信息架构与公开浏览体验大量参考了贵仓库的设计；四道三档题的方向也对齐 iCourse 的四维标签。",
  },
  {
    href: "https://github.com/XiaLing233/tongji-course-scheduler",
    title: "XiaLing233 / tongji-course-scheduler",
    note: "排课模拟参考了贵仓库的选课模拟器；冲突检测与周课表交互节奏从中受益。对象仍是本站课程×教师任课关系，不是开课班目录。",
    extra: { href: "https://xk.xialing.icu", title: "线上演示" },
  },
  {
    href: "https://github.com/SeRazon/jufe_cas",
    title: "SeRazon / jufe_cas",
    note: "江财 CAS 实现。",
  },
] as const;
