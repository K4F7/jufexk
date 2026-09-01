import {
  defaultAvatarKey,
  formatPublicCode,
  formatPublicHandle,
  RESERVED_PUBLIC_CODE,
} from "../public-handle";
import { AnonymousAvatar } from "./AnonymousAvatar";
import { RouterAriaLink } from "./RouterAriaLink";

export function ReviewAuthor({
  publicCode,
  avatarKey,
  size = "sm",
  layout = "inline",
  className,
}: {
  publicCode?: number | null;
  avatarKey?: number | null;
  size?: "sm" | "md" | "lg";
  /** `baseline` keeps the handle on the surrounding line's baseline. */
  layout?: "inline" | "responsive" | "baseline";
  className?: string;
}) {
  const code = publicCode ?? RESERVED_PUBLIC_CODE;
  const key = avatarKey ?? defaultAvatarKey(code);
  const handle = formatPublicHandle(code);
  const avatar = (
    <AnonymousAvatar
      avatarKey={key}
      size={size}
      className={
        layout === "baseline"
          ? "mr-2 inline-flex shrink-0 align-middle"
          : "shrink-0"
      }
    />
  );
  const layoutClass =
    layout === "responsive"
      ? "inline-flex min-w-0 max-w-full flex-col items-start gap-1.5 leading-none text-accent no-underline max-sm:min-h-[44px] sm:flex-row sm:items-center sm:gap-2"
      : layout === "baseline"
        ? "inline min-w-0 max-w-full text-accent no-underline"
        : "inline-flex min-w-0 max-w-full items-center gap-2 text-accent no-underline";
  return (
    <RouterAriaLink
      to={`/u/${formatPublicCode(code)}`}
      aria-label={handle}
      className={className ? `${layoutClass} ${className}` : layoutClass}
    >
      {layout === "responsive" ? (
        <>
          <span className="order-2 sm:order-1">{avatar}</span>
          <span className="order-1 min-w-0 break-words [overflow-wrap:anywhere] text-[calc(13/15*1rem)] font-medium leading-none sm:order-2 sm:text-[calc(15/15*1rem)] sm:font-normal">
            {handle}
          </span>
        </>
      ) : (
        <>
          {avatar}
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            {handle}
          </span>
        </>
      )}
    </RouterAriaLink>
  );
}
