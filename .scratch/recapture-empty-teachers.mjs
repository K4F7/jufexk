import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = "D:/19016/Documents/Workload/jufexk";
const OUT = join(ROOT, "scripts/legacy_evidence/output/empty-teacher-recapture-20260821-v1");
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
  ["MOOC", "F8"],
  ["MOOC", "F17"],
  ["MOOC", "F18"],
  ["主要课程", "E56"],
  ["主要课程", "E111"],
  ["主要课程", "E153"],
  ["主要课程", "E155"],
  ["主要课程", "E271"],
  ["主要课程", "E395"],
  ["主要课程", "E397"],
  ["主要课程", "E433"],
  ["主要课程", "E437"],
  ["主要课程", "E453"],
  ["主要课程", "E472"],
  ["体育课", "B21"],
  ["体育课", "B23"],
  ["外教", "E3"],
  ["外教", "E6"],
  ["大英和视听说", "E17"],
  ["大英和视听说", "E67"],
  ["思政课", "F50"],
  ["思政课", "F51"],
  ["思政课", "F52"],
  ["思政课", "F53"],
  ["思政课", "F54"],
  ["思政课", "F55"],
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseAddress(address) {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  if (!match) throw new Error(`bad address ${address}`);
  return { column: match[1], row: Number(match[2]), address };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unionClip(boxes, viewport, pad = 16) {
  const valid = boxes.filter((box) => box && box.width > 0 && box.height > 0);
  if (valid.length === 0) return { x: 0, y: 0, width: viewport.width, height: Math.min(220, viewport.height) };
  const left = Math.max(0, Math.min(...valid.map((box) => box.x)) - pad);
  const top = Math.max(0, Math.min(...valid.map((box) => box.y)) - pad);
  const right = Math.min(viewport.width, Math.max(...valid.map((box) => box.x + box.width)) + pad);
  const bottom = Math.min(viewport.height, Math.max(...valid.map((box) => box.y + box.height)) + pad);
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
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
  return ensureViewOnly(page);
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

  const items = [];
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
      const { addressBox, formulaBar, viewOnly } = await ensureViewOnly(page);
      await locate(page, addressBox, address);
      const firstAddress = String(await addressBox.inputValue());
      const firstValue = (await formulaBar.textContent()) ?? "";
      const secondAddress = String(await addressBox.inputValue());
      const secondValue = (await formulaBar.textContent()) ?? "";
      if (firstAddress.toUpperCase() !== address || secondAddress.toUpperCase() !== address) {
        throw new Error(`address mismatch ${firstAddress}/${secondAddress}`);
      }
      if (firstValue !== secondValue) {
        throw new Error(`formula mismatch ${JSON.stringify(firstValue)}/${JSON.stringify(secondValue)}`);
      }

      const viewport = page.viewportSize();
      const [addressRect, formulaRect, viewOnlyRect] = await Promise.all([
        addressBox.boundingBox(),
        formulaBar.boundingBox(),
        viewOnly.boundingBox(),
      ]);
      const formulaClip = unionClip([addressRect, formulaRect, viewOnlyRect], viewport);
      const formulaBytes = await page.screenshot({
        type: "jpeg",
        quality: 92,
        fullPage: false,
        scale: "css",
        clip: formulaClip,
      });
      const cellBytes = await page.screenshot({
        type: "jpeg",
        quality: 90,
        fullPage: false,
        scale: "css",
      });
      const formulaName = `${address}-formula.jpg`;
      const cellName = `${address}-cell.jpg`;
      await writeFile(join(sheetDir, formulaName), formulaBytes);
      await writeFile(join(sheetDir, cellName), cellBytes);

      const teacher = firstValue.replace(/^\s+|\s+$/g, "");
      const record = {
        contract_version: "empty-teacher-recapture-cell-v1",
        key,
        worksheet,
        row: parsed.row,
        column: parsed.column,
        target_address: address,
        active_addresses: [firstAddress, secondAddress],
        formula_bar_value: firstValue,
        teacher,
        empty: teacher.length === 0,
        formula_bar_sha256: sha256(Buffer.from(firstValue, "utf8")),
        read_only: true,
        captured_at: new Date().toISOString(),
        method: "playwright_page",
        evidence: {
          formula_image: {
            kind: "formula",
            path: formulaName,
            sha256: sha256(formulaBytes),
            clip: formulaClip,
          },
          cell_image: {
            kind: "cell",
            path: cellName,
            sha256: sha256(cellBytes),
          },
        },
      };
      await writeFile(join(sheetDir, `${address}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
      items.push({
        key,
        worksheet,
        address,
        formula_bar_value: firstValue,
        empty: record.empty,
        formula_image: join(sheetDir, formulaName),
        cell_image: join(sheetDir, cellName),
        json: join(sheetDir, `${address}.json`),
      });
      console.log(record.empty ? "EMPTY" : JSON.stringify(teacher));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      items.push({ key, worksheet, address, status: "failed", error: message });
      console.log("FAILED", message);
    }
  }

  const failed = items.filter((item) => item.status === "failed");
  const payload = {
    contract_version: "empty-teacher-recapture-set-v1",
    captured_at: new Date().toISOString(),
    source: SHEET_URL,
    read_only: true,
    cells: items.length,
    captured: items.filter((item) => !item.status).length,
    failed: failed.length,
    filled: items.filter((item) => item.empty === false).length,
    still_empty: items.filter((item) => item.empty === true).length,
    items,
  };
  await writeFile(join(OUT, "captures.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await browser.close();
  if (failed.length) throw new Error(`recapture failed for ${failed.length} cells`);
  console.log(JSON.stringify({
    out: OUT,
    captured: payload.captured,
    filled: payload.filled,
    still_empty: payload.still_empty,
  }, null, 2));
}

await main();
