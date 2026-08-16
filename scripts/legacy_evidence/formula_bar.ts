import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export const FORMULA_BAR_CONTRACT_VERSION = "formula-bar-cell-evidence-v1" as const;

export type EvidenceReference = {
  kind: "cell" | "conflict";
  path: string;
  sha256: string;
};

export type FormulaBarTarget = {
  worksheet: string;
  address: string;
};

export interface FormulaBarCellSource {
  locateByAddressBox(target: FormulaBarTarget): Promise<void>;
  readActiveAddress(): Promise<string>;
  readFormulaBar(): Promise<string>;
  readVisibleCellText(): Promise<string>;
  captureEvidence(request: { kind: EvidenceReference["kind"]; target: FormulaBarTarget }): Promise<EvidenceReference>;
  now(): string;
}

export async function captureFormulaBarCell(
  target: FormulaBarTarget,
  source: FormulaBarCellSource,
  options: { already_located?: boolean; force_cell_image?: boolean } = {},
) {
  const normalizedTarget = normalizeTarget(target);
  const parsed = parseAddress(normalizedTarget.address);
  if (!options.already_located) await source.locateByAddressBox(normalizedTarget);

  const firstAddress = normalizeAddress(await source.readActiveAddress());
  if (firstAddress !== normalizedTarget.address) {
    return captureConflict(normalizedTarget, parsed, source, [firstAddress], [], "active_address_mismatch");
  }
  const firstValue = await source.readFormulaBar();
  const firstRead = { sequence: 1, value: firstValue, sha256: sha256(firstValue) };
  const secondAddress = normalizeAddress(await source.readActiveAddress());
  if (secondAddress !== normalizedTarget.address) {
    return captureConflict(normalizedTarget, parsed, source, [firstAddress, secondAddress], [firstRead], "active_address_mismatch");
  }
  const secondValue = await source.readFormulaBar();
  const secondRead = { sequence: 2, value: secondValue, sha256: sha256(secondValue) };
  if (firstValue !== secondValue) {
    return captureConflict(
      normalizedTarget,
      parsed,
      source,
      [firstAddress, secondAddress],
      [firstRead, secondRead],
      "formula_bar_reads_mismatch",
    );
  }
  const visibleText = await source.readVisibleCellText();
  const formulaHash = sha256(firstValue);
  const formulaBarNonempty = firstValue.length > 0;
  const cellImageReason = formulaBarNonempty
    ? "formula_nonempty" as const
    : options.force_cell_image
      ? "forced_scope" as const
      : null;
  const cellImage = cellImageReason
    ? await source.captureEvidence({ kind: "cell", target: normalizedTarget })
    : null;
  const visibleTextNonempty = normalizeDisplayText(visibleText).length > 0;
  const overflowBlank = !formulaBarNonempty && visibleTextNonempty;
  const ordinaryBlank = !formulaBarNonempty && !visibleTextNonempty;
  const visibleTextMatches = formulaBarNonempty && visibleTextMatchesFormula(visibleText, firstValue);
  const textConflict = formulaBarNonempty && !visibleTextMatches;
  const conflictImage = textConflict
    ? await source.captureEvidence({ kind: "conflict", target: normalizedTarget })
    : null;
  const correspondence = textConflict
    ? "visible_text_conflicts_with_formula" as const
    : overflowBlank
      ? "formula_empty_visible_text" as const
      : ordinaryBlank
        ? "both_empty" as const
        : "visible_text_matches_formula" as const;
  const terminalStatus = textConflict
    ? "evidence_conflict" as const
    : overflowBlank
      ? "horizontal_overflow_blank" as const
      : ordinaryBlank
        ? "ordinary_blank" as const
        : "review_origin" as const;
  const content = {
    contract_version: FORMULA_BAR_CONTRACT_VERSION,
    key: `${normalizedTarget.worksheet}|${parsed.row}|${parsed.column}`,
    worksheet: normalizedTarget.worksheet,
    row: parsed.row,
    column: parsed.column,
    target_address: normalizedTarget.address,
    active_addresses: [firstAddress, secondAddress],
    formula_bar_reads: [firstRead, secondRead],
    formula_bar_value: firstValue,
    formula_bar_text_sha256: formulaHash,
    formula_bar_nonempty: formulaBarNonempty,
    visible_cell_text: visibleText,
    visible_cell_text_sha256: sha256(visibleText),
    correspondence,
    terminal_status: terminalStatus,
    conflict_reason: textConflict ? "visible_text_formula_mismatch" as const : null,
    halt_batch: false,
    read_only: true,
    captured_at: source.now(),
    cell_image_reason: cellImageReason,
    evidence: { cell_image: cellImage, conflict_image: conflictImage },
  };
  return { ...content, record_sha256: sha256(stableJson(content)) };
}

export type FormulaBarEvidence = Awaited<ReturnType<typeof captureFormulaBarCell>>;

