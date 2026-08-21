/** Rasterize public/favicon.svg into PNG/ICO site icons. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const svg = await readFile(path.join(publicDir, "favicon.svg"), "utf8");

function encodeIco(pngs) {
  const count = pngs.length;
  const headerSize = 6 + 16 * count;
  let offset = headerSize;
  const entries = pngs.map(({ size, data }) => {
    const entry = {
      width: size,
      height: size,
      bytes: data.length,
      offset,
    };
    offset += data.length;
    return entry;
  });
  const buf = Buffer.alloc(offset);
  buf.writeUInt16LE(0, 0);
  buf.writeUInt16LE(1, 2);
  buf.writeUInt16LE(count, 4);
  entries.forEach((entry, i) => {
    const entryOffset = 6 + i * 16;
    buf.writeUInt8(entry.width, entryOffset);
    buf.writeUInt8(entry.height, entryOffset + 1);
    buf.writeUInt8(0, entryOffset + 2);
    buf.writeUInt8(0, entryOffset + 3);
    buf.writeUInt16LE(1, entryOffset + 4);
    buf.writeUInt16LE(32, entryOffset + 6);
    buf.writeUInt32LE(entry.bytes, entryOffset + 8);
    buf.writeUInt32LE(entry.offset, entryOffset + 12);
  });
  let cursor = headerSize;
  for (const { data } of pngs) {
    data.copy(buf, cursor);
    cursor += data.length;
  }
  return buf;
}

async function rasterize(browser, size) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: ${size}px; height: ${size}px; background: transparent; }
      svg { display: block; width: ${size}px; height: ${size}px; }
    </style>
  </head>
  <body>${svg}</body>
</html>`,
    { waitUntil: "load" },
  );
  const png = await page.screenshot({
    type: "png",
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  await page.close();
  return png;
}

const browser = await chromium.launch();
try {
  const sizes = [
    { name: "favicon-16.png", size: 16 },
    { name: "favicon-32.png", size: 32 },
    { name: "apple-touch-icon.png", size: 180 },
    { name: "icon-512.png", size: 512 },
  ];
  const pngs = [];
  for (const { name, size } of sizes) {
    const data = await rasterize(browser, size);
    await writeFile(path.join(publicDir, name), data);
    pngs.push({ size, data, name });
    console.log(`wrote ${name} (${data.length} bytes)`);
  }
  const ico = encodeIco(
    pngs
      .filter((p) => p.size === 16 || p.size === 32)
      .map((p) => ({ size: p.size, data: p.data })),
  );
  await writeFile(path.join(publicDir, "favicon.ico"), ico);
  console.log(`wrote favicon.ico (${ico.length} bytes)`);
} finally {
  await browser.close();
}
