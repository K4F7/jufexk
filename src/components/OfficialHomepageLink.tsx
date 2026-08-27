import { Link } from "@heroui/react";

/**
 * CTA 官方教师主页外链。绝对 URL 不走 RouterProvider。
 */
export function OfficialHomepageLink({ href }: { href: string }) {
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
      官方主页
      <Link.Icon />
    </Link>
  );
}
