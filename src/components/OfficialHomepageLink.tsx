import { Card, Link } from "@heroui/react";
import { RouterAriaLink } from "./RouterAriaLink";

/**
 * 教师主页链接：跟院系同一套 Card.Description 字号，单行超出省略。
 * CTA 绝对 URL 不走 RouterProvider；站内地址走 React Router。
 */
export function OfficialHomepageLink({
  href,
  displayHref,
  external = true,
}: {
  href: string;
  displayHref?: string;
  external?: boolean;
}) {
  const urlText = displayHref ?? href;
  const label = `教师主页：${urlText}`;
  const urlClassName =
    "card__description m-0 min-w-0 max-w-full truncate p-0 font-normal text-accent";

  const url = external ? (
    <Link
      className={urlClassName}
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
      {urlText}
    </Link>
  ) : (
    <RouterAriaLink aria-label={label} className={urlClassName} to={href}>
      {urlText}
    </RouterAriaLink>
  );

  return (
    <Card.Description className="flex w-full min-w-0 items-baseline justify-start text-left">
      <span className="shrink-0">教师主页：</span>
      {url}
    </Card.Description>
  );
}

/** 院系下方那一行：有 CTA 用官方主页，否则用站内教师页。 */
export function TeacherHomepageLine({
  teacherId,
  officialUrl,
}: {
  teacherId: number;
  officialUrl?: string | null;
}) {
  if (officialUrl) {
    return <OfficialHomepageLink href={officialUrl} />;
  }
  const path = `/teachers/${teacherId}`;
  const display =
    typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  return (
    <OfficialHomepageLink
      displayHref={display}
      external={false}
      href={path}
    />
  );
}
