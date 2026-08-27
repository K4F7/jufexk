import { Link, Typography } from "@heroui/react";
import type { ReactNode } from "react";
import {
  CONTACT_EMAIL,
  GITHUB_ISSUES_URL,
  SITE_OFFICIAL_CHANNELS,
} from "../lib/site-links";

function SiteInfoPage({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className="mx-auto max-w-[860px]">
      <Typography className="m-0 text-[22px] font-bold" type="h1">
        {title}
      </Typography>
      {children ? (
        <Typography.Prose className="mt-4 flex flex-col gap-3">
          {children}
        </Typography.Prose>
      ) : null}
    </section>
  );
}

/**
 * HeroUI Link styled as an external control, but rendered as a native <a>.
 * Absolute URLs must not go through RouterProvider (see AppShell 导师).
 */
function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      rel="noreferrer"
      render={(domProps) => (
        <a
          {...(domProps as object)}
          className={
            typeof domProps.className === "string"
              ? domProps.className
              : undefined
          }
          href={href}
          rel="noreferrer"
          target="_blank"
        />
      )}
      target="_blank"
    >
      {children}
      <Link.Icon />
    </Link>
  );
}

export function AboutPage() {
  return <SiteInfoPage title="关于我们" />;
}

export function ContactPage() {
  return (
    <SiteInfoPage title="反馈问题">
      <p>
        功能建议、缺陷和站点问题，请优先在 GitHub 开
        issue，也可以发邮件。请走这些公开渠道，不要另找未公开的联系方式。
      </p>
      <p>
        <ExternalLink href={GITHUB_ISSUES_URL}>前往 GitHub Issues</ExternalLink>
      </p>
      <p>
        {/* 原生 mailto：HeroUI Link 会走 RouterProvider，把协议当成站内路径。 */}
        <a className="link" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
      </p>
    </SiteInfoPage>
  );
}

export function ResourcesPage() {
  return (
    <SiteInfoPage title="友情链接">
      <p>学校官方频道：</p>
      <ul>
        {SITE_OFFICIAL_CHANNELS.map((item) => (
          <li key={item.href}>
            <ExternalLink href={item.href}>{item.title}</ExternalLink>
          </li>
        ))}
        <li>教务处微信公众号：jxufe-jwc</li>
      </ul>
    </SiteInfoPage>
  );
}

export function TermsPage() {
  return (
    <SiteInfoPage title="使用条款">
      <p>
        使用本站即表示你理解：本站是非官方服务，目录与任课评价不构成学校官方意见，也不作为选课、成绩或教学安排的依据。
      </p>
      <p>
        任课评价匿名公开。禁止发布违法内容、人身攻击或可识别他人身份的信息。站方可以拒绝、编辑或撤回公开内容。
      </p>
      <p>
        站点软件以 MIT License 发布。公开内容来自任课评价与已审核的历史评价；本站不保证其完整或准确。
      </p>
    </SiteInfoPage>
  );
}
