import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTencentSmokeRowCaptureSource } from "./smoke_recapture_tencent";

describe("tencent smoke composition source", () => {
  it("locates through the address box, arrows right, and writes distinct formula/cell clips", async () => {
    const actions: string[] = [];
    const source = createSource(actions);
    await source.assertViewOnly();
    await source.locateByAddressBox("D6");
    await source.moveRight();
    const formula = await source.captureFormulaImage("E6");
    const cell = await source.captureCellImage("E6");

    expect(actions).toEqual([
      "role:button:只能查看:true",
      "role:button:体育课:true",
      "fill:D6",
      "press:Enter",
      "key:ArrowRight",
      "clip:formula",
      "write:E6-formula.jpg",
      "clip:cell",
      "write:E6-cell.jpg",
    ]);
    expect(formula.sha256).not.toBe(cell.sha256);
    expect(actions.some((action) => action.startsWith("click:"))).toBe(false);
  });

  it("refuses to locate when the sheet is not view-only", async () => {
    const actions: string[] = [];
    const source = createSource(actions, { viewOnly: false });
    await expect(source.locateByAddressBox("D6")).rejects.toThrow("Tencent sheet is not visibly read-only");
    expect(actions).not.toContain("fill:D6");
  });

  it("can raise the formula bar and detect remaining DOM truncation", async () => {
    const actions: string[] = [];
    const source = createSource(actions);
    await source.expandFormulaBar?.();
    await expect(source.isFormulaBarTruncated?.()).resolves.toBe(true);
    expect(actions).toContain("formula-eval");
  });
});

function createSource(actions: string[], options: { viewOnly?: boolean } = {}) {
  const viewOnly = options.viewOnly ?? true;
  const addressLocator = {
    count: async () => 1,
    fill: async (value: string) => { actions.push(`fill:${value}`); },
    press: async (key: string) => { actions.push(`press:${key}`); },
    evaluate: async () => "D6",
    boundingBox: async () => ({ x: 10, y: 20, width: 80, height: 24 }),
  };
  const formulaLocator = {
    count: async () => 1,
    textContent: async () => "给分好",
    getAttribute: async () => "false",
    boundingBox: async () => ({ x: 100, y: 18, width: 400, height: 28 }),
    evaluate: async (callback: (element: { scrollHeight: number; clientHeight: number; style: { height?: string; minHeight?: string } }) => unknown) => {
      actions.push("formula-eval");
      return callback({ scrollHeight: 180, clientHeight: 28, style: {} });
    },
  };
  return createTencentSmokeRowCaptureSource({
    tab: {
      playwright: {
        locator: (selector: string) => selector === "input.bar-label" ? addressLocator : formulaLocator,
        getByRole: (role: string, roleOptions: { name: string; exact: boolean }) => {
          actions.push(`role:${role}:${roleOptions.name}:${roleOptions.exact}`);
          if (roleOptions.name === "只能查看") {
            return { count: async () => viewOnly ? 1 : 0, isVisible: async () => viewOnly, boundingBox: async () => ({ x: 700, y: 10, width: 72, height: 24 }) };
          }
          return { count: async () => 1, isVisible: async () => true, boundingBox: async () => ({ x: 40, y: 60, width: 64, height: 20 }) };
        },
        keyboard: {
          press: async (key: string) => { actions.push(`key:${key}`); },
        },
      },
      screenshot: async ({ clip }) => {
        actions.push(clip ? `clip:${clip.height < 300 ? "formula" : "cell"}` : "full");
        return Uint8Array.from(clip && clip.height < 300 ? [1, 2, 3] : [4, 5, 6, 7]);
      },
    },
    worksheet: "体育课",
    writeScreenshot: async ({ filename, bytes }) => {
      actions.push(`write:${filename}`);
      return { path: filename, sha256: sha(bytes) };
    },
    now: () => "2026-08-18T00:00:00.000Z",
    viewport: async () => ({ width: 2560, height: 1440 }),
  });
}

function sha(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
