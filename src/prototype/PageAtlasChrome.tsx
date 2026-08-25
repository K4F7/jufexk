/**
 * DEV 常驻出口：从任意真实页面回到页面图集。
 */
import { Link, buttonVariants } from "@heroui/react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import { ATLAS_GALLERY_HREF, ATLAS_PARAM } from "./page-atlas";

export function PageAtlasChrome() {
  const location = useLocation();
  if (location.pathname === "/prototype") return null;
  const fromAtlas = new URLSearchParams(location.search).get(ATLAS_PARAM) === "1";

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[100]">
      <Link
        className={`${buttonVariants({
          size: "sm",
          variant: fromAtlas ? "primary" : "secondary",
        })} pointer-events-auto no-underline`}
        href={ATLAS_GALLERY_HREF}
        render={(domProps) => {
          const target = new URL(ATLAS_GALLERY_HREF, "http://local.invalid");
          return (
            <RouterLink
              {...(domProps as object)}
              className={
                typeof domProps.className === "string"
                  ? domProps.className
                  : undefined
              }
              to={{
                pathname: target.pathname,
                search: target.search,
                hash: target.hash,
              }}
            />
          );
        }}
      >
        {fromAtlas ? "返回页面图集" : "页面图集"}
      </Link>
    </div>
  );
}
