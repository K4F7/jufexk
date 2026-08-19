import { createHash } from "node:crypto";
import type {
  EvidenceReference,
  FormulaBarCellSource,
  FormulaBarTarget,
} from "./formula_bar";
import type { FormulaBarMatrixSource } from "./formula_bar_locator";

type Locator = {
  count(): Promise<number>;
  fill?(value: string): Promise<void>;
  press?(key: string): Promise<void>;
  evaluate?(callback: (element: any, arg?: any) => unknown, arg?: unknown): Promise<unknown>;
  textContent?(): Promise<string | null>;
  isVisible?(): Promise<boolean>;
  getAttribute?(name: string): Promise<string | null>;
  click?(): Promise<void>;
};

type TencentSheetTab = {
  playwright: {
    locator(selector: string): Locator;
    getByRole(role: string, options: { name: string; exact: boolean }): Locator;
  };
  screenshot(options: { fullPage: boolean }): Promise<Uint8Array>;
};

export type TencentFormulaBarReadSnapshot = {
  active_addresses: readonly [string, string];
  formula_bar_values: readonly [string, string];
};

export const TENCENT_SHEET_SELECTORS = {
  addressBox: "input.bar-label",
  formulaBar: "#alloy-simple-text-editor",
} as const;

export async function commitTencentAddressBox(addressBox: Locator, address: string) {
  if (!addressBox.evaluate || !addressBox.press) {
    throw new Error("Tencent sheet address box cannot use the native setter");
  }
  await addressBox.evaluate((element, value) => {
    const input = element as { value?: string; dispatchEvent(event: Event): boolean };
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!proto) throw new Error("native value setter unavailable");
    proto.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, address);
  await addressBox.press("Enter");
}

export function createTencentSheetFormulaBarSource(options: {
  tab: TencentSheetTab;
  readVisibleCellText(): Promise<string>;
  writeScreenshot(input: {
    kind: EvidenceReference["kind"];
    target: FormulaBarTarget;
    bytes: Uint8Array;
  }): Promise<EvidenceReference>;
  now(): string;
  selectWorksheet?(worksheet: string): Promise<void>;
  settleAfterLocate?(target: FormulaBarTarget): Promise<void>;
  prepareEvidenceCapture?(request: { kind: EvidenceReference["kind"]; target: FormulaBarTarget }): Promise<void>;
  moveRight?(target: FormulaBarTarget): Promise<void>;
  readFormulaBarSnapshot?(): Promise<TencentFormulaBarReadSnapshot>;
}): FormulaBarCellSource | FormulaBarMatrixSource {
  const addressBox = options.tab.playwright.locator(TENCENT_SHEET_SELECTORS.addressBox);
  const formulaBar = options.tab.playwright.locator(TENCENT_SHEET_SELECTORS.formulaBar);
  const viewOnly = options.tab.playwright.getByRole("button", { name: "只能查看", exact: true });
  let readSnapshot: TencentFormulaBarReadSnapshot | null = null;
  let addressReadIndex = 0;
  let formulaReadIndex = 0;

  const resetReadSnapshot = () => {
    readSnapshot = null;
    addressReadIndex = 0;
    formulaReadIndex = 0;
  };
  const snapshot = async () => {
    if (!options.readFormulaBarSnapshot) return null;
    readSnapshot ??= await options.readFormulaBarSnapshot();
    if (readSnapshot.active_addresses.length !== 2 || readSnapshot.formula_bar_values.length !== 2
      || !readSnapshot.active_addresses.every((value) => typeof value === "string")
      || !readSnapshot.formula_bar_values.every((value) => typeof value === "string")) {
      throw new Error("Tencent sheet formula-bar snapshot must contain two address-bound reads");
    }
    return readSnapshot;
  };

  return {
    async locateByAddressBox(target) {
      if (await viewOnly.count() !== 1 || !viewOnly.isVisible || !await viewOnly.isVisible()) {
        throw new Error("Tencent sheet is not visibly read-only");
      }
      if (await addressBox.count() !== 1 || !addressBox.evaluate || !addressBox.press) {
        throw new Error("Tencent sheet address box is unavailable or ambiguous");
      }
      if (await formulaBar.count() !== 1 || !formulaBar.textContent || !formulaBar.getAttribute
        || await formulaBar.getAttribute("contenteditable") !== "false") {
        throw new Error("Tencent sheet formula bar is unavailable or ambiguous");
      }
      await options.selectWorksheet?.(target.worksheet);
      await commitTencentAddressBox(addressBox, target.address);
      await options.settleAfterLocate?.(target);
      resetReadSnapshot();
    },
    async readActiveAddress() {
      const cached = await snapshot();
      if (cached) {
        if (addressReadIndex >= 2) throw new Error("Tencent sheet address snapshot exhausted");
        return cached.active_addresses[addressReadIndex++];
      }
      if (!addressBox.evaluate) throw new Error("Tencent sheet address box cannot be read");
      return String(await addressBox.evaluate((element) => String(element.value ?? "")));
    },
    async readFormulaBar() {
      const cached = await snapshot();
      if (cached) {
        if (formulaReadIndex >= 2) throw new Error("Tencent sheet formula-bar snapshot exhausted");
        return cached.formula_bar_values[formulaReadIndex++];
      }
      if (!formulaBar.textContent) throw new Error("Tencent sheet formula bar cannot be read");
      return (await formulaBar.textContent()) ?? "";
    },
    ...(options.moveRight ? {
      async moveRight(target: FormulaBarTarget) {
        await options.moveRight!(target);
        resetReadSnapshot();
      },
    } : {}),
    readVisibleCellText: options.readVisibleCellText,
    async captureEvidence({ kind, target }) {
      await options.prepareEvidenceCapture?.({ kind, target });
      const bytes = await options.tab.screenshot({ fullPage: false });
      const reference = await options.writeScreenshot({ kind, target, bytes });
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (reference.kind !== kind || reference.sha256 !== digest) {
        throw new Error("Tencent sheet screenshot evidence hash mismatch");
      }
      return reference;
    },
    now: options.now,
  };
}
