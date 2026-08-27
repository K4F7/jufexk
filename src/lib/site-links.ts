/** Public GitHub surfaces used by the footer and site-info pages. */
export const GITHUB_REPO_URL = "https://github.com/K4F7/jufexk";
export const GITHUB_ISSUES_URL = "https://github.com/K4F7/jufexk/issues";
export const CONTACT_EMAIL = "nonsein@foxmail.com";

/** Better Stack public status page and embeddable badge. */
export const STATUS_PAGE_URL = "https://xk-jxufe.betteruptime.com";

export function statusBadgeUrl(theme: "light" | "dark"): string {
  return `${STATUS_PAGE_URL}/badge?theme=${theme}`;
}

/** Official JUFE channels listed on /resources. */
export const SITE_OFFICIAL_CHANNELS = [
  { href: "https://www.jxufe.edu.cn/", title: "学校官网" },
  { href: "https://jwc.jxufe.edu.cn/", title: "教务处" },
  { href: "http://xk.jxufe.edu.cn/", title: "选课平台" },
  { href: "http://ehall.jxufe.edu.cn/", title: "智慧江财" },
  { href: "https://jwxt.jxufe.edu.cn/jxcjcaslogin", title: "本科教务" },
] as const;
