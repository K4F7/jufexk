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

export function AnonymousAvatar({
  seed,
  size = "sm",
  fallback = "匿",
  className,
}: {
  seed: string | number;
  size?: "sm" | "md" | "lg";
  fallback?: string;
  className?: string;
}) {
  return (
    <Avatar size={size} className={className} aria-hidden>
      <Avatar.Image alt="" src={placeholderAvatarSrc(seed)} />
      <Avatar.Fallback>{fallback}</Avatar.Fallback>
    </Avatar>
  );
}
