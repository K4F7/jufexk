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
        <Typography.Prose className="mt-3 flex flex-col gap-3 text-pretty break-words [overflow-wrap:anywhere] sm:mt-4">
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
      className="break-all [overflow-wrap:anywhere] max-sm:max-w-full"
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
        以前的江财课评站和腾讯文档都停止更新了，我又特别需要这个，所以就做了
      </p>
    </SiteInfoPage>
  );
}

export function ContactPage() {
  return (
    <SiteInfoPage title="反馈问题">
      <p>
        网站功能问题和建议去提issue{" "}
        <ExternalLink href={GITHUB_ISSUES_URL}>GitHub 开个 issue</ExternalLink>{" "}
        就行。
      </p>
      <p>
        投诉评论问题，发邮件{" "}
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
      <p>站点和学校官方无关。评价都是由学生写的，仅供参考。</p>
      <p>
        请不要发布违规内容，人身攻击，过激的言论，请使用平缓的语言，便于大家的参考。
      </p>
    </SiteInfoPage>
  );
}
