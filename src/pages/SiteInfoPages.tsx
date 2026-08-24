import { Typography } from "@heroui/react";
import type { ReactNode } from "react";
import {
  GITHUB_ISSUES_URL,
  GITHUB_REPO_URL,
  SITE_RESOURCES,
} from "../lib/site-links";

function SiteInfoPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto max-w-[860px]">
      <Typography className="m-0 text-[22px] font-bold" type="h1">
        {title}
      </Typography>
      <Typography.Prose className="mt-4 flex flex-col gap-3">
        {children}
      </Typography.Prose>
    </section>
  );
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a className="link" href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  );
}

export function AboutPage() {
  return (
    <SiteInfoPage title="关于我们">
      <p>
        本站是江西财经大学非官方课程—教师评价站，站内名称「非官方课评@JUFE」。本站不是学校官方服务，也不代表学校立场。
      </p>
      <p>
        任课评价必须绑定课程的具体任课教师，公开内容均经人工审核后匿名公开。目录来自获授权采集的可见开课全量，不宣称包含从未开设、未发布或无权查看的对象。
      </p>
    </SiteInfoPage>
  );
}

export function ContactPage() {
  return (
    <SiteInfoPage title="联系我们">
      <p>
        公开联系渠道是 GitHub Issues。功能建议、缺陷报告和站点问题请在仓库开 issue，不要通过未公布的邮箱或即时通讯号联系。
      </p>
      <p>
        <ExternalLink href={GITHUB_ISSUES_URL}>前往 GitHub Issues</ExternalLink>
      </p>
    </SiteInfoPage>
  );
}

export function ResourcesPage() {
  return (
    <SiteInfoPage title="资源">
      <p>本站源码与 issue 在 GitHub 公开：</p>
      <p>
        <ExternalLink href={GITHUB_REPO_URL}>{GITHUB_REPO_URL}</ExternalLink>
      </p>
      <p>产品与实现受益于这些公开工作：</p>
      <ul>
        {SITE_RESOURCES.map((item) => (
          <li key={item.href}>
            <ExternalLink href={item.href}>{item.title}</ExternalLink>
            {"extra" in item && item.extra ? (
              <>
                {" "}
                （
                <ExternalLink href={item.extra.href}>
                  {item.extra.title}
                </ExternalLink>
                ）
              </>
            ) : null}
            ：{item.note}
          </li>
        ))}
      </ul>
      <p>文案、品牌与数据模型均为本站自有；参考的是交互与协议，不是复制站点内容。</p>
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
        任课评价经审核后匿名公开。禁止发布违法内容、人身攻击或可识别他人身份的信息。站方可以拒绝、编辑或撤回公开内容。
      </p>
      <p>
        站点软件以 MIT License 发布。目录来自获授权采集的可见开课全量，公开内容来自任课评价与已审核的历史评价；本站不保证其完整或准确。
      </p>
    </SiteInfoPage>
  );
}
