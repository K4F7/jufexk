import {
  defaultAvatarKey,
  formatPublicCode,
  formatPublicHandle,
  RESERVED_PUBLIC_CODE,
} from "../public-handle";
import { AnonymousAvatar } from "./AnonymousAvatar";
import { RouterAriaLink } from "./RouterAriaLink";

function resolveAvatarKey(
  publicCode: number | null | undefined,
  avatarKey: number | null | undefined,
) {
  const code = publicCode ?? RESERVED_PUBLIC_CODE;
  return { code, key: avatarKey ?? defaultAvatarKey(code) };
}

/** 作者公开编号链接——课评流条目把昵称单独放一行时用（头像上方）。 */
export function ReviewAuthorHandle({
  publicCode,
  className = "text-accent no-underline",
}: {
  publicCode?: number | null;
  className?: string;
}) {
  const code = publicCode ?? RESERVED_PUBLIC_CODE;
  const handle = formatPublicHandle(code);
  return (
    <RouterAriaLink
      to={`/u/${formatPublicCode(code)}`}
      aria-label={handle}
      className={className}
    >
      {handle}
    </RouterAriaLink>
  );
}

/** 作者头像（带默认 key 回退），与 ReviewAuthorHandle 可分行组合。 */
export function ReviewAuthorAvatar({
  publicCode,
  avatarKey,
  size = "sm",
}: {
  publicCode?: number | null;
  avatarKey?: number | null;
  size?: "sm" | "md" | "lg";
}) {
  const { key } = resolveAvatarKey(publicCode, avatarKey);
  return <AnonymousAvatar avatarKey={key} size={size} />;
}

export function ReviewAuthor({
  publicCode,
  avatarKey,
  size = "sm",
}: {
  publicCode?: number | null;
  avatarKey?: number | null;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <ReviewAuthorAvatar
        publicCode={publicCode}
        avatarKey={avatarKey}
        size={size}
      />
      <ReviewAuthorHandle publicCode={publicCode} />
    </span>
  );
}
