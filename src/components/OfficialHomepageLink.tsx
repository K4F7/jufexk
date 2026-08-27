import { Link } from "@heroui/react";

/**
 * CTA 教师主页外链。绝对 URL 不走 RouterProvider。
 * 文案左对齐，完整地址跟在「教师主页：」后面。
 */
export function OfficialHomepageLink({ href }: { href: string }) {
  return (
    <Link
      className="max-w-full justify-start whitespace-normal break-all"
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
      教师主页：{href}
      <Link.Icon />
    </Link>
  );
}
