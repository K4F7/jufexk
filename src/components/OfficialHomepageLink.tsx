import { Card, Link } from "@heroui/react";

/**
 * 教师主页链接：跟院系同一套 Card.Description 字号，单行超出省略。
 * 只用于 CTA 绝对 URL，新标签打开。
 */
export function OfficialHomepageLink({
  href,
  displayHref,
}: {
  href?: string | null;
  displayHref?: string;
}) {
  if (!href) return null;
  const urlText = displayHref ?? href;
  const urlClassName =
    "card__description m-0 min-w-0 max-w-full truncate p-0 font-normal text-accent";

  return (
    <Card.Description className="flex w-full min-w-0 items-baseline justify-start text-left">
      <span className="shrink-0">教师主页：</span>
      <Link
        aria-label={`教师主页：${urlText}`}
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
    </Card.Description>
  );
}
