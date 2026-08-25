import { describe, expect, it } from "vitest";
import {
  hasSeenScheduleMobileNotice,
  markScheduleMobileNoticeSeen,
  SCHEDULE_MOBILE_NOTICE_KEY,
} from "../src/lib/schedule-mobile-notice";

describe("schedule mobile notice storage", () => {
  it("treats missing or other values as unseen, and remembers after mark", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };

    expect(hasSeenScheduleMobileNotice(undefined)).toBe(false);
    expect(hasSeenScheduleMobileNotice(storage)).toBe(false);

    store.set(SCHEDULE_MOBILE_NOTICE_KEY, "0");
    expect(hasSeenScheduleMobileNotice(storage)).toBe(false);

    markScheduleMobileNoticeSeen(storage);
    expect(store.get(SCHEDULE_MOBILE_NOTICE_KEY)).toBe("1");
    expect(hasSeenScheduleMobileNotice(storage)).toBe(true);
  });
});
