import { Link, Typography } from "@heroui/react";
import type { ReactNode } from "react";
import {
  CONTACT_EMAIL,
  GITHUB_ISSUES_URL,
  JUFE_QQ_CHANNEL_URL,
} from "../lib/site-links";

function SiteInfoPage({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-[860px]">
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
  return (
    <SiteInfoPage title="关于我们">
      <p>
        先前学长学姐做的课评站停了，后来还能看的那张在线表格也不再更新。
      </p>
      <p>假期里就想着，干脆自己写一个。</p>
    </SiteInfoPage>
  );
}

export function ContactPage() {
  return (
    <SiteInfoPage title="反馈问题">
      <p>
        网站功能有问题或想提建议，去{" "}
        <ExternalLink href={GITHUB_ISSUES_URL}>GitHub 开个 issue</ExternalLink>{" "}
        就行。
      </p>
      <p>
        要投诉某条评论，发邮件到{" "}
        {/* 原生 mailto：HeroUI Link 会走 RouterProvider，把协议当成站内路径。 */}
        <a className="link" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>{"。"}
      </p>
    </SiteInfoPage>
  );
}

export function ResourcesPage() {
  return (
    <SiteInfoPage title="友情链接">
      <p>
        学校官方频道：
        <ExternalLink href={JUFE_QQ_CHANNEL_URL}>
          {JUFE_QQ_CHANNEL_URL}
        </ExternalLink>
      </p>
    </SiteInfoPage>
  );
}

export function TermsPage() {
  return (
    <SiteInfoPage title="使用条款">
      <p>本站和学校官方无关。上面的评价都是学生写的，仅供参考。</p>
      <p>
        请不要发布违法内容。这里没有事先审核，不过我们仍可以删帖、禁言。
      </p>
    </SiteInfoPage>
  );
}
