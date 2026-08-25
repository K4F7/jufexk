/** 排课模拟只做电脑端：窄屏首次进入记一次已读。 */

export const SCHEDULE_MOBILE_NOTICE_KEY = "jufexk-schedule-mobile-notice";
export const SCHEDULE_MOBILE_QUERY = "(max-width: 639px)";

export function hasSeenScheduleMobileNotice(
  storage: Pick<Storage, "getItem"> | null | undefined,
): boolean {
  return storage?.getItem(SCHEDULE_MOBILE_NOTICE_KEY) === "1";
}

export function markScheduleMobileNoticeSeen(
  storage: Pick<Storage, "setItem"> | null | undefined,
): void {
  storage?.setItem(SCHEDULE_MOBILE_NOTICE_KEY, "1");
}
