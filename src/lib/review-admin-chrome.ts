/**
 * 课程页点评 / 回复管理动作的显示偏好：默认关闭，普通浏览不渲染
 * ReviewAdminControls 与 preview `viewerOwned` 的回复删除。
 * 管理员经侧面 dock 打开后，写入 sessionStorage。
 * 只覆盖点评屏蔽 / 查作者 / 删除与回复删除。
 * 课评页「管理员公告」仍只看管理员会话，不读这个开关。
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

/** 开关关闭时隐藏点评上的管理动作。`preview=admin` 不强制打开。 */
export function resolveReviewAdminChromeVisible(options: {
  storedOn: boolean;
}): boolean {
  return options.storedOn;
}

/**
 * 回复行「删除」：作者删自己的回复始终可见；preview `viewerOwned`
 * （演示管理删除、不匹配当前 handle）跟 dock 开关。
 */
export function resolveCommentDeleteVisible(options: {
  showAdminControls: boolean;
  viewerPublicCode: number | null;
  authorPublicCode: number;
  viewerOwned?: boolean;
}): boolean {
  if (
    options.viewerPublicCode != null &&
    options.authorPublicCode === options.viewerPublicCode
  ) {
    return true;
  }
  return options.showAdminControls && options.viewerOwned === true;
}
