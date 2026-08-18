import { Link } from "@heroui/react";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";

/**
 * HeroUI Link navigating via React Router (keyboard / new-tab safe).
 * Stops click propagation so an enclosing table-row href does not double-fire.
 */
export function RouterAriaLink({
  to,
  className,
  children,
  "aria-label": ariaLabel,
  "aria-current": ariaCurrent,
}: {
  to: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-current"?: "page" | "true" | "false";
}) {
  return (
    <Link
      href={to}
      className={className}
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
      render={(domProps) => (
        <RouterLink
          {...(domProps as object)}
          to={to}
          className={
            typeof domProps.className === "string"
              ? domProps.className
              : undefined
          }
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            (
              domProps as { onClick?: (ev: React.MouseEvent) => void }
            ).onClick?.(e);
          }}
        />
      )}
    >
      {children}
    </Link>
  );
}
