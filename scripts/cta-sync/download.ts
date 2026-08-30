import {
  ctaPhotoUrl,
  isDefaultCtaAvatarSha256,
  isDefaultCtaAvatarUrl,
  isUsableCtaPhotoId,
  sha256Hex,
  type CtaTeacherCandidate,
} from "../../src/cta-teacher-homepage";
import type { CtaTeacherClient } from "../../src/cta-teacher-sync";

export type CatalogTeacher = {
  id: number;
  name: string;
  department: string | null;
  avatarUrl: string | null;
};

export type AvatarDownloadResult = {
  sha256: string | null;
  skippedDefaultAvatar: boolean;
  retryable: boolean;
  bytes: Uint8Array | null;
  contentType: string | null;
};

const EMPTY: Omit<AvatarDownloadResult, "skippedDefaultAvatar" | "retryable"> = {
  sha256: null,
  bytes: null,
  contentType: null,
};

export function shouldDownloadAvatar(teacher: {
  avatarUrl?: string | null;
  avatar_url?: string | null;
}): boolean {
  const url = teacher.avatarUrl ?? teacher.avatar_url;
  return typeof url !== "string" || url.trim() === "";
}

export function catalogTeacherFromApi(item: {
  id?: unknown;
  name?: unknown;
  department?: unknown;
  avatar_url?: unknown;
}): CatalogTeacher {
  const avatarUrl =
    typeof item.avatar_url === "string" && item.avatar_url.trim()
      ? item.avatar_url.trim()
      : null;
  return {
    id: Number(item.id),
    name: String(item.name ?? "").trim(),
    department: typeof item.department === "string" ? item.department : null,
    avatarUrl,
  };
}

function failed(result: {
  skippedDefaultAvatar: boolean;
  retryable: boolean;
}): AvatarDownloadResult {
  return { ...EMPTY, ...result };
}

export async function downloadAvatar(
  client: CtaTeacherClient,
  candidate: CtaTeacherCandidate,
): Promise<AvatarDownloadResult> {
  try {
    let photo = candidate.photo;
    if (!isUsableCtaPhotoId(photo)) {
      photo = await client.fetchTeacherPhotoId(candidate.uid);
    }
    const url = ctaPhotoUrl(photo);
    if (!url) {
      return failed({
        skippedDefaultAvatar: Boolean(
          photo &&
            (/defaulticon/i.test(photo) || isDefaultCtaAvatarUrl(photo)),
        ),
        retryable: false,
      });
    }
    if (isDefaultCtaAvatarUrl(url)) {
      return failed({ skippedDefaultAvatar: true, retryable: false });
    }

    let downloaded = await client.fetchPhoto(url);
    if (!downloaded) {
      const detailPhoto = await client.fetchTeacherPhotoId(candidate.uid);
      const detailUrl = ctaPhotoUrl(detailPhoto);
      if (detailUrl && detailUrl !== url) {
        if (isDefaultCtaAvatarUrl(detailUrl)) {
          return failed({ skippedDefaultAvatar: true, retryable: false });
        }
        downloaded = await client.fetchPhoto(detailUrl);
      }
    }
    if (!downloaded) {
      return failed({ skippedDefaultAvatar: false, retryable: true });
    }
    if (isDefaultCtaAvatarUrl(downloaded.url)) {
      return failed({ skippedDefaultAvatar: true, retryable: false });
    }
    const sha = await sha256Hex(downloaded.bytes);
    if (isDefaultCtaAvatarSha256(sha)) {
      return failed({ skippedDefaultAvatar: true, retryable: false });
    }
    return {
      sha256: sha,
      skippedDefaultAvatar: false,
      retryable: false,
      bytes: downloaded.bytes,
      contentType: downloaded.contentType,
    };
  } catch {
    return failed({ skippedDefaultAvatar: false, retryable: true });
  }
}
