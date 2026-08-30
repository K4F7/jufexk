import { Typography } from "@heroui/react";
import type { ReactNode } from "react";

/** 教师卡姓名：与课评页老师名同一套字号字重。 */
export function TeacherIdentityName({
  children,
  as = "span",
}: {
  children: ReactNode;
  as?: "h1" | "span";
}) {
  return (
    <Typography
      className="m-0 min-w-0 break-words text-[calc(18/15*1rem)] font-bold leading-tight"
      render={
        as === "span"
          ? ({ children: node, ...domProps }) => (
              <span {...domProps}>{node}</span>
            )
          : undefined
      }
      type="h1"
    >
      {children}
    </Typography>
  );
}