export async function writeFormulaBarEvidence(path: string, evidence: FormulaBarEvidence) {
  validateFormulaBarEvidence(evidence);
  await verifyEvidenceFiles(path, evidence);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readFormulaBarEvidence(path: string): Promise<FormulaBarEvidence> {
  const evidence: unknown = JSON.parse(await readFile(path, "utf8"));
  validateFormulaBarEvidence(evidence);
  await verifyEvidenceFiles(path, evidence);
  return evidence as FormulaBarEvidence;
}

export function hashFormulaBarEvidenceContent(evidence: Record<string, unknown>) {
  const { record_sha256: _recordHash, ...content } = evidence;
  return sha256(stableJson(content));
}

export function validateFormulaBarEvidence(evidence: unknown): asserts evidence is FormulaBarEvidence {
  if (!isRecord(evidence) || evidence.contract_version !== FORMULA_BAR_CONTRACT_VERSION) {
    throw new Error("invalid formula-bar evidence contract version");
  }
  const recordHash = evidence.record_sha256;
  if (typeof recordHash !== "string" || hashFormulaBarEvidenceContent(evidence) !== recordHash) {
    throw new Error("formula-bar evidence hash mismatch");
  }
  if (typeof evidence.worksheet !== "string" || !Number.isInteger(evidence.row)
    || typeof evidence.column !== "string" || typeof evidence.target_address !== "string") {
    throw new Error("invalid formula-bar evidence identity");
  }
  const parsed = parseAddress(evidence.target_address);
  if (parsed.row !== evidence.row || parsed.column !== evidence.column
    || evidence.key !== `${evidence.worksheet}|${evidence.row}|${evidence.column}`) {
    throw new Error("formula-bar evidence identity mismatch");
  }
  if (!Array.isArray(evidence.active_addresses) || !evidence.active_addresses.every((address) => {
    if (typeof address !== "string") return false;
    try { return normalizeAddress(address) === address; } catch { return false; }
  })) throw new Error("invalid formula-bar evidence active addresses");
  if (!Array.isArray(evidence.formula_bar_reads) || !evidence.formula_bar_reads.every((read) => (
    isRecord(read) && Number.isInteger(read.sequence) && typeof read.value === "string"
    && typeof read.sha256 === "string" && sha256(read.value) === read.sha256
  ))) throw new Error("invalid formula-bar evidence reads");
  if (!["review_origin", "horizontal_overflow_blank", "ordinary_blank", "evidence_conflict"].includes(evidence.terminal_status)
    || evidence.read_only !== true || typeof evidence.captured_at !== "string" || !Number.isFinite(Date.parse(evidence.captured_at))) {
    throw new Error("invalid formula-bar evidence terminal state");
  }
  if (!isRecord(evidence.evidence)) throw new Error("invalid formula-bar evidence references");
  const cellImage = validateReference(evidence.evidence.cell_image, "cell");
  const conflictImage = validateReference(evidence.evidence.conflict_image, "conflict");
  const targetAddress = evidence.target_address;
  const reads = evidence.formula_bar_reads;
  const addresses = evidence.active_addresses;

  if (evidence.conflict_reason === "active_address_mismatch") {
    if (evidence.terminal_status !== "evidence_conflict" || evidence.correspondence !== "not_checked"
      || evidence.halt_batch !== true || evidence.formula_bar_value !== null
      || evidence.formula_bar_text_sha256 !== null || evidence.formula_bar_nonempty !== null
      || evidence.visible_cell_text !== null || evidence.visible_cell_text_sha256 !== null
      || cellImage !== null || conflictImage === null
      || ![1, 2].includes(addresses.length) || reads.length !== addresses.length - 1
      || addresses.slice(0, -1).some((address) => address !== targetAddress)
      || addresses[addresses.length - 1] === targetAddress) {
      throw new Error("invalid active-address conflict evidence");
    }
    assertReadSequence(reads);
    return;
  }
  if (evidence.conflict_reason === "formula_bar_reads_mismatch") {
    if (evidence.terminal_status !== "evidence_conflict" || evidence.correspondence !== "not_checked"
      || evidence.halt_batch !== true || evidence.formula_bar_value !== null
      || evidence.formula_bar_text_sha256 !== null || evidence.formula_bar_nonempty !== null
      || evidence.visible_cell_text !== null || evidence.visible_cell_text_sha256 !== null
      || cellImage !== null || conflictImage === null
      || addresses.length !== 2 || addresses.some((address) => address !== targetAddress)
      || reads.length !== 2 || reads[0].value === reads[1].value) {
      throw new Error("invalid double-read conflict evidence");
    }
    assertReadSequence(reads);
    return;
  }

  if (addresses.length !== 2 || addresses.some((address) => address !== targetAddress)
    || reads.length !== 2 || reads[0].value !== reads[1].value) {
    throw new Error("confirmed formula-bar evidence requires two address-bound identical reads");
  }
  assertReadSequence(reads);
  if (typeof evidence.formula_bar_value !== "string" || evidence.formula_bar_value !== reads[0].value
    || evidence.formula_bar_text_sha256 !== sha256(evidence.formula_bar_value)
    || evidence.formula_bar_nonempty !== (evidence.formula_bar_value.length > 0)
    || typeof evidence.visible_cell_text !== "string"
    || evidence.visible_cell_text_sha256 !== sha256(evidence.visible_cell_text)
    || (evidence.formula_bar_nonempty === true && cellImage === null)
    || (evidence.cell_image_reason !== undefined
      && ![null, "formula_nonempty", "forced_scope"].includes(evidence.cell_image_reason))
    || (evidence.cell_image_reason === "formula_nonempty" && evidence.formula_bar_nonempty !== true)
    || (evidence.cell_image_reason === "forced_scope" && cellImage === null)
    || (evidence.cell_image_reason === null && cellImage !== null)
    || evidence.halt_batch !== false) {
    throw new Error("invalid confirmed formula-bar evidence content");
  }
  const expected = classifyConfirmedEvidence(evidence.formula_bar_value, evidence.visible_cell_text);
  if (evidence.terminal_status !== expected.terminal_status || evidence.correspondence !== expected.correspondence
    || evidence.conflict_reason !== expected.conflict_reason
    || (expected.conflict_reason === null ? conflictImage !== null : conflictImage === null)) {
    throw new Error("formula-bar evidence classification mismatch");
  }
}

function visibleTextMatchesFormula(visibleText: string, formulaText: string) {
  const visible = normalizeDisplayText(visibleText);
  return visible.length > 0 && normalizeDisplayText(formulaText).startsWith(visible);
}

function normalizeDisplayText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "");
}

