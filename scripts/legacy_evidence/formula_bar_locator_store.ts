import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readFormulaBarEvidence, writeFormulaBarEvidence, type FormulaBarTarget } from "./formula_bar";
import {
  validateFormulaBarLocatorCheckpoint,
  type FormulaBarLocatorCheckpoint,
  type FormulaBarLocatorStore,
} from "./formula_bar_locator";

export function createFileFormulaBarLocatorStore(root: string): FormulaBarLocatorStore {
  return {
    async loadEvidence(target) {
      const path = evidencePath(root, target);
      if (!await exists(path)) return null;
      return readFormulaBarEvidence(path);
    },
    async persistEvidence(target, evidence) {
      const path = evidencePath(root, target);
      if (await exists(path)) {
        const existing = await readFormulaBarEvidence(path);
        if (existing.record_sha256 === evidence.record_sha256) return;
        throw new Error(`formula-bar evidence changed; create a new evidence version: ${evidence.key}`);
      }
      await writeFormulaBarEvidence(path, evidence);
    },
    async persistCheckpoint(checkpoint) {
      validateFormulaBarLocatorCheckpoint(checkpoint);
      const path = checkpointPath(root, checkpoint);
      if (await exists(path)) {
        const existing: unknown = JSON.parse(await readFile(path, "utf8"));
        validateFormulaBarLocatorCheckpoint(existing);
        if (existing.checkpoint_sha256 === checkpoint.checkpoint_sha256) return;
        throw new Error(`formula-bar checkpoint changed; create a new evidence version: ${checkpoint.sequence}`);
      }
      await writeJsonAtomic(path, checkpoint);
    },
  };
}

export function formulaBarEvidencePath(root: string, target: FormulaBarTarget) {
  return evidencePath(root, target);
}

function evidencePath(root: string, target: FormulaBarTarget) {
  const worksheet = safeSegment(target.worksheet);
  const address = safeSegment(target.address.toUpperCase());
  return join(root, "evidence", worksheet, `${address}.json`);
}

function checkpointPath(root: string, checkpoint: FormulaBarLocatorCheckpoint) {
  const sequence = String(checkpoint.sequence).padStart(4, "0");
  const worksheet = safeSegment(checkpoint.worksheet);
  return join(root, "checkpoints", `${sequence}-${worksheet}-rows${checkpoint.first_row}-${checkpoint.last_row}.json`);
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function exists(path: string) {
  try { await stat(path); return true; } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function safeSegment(value: string) {
  if (!value || value === "." || value === ".." || /[\\/\0]/.test(value)) {
    throw new Error(`unsafe formula-bar evidence path segment: ${value}`);
  }
  return value;
}
