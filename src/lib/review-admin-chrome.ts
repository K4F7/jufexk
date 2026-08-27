/**
 * 课程页点评管理动作的显示偏好：默认关闭，普通浏览不渲染
 * ReviewAdminControls。管理员经侧面 dock 打开后，写入 sessionStorage。
 * DEV `?preview=admin` 与公告栏一致，视为「展示管理 chrome」。
 */

export const REVIEW_ADMIN_CHROME_STORAGE_KEY = "jufexk-review-admin-chrome";

export function isAdminChromePreview(preview: string | null): boolean {
  return preview === "admin";
}

export function reviewAdminSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

export function readReviewAdminChromeVisible(
  storage: Pick<Storage, "getItem"> | null | undefined,
): boolean {
  return storage?.getItem(REVIEW_ADMIN_CHROME_STORAGE_KEY) === "1";
}

export function writeReviewAdminChromeVisible(
  storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined,
  visible: boolean,
): void {
  if (!storage) return;
  if (visible) storage.setItem(REVIEW_ADMIN_CHROME_STORAGE_KEY, "1");
  else storage.removeItem(REVIEW_ADMIN_CHROME_STORAGE_KEY);
}

/** 管理员会话，或 DEV 预览明确要求展示管理 chrome。非管理员永不出现。 */
export function resolveReviewAdminDockVisible(options: {
  adminAuthed: boolean;
  preview: string | null;
}): boolean {
  return options.adminAuthed || isAdminChromePreview(options.preview);
}

/** 开关关闭时隐藏点评上的管理动作；`preview=admin` 强制打开。 */
export function resolveReviewAdminChromeVisible(options: {
  storedOn: boolean;
  preview: string | null;
}): boolean {
  return isAdminChromePreview(options.preview) || options.storedOn;
}
