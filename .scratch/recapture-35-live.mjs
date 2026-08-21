import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = "D:/19016/Documents/Workload/jufexk";
const OUT = join(ROOT, "scripts/legacy_evidence/output/human-queue-20260820-v3-live-recapture");
const SHEET_URL = "https://docs.qq.com/sheet/DUFVCWkdsRU5BdEhH";
const TABS = {
  主要课程: "BB08J3",
  数学课: "BB08J5",
  美育: "d80187",
  大英和视听说: "BB08J7",
  思政课: "BB08J4",
  外教: "BB08J6",
  MOOC: "BB08J8",
  体育课: "BB08J9",
};

const TARGETS = [
  ["大英和视听说", "O10"],
  ["大英和视听说", "M11"],
  ["大英和视听说", "L14"],
  ["大英和视听说", "O14"],
  ["大英和视听说", "I19"],
  ["大英和视听说", "L22"],
  ["大英和视听说", "L35"],
  ["大英和视听说", "J43"],
  ["大英和视听说", "L43"],
  ["大英和视听说", "O43"],
  ["大英和视听说", "N44"],
  ["大英和视听说", "K45"],
  ["大英和视听说", "I47"],
  ["大英和视听说", "M49"],
  ["大英和视听说", "O49"],
  ["大英和视听说", "K51"],
  ["大英和视听说", "L51"],
  ["大英和视听说", "J52"],
  ["大英和视听说", "J53"],
  ["大英和视听说", "J56"],
  ["大英和视听说", "J59"],
  ["大英和视听说", "H65"],
  ["美育", "E12"],
  ["思政课", "H27"],
  ["思政课", "K27"],
  ["思政课", "M27"],
  ["思政课", "G47"],
  ["思政课", "H47"],
  ["思政课", "I47"],
  ["思政课", "G48"],
  ["思政课", "H48"],
  ["体育课", "E40"],
  ["体育课", "G40"],
  ["主要课程", "G101"],
  ["主要课程", "M56"],
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseAddress(address) {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  if (!match) throw new Error(`bad address ${address}`);
  return { column: match[1], row: Number(match[2]), address };
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureViewOnly(page) {
  const viewOnly = page.getByRole("button", { name: "只能查看", exact: true });
  await viewOnly.waitFor({ state: "visible", timeout: 60_000 });
  if (await viewOnly.count() !== 1) throw new Error("只能查看 is missing or ambiguous");
  const addressBox = page.locator("input.bar-label");
  const formulaBar = page.locator("#alloy-simple-text-editor");
  if (await addressBox.count() !== 1) throw new Error("address box missing or ambiguous");
  if (await formulaBar.count() !== 1) throw new Error("formula bar missing or ambiguous");
  if (await formulaBar.getAttribute("contenteditable") !== "false") {
    throw new Error("formula bar is editable; refusing writeable session");
  }
  return { addressBox, formulaBar, viewOnly };
}

async function selectWorksheet(page, worksheet) {
  const tab = TABS[worksheet];
  if (!tab) throw new Error(`unknown worksheet ${worksheet}`);
  const url = `${SHEET_URL}?tab=${tab}`;
  if (!page.url().includes(`tab=${tab}`)) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
  await ensureViewOnly(page);
  const tabButton = page.getByRole("button", { name: worksheet, exact: true });
  if (await tabButton.count() === 1) {
    const selected = await tabButton.getAttribute("aria-selected");
    if (selected !== "true") await tabButton.click();
  }
  await wait(800);
  await ensureViewOnly(page);
}

async function locate(page, addressBox, address) {
  await addressBox.click({ clickCount: 3 });
  await addressBox.fill(address);
  await addressBox.press("Enter");
  await wait(1200);
  const active = String(await addressBox.inputValue());
  if (active.toUpperCase() !== address.toUpperCase()) {
    await addressBox.fill(address);
    await addressBox.press("Enter");
    await wait(1500);
  }
}

async function main() {
  await mkdir(join(OUT, "evidence"), { recursive: true });
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(30_000);
  await page.goto(SHEET_URL, { waitUntil: "domcontentloaded" });
  await ensureViewOnly(page);

  const results = [];
  let currentSheet = null;
  for (const [index, [worksheet, address]] of TARGETS.entries()) {
    const parsed = parseAddress(address);
    const key = `${worksheet}|${parsed.row}|${parsed.column}`;
    const sheetDir = join(OUT, "evidence", worksheet);
    await mkdir(sheetDir, { recursive: true });
    process.stdout.write(`[${index + 1}/${TARGETS.length}] ${key} `);
    try {
      if (currentSheet !== worksheet) {
        await selectWorksheet(page, worksheet);
        currentSheet = worksheet;
      }
      const { addressBox, formulaBar } = await ensureViewOnly(page);
      await locate(page, addressBox, address);
      const firstAddress = String(await addressBox.inputValue());
      const firstValue = (await formulaBar.textContent()) ?? "";
      const secondAddress = String(await addressBox.inputValue());
      const secondValue = (await formulaBar.textContent()) ?? "";
      const bytes = await page.screenshot({ type: "jpeg", quality: 90, fullPage: false, scale: "css" });
      const imageName = `${address}-cell.jpg`;
      const imagePath = join(sheetDir, imageName);
      await writeFile(imagePath, bytes);
      const record = {
        contract_version: "live-recapture-cell-v1",
        key,
        worksheet,
        row: parsed.row,
        column: parsed.column,
        target_address: address,
        active_addresses: [firstAddress, secondAddress],
        formula_bar_reads: [
          { sequence: 1, value: firstValue, sha256: sha256(Buffer.from(firstValue, "utf8")) },
          { sequence: 2, value: secondValue, sha256: sha256(Buffer.from(secondValue, "utf8")) },
        ],
        formula_bar_value: firstValue,
        formula_bar_reads_match: firstValue === secondValue,
        address_match: firstAddress.toUpperCase() === address && secondAddress.toUpperCase() === address,
        read_only: true,
        captured_at: new Date().toISOString(),
        method: "playwright_page",
        evidence: {
          cell_image: { kind: "cell", path: imageName, sha256: sha256(bytes) },
        },
      };
      await writeFile(join(sheetDir, `${address}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
      results.push({
        key,
        status: record.address_match && record.formula_bar_reads_match ? "captured" : "capture_mismatch",
        formula_bar_value: firstValue,
        active_addresses: record.active_addresses,
        image: imagePath,
      });
      console.log(record.status ?? "captured", JSON.stringify(firstValue).slice(0, 40));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ key, status: "failed", error: message });
      console.log("FAILED", message);
    }
  }

  await writeFile(join(OUT, "captures.json"), `${JSON.stringify({
    contract_version: "live-recapture-set-v1",
    captured_at: new Date().toISOString(),
    cells: results.length,
    captured: results.filter((item) => item.status === "captured").length,
    failed: results.filter((item) => item.status !== "captured").length,
    items: results,
  }, null, 2)}\n`, "utf8");
  await browser.close();
}

await main();
