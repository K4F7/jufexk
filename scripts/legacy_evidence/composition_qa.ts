import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

export const COMPOSITION_QA_VERSION = "composition-qa-v1" as const;
export const COMPOSITION_RECAPTURE_LIMIT = 3;
export const ALLOWED_COMPOSITION_METHODS = ["print_window", "playwright_page"] as const;

export const D13_DIRTY_COMPOSITION_SHA256 = {
  "体育课|13|D|formula": "c9be1722902379eb625c0c1450ae9b0ca9621083dfe59596ef4af9977f7ad7df",
  "体育课|13|D|cell": "869cb65f961c0ad69b9f8a3d20a1a794c1fbbb32f874ff58561384745d82debf",
} as const;

const KNOWN_DIRTY_SHA256 = new Set<string>(Object.values(D13_DIRTY_COMPOSITION_SHA256));

export type CompositionCaptureMethod = (typeof ALLOWED_COMPOSITION_METHODS)[number];
export type CompositionQaStatus = "accepted" | "recapture_required";

export type CompositionRect = { x: number; y: number; width: number; height: number };

export type RgbaImage = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

export type CompositionFrame = {
  method: CompositionCaptureMethod | "copy_from_screen";
  bytes: Uint8Array;
};

export type CompositionDomObservation = {
  target_address: string;
  active_address: string;
  view_only_visible: boolean;
  address_box_present: boolean;
  formula_bar_reads: readonly [string, string];
  formula_bar_record_sha256?: string | null;
  formula_clip?: CompositionRect | null;
  chrome_rects?: {
    view_only: CompositionRect | null;
    address_box: CompositionRect | null;
    formula_bar: CompositionRect | null;
  };
};

export type CompositionQaResult = {
  status: CompositionQaStatus;
  issues: string[];
  rewrite_source_json: false;
  formula_bar_record_sha256: string | null;
};

export type CompositionPairAccepted = CompositionQaResult & {
  status: "accepted";
  formula: { bytes: Uint8Array; sha256: string };
  cell: { bytes: Uint8Array; sha256: string };
  attempts: number;
};

export type CompositionPairRejected = CompositionQaResult & {
  status: "recapture_required";
  attempts: number;
};

export type CompositionPairResult = CompositionPairAccepted | CompositionPairRejected;

export function isKnownDirtyCompositionHash(sha: string): boolean {
  return KNOWN_DIRTY_SHA256.has(sha);
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function evaluateComposition(input: {
  observation: CompositionDomObservation;
  formula: CompositionFrame;
  cell: CompositionFrame;
}): CompositionQaResult {
  const issues: string[] = [];
  const recordSha = input.observation.formula_bar_record_sha256 ?? null;
  const formulaSha = sha256Bytes(input.formula.bytes);
  const cellSha = sha256Bytes(input.cell.bytes);

  if (!isAllowedMethod(input.formula.method)) {
    issues.push(`formula capture used ${input.formula.method}; desktop composite is not evidence`);
  }
  if (!isAllowedMethod(input.cell.method)) {
    issues.push(`cell capture used ${input.cell.method}; desktop composite is not evidence`);
  }
  if (!input.observation.view_only_visible) issues.push("formula image is missing 只能查看");
  if (!input.observation.address_box_present) issues.push("formula image is missing the address box");
  if (normalizeLooseAddress(input.observation.active_address) !== normalizeLooseAddress(input.observation.target_address)) {
    issues.push(`active address ${input.observation.active_address} is not ${input.observation.target_address}`);
  }
  if (input.observation.formula_bar_reads[0] !== input.observation.formula_bar_reads[1]) {
    issues.push("formula-bar double-read does not match DOM");
  }
  if (formulaSha === cellSha) issues.push("formula/cell hashes are identical");
  if (isKnownDirtyCompositionHash(formulaSha)) issues.push("formula image matches the D13 dirty desktop fixture");
  if (isKnownDirtyCompositionHash(cellSha)) issues.push("cell image matches the D13 dirty desktop fixture");
  issues.push(...inspectChromeRects(input.observation));
  issues.push(...inspectFramePixels(input.formula, "formula"));
  issues.push(...inspectFramePixels(input.cell, "cell"));

  return {
    status: issues.length === 0 ? "accepted" : "recapture_required",
    issues,
    rewrite_source_json: false,
    formula_bar_record_sha256: recordSha,
  };
}

export async function captureCompositionPair(options: {
  observation: CompositionDomObservation;
  grabFormula(): Promise<CompositionFrame>;
  grabCell(): Promise<CompositionFrame>;
  limit?: number;
}): Promise<CompositionPairResult> {
  const limit = options.limit ?? COMPOSITION_RECAPTURE_LIMIT;
  let lastIssues: string[] = ["composition grab did not run"];
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    const formula = await options.grabFormula();
    const cell = await options.grabCell();
    const qa = evaluateComposition({ observation: options.observation, formula, cell });
    if (qa.status === "accepted") {
      return {
        ...qa,
        status: "accepted",
        formula: { bytes: formula.bytes, sha256: sha256Bytes(formula.bytes) },
        cell: { bytes: cell.bytes, sha256: sha256Bytes(cell.bytes) },
        attempts: attempt,
      };
    }
    lastIssues = qa.issues;
  }
  return {
    status: "recapture_required",
    issues: lastIssues,
    rewrite_source_json: false,
    formula_bar_record_sha256: options.observation.formula_bar_record_sha256 ?? null,
    attempts: limit,
  };
}

