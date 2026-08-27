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
}: {
  publicCode?: number | null;
  avatarKey?: number | null;
  size?: "sm" | "md" | "lg";
  layout?: "inline" | "responsive";
}) {
  const code = publicCode ?? RESERVED_PUBLIC_CODE;
  const key = avatarKey ?? defaultAvatarKey(code);
  const handle = formatPublicHandle(code);
  const avatar = (
    <AnonymousAvatar avatarKey={key} size={size} className="shrink-0" />
  );
  return (
    <RouterAriaLink
      to={`/u/${formatPublicCode(code)}`}
      aria-label={handle}
      className={
        layout === "responsive"
          ? "inline-flex flex-col items-start gap-1.5 leading-none text-accent no-underline sm:flex-row sm:items-center sm:gap-2"
          : "inline-flex items-center gap-2 leading-none text-accent no-underline"
      }
    >
      {layout === "responsive" ? (
        <>
          <span className="order-2 sm:order-1">{avatar}</span>
          <span className="order-1 text-[calc(13/15*1rem)] font-medium leading-none sm:order-2 sm:text-[calc(15/15*1rem)] sm:font-normal">
            {handle}
          </span>
        </>
      ) : (
        <>
          {avatar}
          <span className="leading-none">{handle}</span>
        </>
      )}
    </RouterAriaLink>
  );
}
