import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cropRgba,
  decodePng,
  encodePng,
  windowCompositionBands,
  type CompositionDomObservation,
  type CompositionFrame,
} from "./composition_qa";
import { TENCENT_SHEET_SELECTORS } from "./formula_bar_tencent";
import type { SmokeImageRef, SmokeRowCaptureSource } from "./smoke_recapture";
import { captureSheetWindowPng } from "./window_capture";

type Locator = {
  count(): Promise<number>;
  fill?(value: string): Promise<void>;
  press?(key: string): Promise<void>;
  evaluate?(callback: (element: any) => unknown): Promise<unknown>;
  textContent?(): Promise<string | null>;
  isVisible?(): Promise<boolean>;
  getAttribute?(name: string): Promise<string | null>;
  boundingBox?(): Promise<{ x: number; y: number; width: number; height: number } | null>;
};

type SmokeTencentTab = {
  playwright: {
    locator(selector: string): Locator;
    getByRole(role: string, options: { name: string; exact: boolean }): Locator;
    keyboard: { press(key: string): Promise<void> };
  };
  screenshot(options: { fullPage: boolean; clip?: { x: number; y: number; width: number; height: number } }): Promise<Uint8Array>;
};

export function createTencentSmokeRowCaptureSource(options: {
  tab: SmokeTencentTab;
  worksheet: string;
  writeScreenshot(input: { filename: string; bytes: Uint8Array }): Promise<SmokeImageRef>;
  now(): string;
  selectWorksheet?(worksheet: string): Promise<void>;
  settle?(): Promise<void>;
  viewport(): Promise<{ width: number; height: number }>;
  hwnd?: string;
  grabWindow?(): Promise<{ method: "print_window"; png: Uint8Array; width: number; height: number }>;
}): SmokeRowCaptureSource {
  const addressBox = options.tab.playwright.locator(TENCENT_SHEET_SELECTORS.addressBox);
  const formulaBar = options.tab.playwright.locator(TENCENT_SHEET_SELECTORS.formulaBar);
  const viewOnly = options.tab.playwright.getByRole("button", { name: "只能查看", exact: true });
  const sheetTab = options.tab.playwright.getByRole("button", { name: options.worksheet, exact: true });

  const requireReadOnly = async () => {
    const viewport = await options.viewport();
    if (viewport.width !== 2560 || viewport.height !== 1440) {
      throw new Error(`smoke capture requires a 2K window, got ${viewport.width}x${viewport.height}`);
    }
    if (await viewOnly.count() !== 1 || !viewOnly.isVisible || !await viewOnly.isVisible()) {
      throw new Error("Tencent sheet is not visibly read-only");
    }
    if (await addressBox.count() !== 1 || !addressBox.fill || !addressBox.press) {
      throw new Error("Tencent sheet address box is unavailable or ambiguous");
    }
    if (await formulaBar.count() !== 1 || !formulaBar.textContent || !formulaBar.getAttribute
      || await formulaBar.getAttribute("contenteditable") !== "false") {
      throw new Error("Tencent sheet formula bar is unavailable or ambiguous");
    }
  };

  const clipUnion = async (kind: "formula" | "cell") => {
    const viewport = await options.viewport();
    const [addressRect, formulaRect, viewOnlyRect, sheetRect] = await Promise.all([
      addressBox.boundingBox?.() ?? Promise.resolve(null),
      formulaBar.boundingBox?.() ?? Promise.resolve(null),
      viewOnly.boundingBox?.() ?? Promise.resolve(null),
      sheetTab.boundingBox?.() ?? Promise.resolve(null),
    ]);
    const chrome = [addressRect, formulaRect, viewOnlyRect].filter((box): box is NonNullable<typeof box> => (
      box !== null && box.width > 0 && box.height > 0
    ));
    if (sheetRect && sheetRect.y < viewport.height * 0.35) chrome.push(sheetRect);
    const formulaBottom = chrome.length === 0
      ? Math.min(220, viewport.height)
      : Math.min(viewport.height, Math.max(...chrome.map((box) => box.y + box.height)) + 16);
    if (kind === "cell") {
      const top = Math.min(formulaBottom, viewport.height - 80);
      return { x: 0, y: top, width: viewport.width, height: viewport.height - top };
    }
    if (chrome.length === 0) return { x: 0, y: 0, width: viewport.width, height: formulaBottom };
    const left = Math.max(0, Math.min(...chrome.map((box) => box.x)) - 16);
    const top = Math.max(0, Math.min(...chrome.map((box) => box.y)) - 16);
    const right = Math.min(viewport.width, Math.max(...chrome.map((box) => box.x + box.width)) + 16);
    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, formulaBottom - top) };
  };

  const grabWindow = options.grabWindow ?? (options.hwnd
    ? async () => {
      const directory = await mkdtemp(join(tmpdir(), "jufexk-print-window-"));
      const outPng = join(directory, "window.png");
      try {
        const captured = await captureSheetWindowPng({ hwnd: options.hwnd!, outPng });
        return {
          method: "print_window" as const,
          png: new Uint8Array(await readFile(captured.path)),
          width: captured.width,
          height: captured.height,
        };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    : undefined);

  const grab = async (kind: "formula" | "cell" | "full"): Promise<CompositionFrame> => {
    if (grabWindow && kind !== "full") {
      const window = await grabWindow();
      if (window.method !== "print_window") {
        throw new Error("sheet window grab must use PrintWindow");
      }
      const image = decodePng(window.png);
      const bands = windowCompositionBands(image.width, image.height);
      return { method: "print_window", bytes: encodePng(cropRgba(image, bands[kind])) };
    }
    const clip = kind === "full" ? undefined : await clipUnion(kind);
    const bytes = await options.tab.screenshot({ fullPage: false, ...(clip ? { clip } : {}) });
    return { method: "playwright_page", bytes };
  };

  const take = async (filename: string, kind: "formula" | "cell" | "full") => {
    const frame = await grab(kind);
    const reference = await options.writeScreenshot({ filename, bytes: frame.bytes });
    if (reference.sha256 !== createHash("sha256").update(frame.bytes).digest("hex")) {
      throw new Error(`smoke screenshot hash mismatch: ${filename}`);
    }
    return reference;
  };

  return {
    async assertViewOnly() {
      await requireReadOnly();
    },
    async selectWorksheet(worksheet) {
      await requireReadOnly();
      await options.selectWorksheet?.(worksheet);
    },
    async locateByAddressBox(address) {
      await requireReadOnly();
      await addressBox.fill!(address);
      await addressBox.press!("Enter");
      await options.settle?.();
    },
    async moveRight() {
      await requireReadOnly();
      await options.tab.playwright.keyboard.press("ArrowRight");
      await options.settle?.();
    },
    async readActiveAddress() {
      if (!addressBox.evaluate) throw new Error("Tencent sheet address box cannot be read");
      return String(await addressBox.evaluate((element) => String(element.value ?? "")));
    },
    async readFormulaBar() {
      if (!formulaBar.textContent) throw new Error("Tencent sheet formula bar cannot be read");
      return (await formulaBar.textContent()) ?? "";
    },
    async grabFormulaImage() {
      return grab("formula");
    },
    async grabCellImage() {
      return grab("cell");
    },
    async writeFrozenImage(input) {
      const reference = await options.writeScreenshot(input);
      if (reference.sha256 !== createHash("sha256").update(input.bytes).digest("hex")) {
        throw new Error(`smoke screenshot hash mismatch: ${input.filename}`);
      }
      return reference;
    },
    async readCompositionObservation(): Promise<Partial<CompositionDomObservation>> {
      const viewOnlyVisible = await viewOnly.count() === 1 && !!viewOnly.isVisible && await viewOnly.isVisible();
      const addressBoxPresent = await addressBox.count() === 1;
      if (grabWindow) {
        return {
          view_only_visible: viewOnlyVisible,
          address_box_present: addressBoxPresent,
        };
      }
      const [addressRect, formulaRect, viewOnlyRect] = await Promise.all([
        addressBox.boundingBox?.() ?? Promise.resolve(null),
        formulaBar.boundingBox?.() ?? Promise.resolve(null),
        viewOnly.boundingBox?.() ?? Promise.resolve(null),
      ]);
      return {
        view_only_visible: viewOnlyVisible,
        address_box_present: addressBoxPresent,
        formula_clip: await clipUnion("formula"),
        chrome_rects: {
          view_only: viewOnlyRect,
          address_box: addressRect,
          formula_bar: formulaRect,
        },
      };
    },
    async captureContextGroup(name) {
      return take(name, "cell");
    },
    async captureConflictImage(name) {
      return take(name, "full");
    },
    async expandFormulaBar() {
      if (!formulaBar.evaluate) return;
      await formulaBar.evaluate((element) => {
        const node = element as { style?: { height?: string; minHeight?: string }; scrollHeight?: number };
        const height = Math.max(Number(node.scrollHeight ?? 0), 120);
        if (node.style) {
          node.style.minHeight = `${height}px`;
          node.style.height = `${height}px`;
        }
      });
    },
    async isFormulaBarTruncated() {
      if (!formulaBar.evaluate) return false;
      return Boolean(await formulaBar.evaluate((element) => {
        const node = element as { scrollHeight?: number; clientHeight?: number };
        return Number(node.scrollHeight ?? 0) > Number(node.clientHeight ?? 0) + 1;
      }));
    },
    now: options.now,
  };
}