export function inspectCompositionPixels(image: RgbaImage, kind: "formula" | "cell"): string[] {
  const stats = measureComposition(image);
  const issues: string[] = [];
  if (stats.dark_ratio > 0.08) {
    issues.push(kind === "cell"
      ? "cell image looks like a terminal or other dark overlay, not a sheet grid"
      : "formula image contains a dark overlay, not sheet chrome");
  }
  if (kind === "formula" && stats.light_ratio < 0.4) {
    issues.push("formula image is missing light sheet chrome");
  }
  if (kind === "cell" && stats.grid_score < 0.012) {
    issues.push("cell image is not a table grid");
  }
  return issues;
}

export function measureComposition(image: RgbaImage): {
  dark_ratio: number;
  light_ratio: number;
  grid_score: number;
} {
  const { width, height, rgba } = image;
  const stride = width * height > 500_000 ? 2 : 1;
  let dark = 0;
  let light = 0;
  let samples = 0;
  let horizontalEdges = 0;
  let verticalEdges = 0;
  let edgeSamples = 0;
  const lumAt = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    return 0.2126 * rgba[index] + 0.7152 * rgba[index + 1] + 0.0722 * rgba[index + 2];
  };
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const lum = lumAt(x, y);
      samples += 1;
      if (lum < 50) dark += 1;
      if (lum > 190) light += 1;
      if (x >= stride && y >= stride) {
        edgeSamples += 1;
        if (Math.abs(lum - lumAt(x, y - stride)) > 28) horizontalEdges += 1;
        if (Math.abs(lum - lumAt(x - stride, y)) > 28) verticalEdges += 1;
      }
    }
  }
  const horizontal = edgeSamples === 0 ? 0 : horizontalEdges / edgeSamples;
  const vertical = edgeSamples === 0 ? 0 : verticalEdges / edgeSamples;
  return {
    dark_ratio: samples === 0 ? 1 : dark / samples,
    light_ratio: samples === 0 ? 0 : light / samples,
    grid_score: Math.min(horizontal, vertical),
  };
}

export function cropRgba(image: RgbaImage, rect: CompositionRect): RgbaImage {
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const width = Math.max(1, Math.min(image.width - left, Math.floor(rect.width)));
  const height = Math.max(1, Math.min(image.height - top, Math.floor(rect.height)));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const source = ((top + y) * image.width + left) * 4;
    rgba.set(image.rgba.subarray(source, source + width * 4), y * width * 4);
  }
  return { width, height, rgba };
}

export function windowCompositionBands(width: number, height: number): {
  formula: CompositionRect;
  cell: CompositionRect;
} {
  const formulaTop = 80;
  const formulaBand = 320;
  const tabHeight = 56;
  const tabTop = Math.max(0, height - tabHeight);
  const cellTop = Math.min(formulaTop + formulaBand, Math.max(0, tabTop - 80));
  return {
    formula: { x: 0, y: formulaTop, width, height: Math.min(formulaBand, Math.max(1, height - formulaTop)) },
    cell: { x: 0, y: cellTop, width, height: Math.max(80, tabTop - cellTop) },
  };
}

