import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  buildJwxtSyncBundle,
  validateJwxtSyncBundle,
} from "../scripts/jwxt-sync/bundle";

const capture = {
  capturedAt: "2026-08-26T00:00:00.000Z",
  complete: true,
  offerings: [
    {
      courseCode: "10100001",
      courseName: "高等数学",
      section: "A-01",
      teacherName: "教师甲",
      termId: "2026-2027-1",
      campus: "麦庐园",
      weekText: "1-16周",
      timeText: "星期一 第1-2节",
      place: "一教101",
      capacityLimit: 60,
      capacitySelected: 58,
      capacityAvailable: 2,
    },
  ],
};

describe("JWXT sync bundle", () => {
  it("is deterministic and strips enrollment counts before R2 packaging", () => {
    const first = buildJwxtSyncBundle(capture, "full");
    const second = buildJwxtSyncBundle(capture, "full");

    expect(first.manifest.generationId).toBe(second.manifest.generationId);
    expect(first.manifest.contentSha256).toBe(second.manifest.contentSha256);
    expect(first.manifest.rowCount).toBe(1);
    const ndjson = gunzipSync(first.compressedRows).toString("utf8");
    expect(ndjson).toContain('"classNumber":"A-01"');
    expect(ndjson).not.toMatch(/capacity|selected|available/i);
    expect(validateJwxtSyncBundle(first.manifest, first.compressedRows)).toHaveLength(1);
  });

  it("fails closed when a source field resembles a credential", () => {
    expect(() =>
      buildJwxtSyncBundle(
        {
          ...capture,
          offerings: [{ ...capture.offerings[0], place: "Cookie: JSESSIONID=secret" }],
        },
        "pilot",
      ),
    ).toThrow(/敏感/);
  });

  it("rejects tampered compressed packages", () => {
    const bundle = buildJwxtSyncBundle(capture, "incremental");
    const tampered = Buffer.concat([bundle.compressedRows, Buffer.from("tampered")]);
    expect(() => validateJwxtSyncBundle(bundle.manifest, tampered)).toThrow(/校验/);
  });
});
