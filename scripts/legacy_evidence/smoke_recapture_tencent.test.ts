import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodePng, evaluateComposition, type RgbaImage } from "./composition_qa";
import { createTencentSmokeRowCaptureSource } from "./smoke_recapture_tencent";

describe("tencent smoke composition source", () => {
  it("locates through the address box, arrows right, and writes distinct formula/cell clips", async () => {
    const actions: string[] = [];
    const source = createSource(actions);
    await source.assertViewOnly();
    await source.locateByAddressBox("D6");
    await source.moveRight();
    const formula = await source.grabFormulaImage("E6");
    const cell = await source.grabCellImage("E6");
    expect(actions.filter((action) => action.startsWith("write:"))).toEqual([]);
    const writtenFormula = await source.writeFrozenImage({ filename: "E6-formula.jpg", bytes: formula.bytes });
    const writtenCell = await source.writeFrozenImage({ filename: "E6-cell.jpg", bytes: cell.bytes });

    expect(actions).toEqual([
      "role:button:只能查看:true",
      "role:button:体育课:true",
      "fill:D6",
      "press:Enter",
      "key:ArrowRight",
      "clip:formula",
      "clip:cell",
      "write:E6-formula.jpg",
      "write:E6-cell.jpg",
    ]);
    expect(writtenFormula.sha256).not.toBe(writtenCell.sha256);
    expect(actions.some((action) => action.startsWith("click:"))).toBe(false);
  });

  it("refuses to locate when the sheet is not view-only", async () => {
    const actions: string[] = [];
    const source = createSource(actions, { viewOnly: false });
    await expect(source.locateByAddressBox("D6")).rejects.toThrow("Tencent sheet is not visibly read-only");
    expect(actions).not.toContain("fill:D6");
  });

  it("grabs formula/cell frames without writing until composition QA accepts", async () => {
    const actions: string[] = [];
    const source = createSource(actions);
    const formula = await source.grabFormulaImage("E6");
    const cell = await source.grabCellImage("E6");
    expect(actions.filter((action) => action.startsWith("write:"))).toEqual([]);
    expect(formula.method).toBe("playwright_page");
    expect(cell.method).toBe("playwright_page");
    const written = await source.writeFrozenImage({ filename: "E6-formula.jpg", bytes: formula.bytes });
    expect(actions).toContain("write:E6-formula.jpg");
    expect(written.sha256).toBe(sha(formula.bytes));
  });

  it("crops PrintWindow frames instead of a desktop composite", async () => {
    const actions: string[] = [];
    const source = createSource(actions, {
      grabWindow: async () => ({
        method: "print_window" as const,
        png: encodePng(sheetWindowImage()),
        width: 320,
        height: 520,
      }),
    });
    const formula = await source.grabFormulaImage("D13");
    const cell = await source.grabCellImage("D13");
    expect(formula.method).toBe("print_window");
    expect(cell.method).toBe("print_window");
    expect(actions.some((action) => action.startsWith("clip:"))).toBe(false);
    const qa = evaluateComposition({
      observation: {
        target_address: "D13",
        active_address: "D13",
        view_only_visible: true,
        address_box_present: true,
        formula_bar_reads: ["老师挺负责", "老师挺负责"],
        formula_bar_record_sha256: "keep",
      },
      formula,
      cell,
    });
    expect(qa.status).toBe("accepted");
    expect(qa.rewrite_source_json).toBe(false);
    expect(qa.formula_bar_record_sha256).toBe("keep");
  });

  it("can raise the formula bar and detect remaining DOM truncation", async () => {
    const actions: string[] = [];
    const source = createSource(actions);
    await source.expandFormulaBar?.();
    await expect(source.isFormulaBarTruncated?.()).resolves.toBe(true);
    expect(actions).toContain("formula-eval");
  });
});

function createSource(actions: string[], options: {
  viewOnly?: boolean;
  grabWindow?: () => Promise<{ method: "print_window"; png: Uint8Array; width: number; height: number }>;
} = {}) {
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
    grabWindow: options.grabWindow,
  });
}

function paint(width: number, height: number, color: (x: number, y: number) => [number, number, number]): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = color(x, y);
      const index = (y * width + x) * 4;
      rgba[index] = r;
      rgba[index + 1] = g;
      rgba[index + 2] = b;
      rgba[index + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function sheetWindowImage(): RgbaImage {
  return paint(400, 600, (x, y) => {
    if (y < 80) return [245, 246, 248];
    if (y < 400) {
      if (x >= 12 && x <= 70 && y >= 96 && y <= 118) return [255, 255, 255];
      if (x >= 80 && x <= 240 && y >= 96 && y <= 122) return [252, 252, 252];
      return [236, 238, 241];
    }
    if (y >= 544) return [236, 238, 241];
    if (x % 40 < 2 || (y - 400) % 28 < 2) return [90, 96, 104];
    return [255, 255, 255];
  });
}

function sha(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