export function encodePng(image: RgbaImage): Uint8Array {
  const raw = new Uint8Array((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const row = y * (image.width * 4 + 1);
    raw[row] = 0;
    raw.set(image.rgba.subarray(y * image.width * 4, (y + 1) * image.width * 4), row + 1);
  }
  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, image.width);
  writeU32(ihdr, 4, image.height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunks = [
    pngSignature(),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array()),
  ];
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function decodePng(bytes: Uint8Array): RgbaImage {
  if (bytes.length < 8 || ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) {
    throw new Error("not a PNG composition frame");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = readU32(data, 0);
      height = readU32(data, 4);
      if (data[8] !== 8 || (data[9] !== 2 && data[9] !== 6) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error("unsupported PNG composition frame");
      }
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (width < 1 || height < 1) throw new Error("PNG composition frame is missing IHDR");
  const bpp = colorType === 6 ? 4 : 3;
  const inflated = inflateSync(concat(idat));
  const stride = width * bpp + 1;
  if (inflated.length < stride * height) throw new Error("PNG composition frame is truncated");
  const rgba = new Uint8Array(width * height * 4);
  const prior = new Uint8Array(width * bpp);
  const current = new Uint8Array(width * bpp);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * stride];
    const row = inflated.subarray(y * stride + 1, y * stride + stride);
    unfilter(filter, row, current, prior, bpp);
    for (let x = 0; x < width; x += 1) {
      const source = x * bpp;
      const dest = (y * width + x) * 4;
      rgba[dest] = current[source];
      rgba[dest + 1] = current[source + 1];
      rgba[dest + 2] = current[source + 2];
      rgba[dest + 3] = bpp === 4 ? current[source + 3] : 255;
    }
    prior.set(current);
  }
  return { width, height, rgba };
}

export function tryDecodeCompositionImage(bytes: Uint8Array): RgbaImage | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    try {
      return decodePng(bytes);
    } catch {
      return null;
    }
  }
  return null;
}

function inspectFramePixels(frame: CompositionFrame, kind: "formula" | "cell"): string[] {
  const image = tryDecodeCompositionImage(frame.bytes);
  if (image) return inspectCompositionPixels(image, kind);
  if (frame.bytes.length >= 2 && frame.bytes[0] === 0xff && frame.bytes[1] === 0xd8) {
    return [`${kind} image is a jpeg desktop grab; recapture via PrintWindow or page screenshot`];
  }
  return [`${kind} image is not a decodable composition frame`];
}

function inspectChromeRects(observation: CompositionDomObservation): string[] {
  const clip = observation.formula_clip;
  const chrome = observation.chrome_rects;
  if (!clip || !chrome) return [];
  const issues: string[] = [];
  if (!chrome.view_only || !rectContains(clip, chrome.view_only)) issues.push("formula clip does not include 只能查看");
  if (!chrome.address_box || !rectContains(clip, chrome.address_box)) issues.push("formula clip does not include the address box");
  if (!chrome.formula_bar || !rectContains(clip, chrome.formula_bar)) issues.push("formula clip does not include the formula bar");
  return issues;
}

function rectContains(outer: CompositionRect, inner: CompositionRect): boolean {
  return inner.width > 0
    && inner.height > 0
    && inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width + 0.5
    && inner.y + inner.height <= outer.y + outer.height + 0.5;
}

function isAllowedMethod(method: CompositionFrame["method"]): method is CompositionCaptureMethod {
  return ALLOWED_COMPOSITION_METHODS.includes(method as CompositionCaptureMethod);
}

function normalizeLooseAddress(address: string): string {
  return address.trim().toUpperCase();
}

function pngSignature(): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(12 + data.length);
  writeU32(bytes, 0, data.length);
  bytes[4] = type.charCodeAt(0);
  bytes[5] = type.charCodeAt(1);
  bytes[6] = type.charCodeAt(2);
  bytes[7] = type.charCodeAt(3);
  bytes.set(data, 8);
  const crcInput = bytes.subarray(4, 8 + data.length);
  writeU32(bytes, 8 + data.length, crc32(crcInput));
  return bytes;
}

function unfilter(filter: number, row: Uint8Array, current: Uint8Array, prior: Uint8Array, bpp: number) {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bpp ? current[index - bpp] : 0;
    const up = prior[index];
    const upLeft = index >= bpp ? prior[index - bpp] : 0;
    const value = row[index];
    if (filter === 0) current[index] = value;
    else if (filter === 1) current[index] = (value + left) & 255;
    else if (filter === 2) current[index] = (value + up) & 255;
    else if (filter === 3) current[index] = (value + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) current[index] = (value + paeth(left, up, upLeft)) & 255;
    else throw new Error(`unsupported PNG filter ${filter}`);
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function writeU32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 255;
  bytes[offset + 1] = (value >>> 16) & 255;
  bytes[offset + 2] = (value >>> 8) & 255;
  bytes[offset + 3] = value & 255;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value;
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