function classifyConfirmedEvidence(formulaText: string, visibleText: string) {
  if (formulaText.length === 0) return normalizeDisplayText(visibleText).length > 0
    ? { terminal_status: "horizontal_overflow_blank", correspondence: "formula_empty_visible_text", conflict_reason: null }
    : { terminal_status: "ordinary_blank", correspondence: "both_empty", conflict_reason: null };
  return visibleTextMatchesFormula(visibleText, formulaText)
    ? { terminal_status: "review_origin", correspondence: "visible_text_matches_formula", conflict_reason: null }
    : { terminal_status: "evidence_conflict", correspondence: "visible_text_conflicts_with_formula", conflict_reason: "visible_text_formula_mismatch" };
}

function assertReadSequence(reads: Array<Record<string, any>>) {
  if (reads.some((read, index) => read.sequence !== index + 1)) throw new Error("invalid formula-bar read sequence");
}

function validateReference(reference: unknown, expectedKind: EvidenceReference["kind"]): EvidenceReference | null {
  if (reference === null) return null;
  if (!isRecord(reference) || reference.kind !== expectedKind || typeof reference.path !== "string" || !reference.path
    || typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(reference.sha256)) {
    throw new Error("invalid formula-bar evidence reference");
  }
  return reference as EvidenceReference;
}

async function verifyEvidenceFiles(evidencePath: string, evidence: FormulaBarEvidence) {
  for (const reference of [evidence.evidence.cell_image, evidence.evidence.conflict_image]) {
    if (reference === null) continue;
    const path = isAbsolute(reference.path) ? reference.path : resolve(dirname(evidencePath), reference.path);
    let bytes: Uint8Array;
    try { bytes = await readFile(path); } catch { throw new Error(`formula-bar evidence file is missing: ${reference.path}`); }
    if (sha256Bytes(bytes) !== reference.sha256) throw new Error(`formula-bar evidence file hash mismatch: ${reference.path}`);
  }
}

async function captureConflict(
  target: FormulaBarTarget,
  parsed: ReturnType<typeof parseAddress>,
  source: FormulaBarCellSource,
  activeAddresses: string[],
  formulaBarReads: Array<{ sequence: number; value: string; sha256: string }>,
  reason: "active_address_mismatch" | "formula_bar_reads_mismatch",
) {
  const conflictImage = await source.captureEvidence({ kind: "conflict", target });
  const content = {
    contract_version: FORMULA_BAR_CONTRACT_VERSION,
    key: `${target.worksheet}|${parsed.row}|${parsed.column}`,
    worksheet: target.worksheet,
    row: parsed.row,
    column: parsed.column,
    target_address: target.address,
    active_addresses: activeAddresses,
    formula_bar_reads: formulaBarReads,
    formula_bar_value: null,
    formula_bar_text_sha256: null,
    formula_bar_nonempty: null,
    visible_cell_text: null,
    visible_cell_text_sha256: null,
    correspondence: "not_checked" as const,
    terminal_status: "evidence_conflict" as const,
    conflict_reason: reason,
    halt_batch: true,
    read_only: true,
    captured_at: source.now(),
    evidence: { cell_image: null, conflict_image: conflictImage },
  };
  return { ...content, record_sha256: sha256(stableJson(content)) };
}

function normalizeTarget(target: FormulaBarTarget): FormulaBarTarget {
  if (!target.worksheet.trim()) throw new Error("worksheet is required");
  return { worksheet: target.worksheet, address: normalizeAddress(target.address) };
}

function normalizeAddress(address: string) {
  return parseAddress(address).address;
}

function parseAddress(address: string) {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(address.trim());
  if (!match) throw new Error(`invalid cell address: ${address}`);
  return { address: `${match[1].toUpperCase()}${match[2]}`, column: match[1].toUpperCase(), row: Number(match[2]) };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
