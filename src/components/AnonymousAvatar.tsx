import { Avatar } from "@heroui/react";

export const HEROUI_AVATAR_PLACEHOLDERS = [
  "https://heroui-assets.nyc3.cdn.digitaloceanspaces.com/avatars/blue.jpg",
  "https://heroui-assets.nyc3.cdn.digitaloceanspaces.com/avatars/green.jpg",
  "https://heroui-assets.nyc3.cdn.digitaloceanspaces.com/avatars/purple.jpg",
  "https://heroui-assets.nyc3.cdn.digitaloceanspaces.com/avatars/orange.jpg",
  "https://heroui-assets.nyc3.cdn.digitaloceanspaces.com/avatars/red.jpg",
] as const;

function seedHash(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function placeholderAvatarSrc(seed: string | number): string {
  return HEROUI_AVATAR_PLACEHOLDERS[
    seedHash(String(seed)) % HEROUI_AVATAR_PLACEHOLDERS.length
  ];
}

export function officialAvatarSrc(avatarKey: number): string {
  const index =
    ((avatarKey % HEROUI_AVATAR_PLACEHOLDERS.length) +
      HEROUI_AVATAR_PLACEHOLDERS.length) %
    HEROUI_AVATAR_PLACEHOLDERS.length;
  return HEROUI_AVATAR_PLACEHOLDERS[index];
}

export function AnonymousAvatar({
  seed,
  avatarKey,
  photoSrc,
  size = "sm",
  fallback = "匿",
  className,
}: {
  seed?: string | number;
  avatarKey?: number;
  /** 教师公开头像；缺省或 CTA 默认剪影未入库时仍走 HeroUI 占位图。 */
  photoSrc?: string | null;
  size?: "sm" | "md" | "lg";
  fallback?: string;
  className?: string;
}) {
  const src =
    photoSrc ||
    (avatarKey != null
      ? officialAvatarSrc(avatarKey)
      : placeholderAvatarSrc(seed ?? 0));
  return (
    <Avatar size={size} className={className} aria-hidden>
      <Avatar.Image alt="" src={src} />
      <Avatar.Fallback>{fallback}</Avatar.Fallback>
    </Avatar>
  );
}
