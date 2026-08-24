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
}: {
  publicCode?: number | null;
  avatarKey?: number | null;
  size?: "sm" | "md" | "lg";
}) {
  const code = publicCode ?? RESERVED_PUBLIC_CODE;
  const key = avatarKey ?? defaultAvatarKey(code);
  const handle = formatPublicHandle(code);
  return (
    <RouterAriaLink
      to={`/u/${formatPublicCode(code)}`}
      aria-label={handle}
      className="inline-flex items-center gap-2 text-accent no-underline"
    >
      <AnonymousAvatar avatarKey={key} size={size} />
      {handle}
    </RouterAriaLink>
  );
}
