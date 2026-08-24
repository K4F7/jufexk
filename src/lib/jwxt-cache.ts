/**
 * 候选与教务快照放 IndexedDB；小型计划仍走 localStorage。
 * 页面加载只读本机缓存，不访问教务。
 */
import { loadPlan, savePlan, type SchedulePlanV2 } from "./jwxt-plan";
import type { JwxtSnapshotV1 } from "./jwxt-snapshot";

export const JWXT_IDB_NAME = "jufexk-jwxt";
export const JWXT_IDB_VERSION = 1;
export const JWXT_SNAPSHOT_STORE = "snapshots";
export const JWXT_SNAPSHOT_KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(JWXT_IDB_NAME, JWXT_IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(JWXT_SNAPSHOT_STORE)) {
        db.createObjectStore(JWXT_SNAPSHOT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 打开失败"));
  });
}

export async function saveSnapshotCache(snapshot: JwxtSnapshotV1): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(JWXT_SNAPSHOT_STORE, "readwrite");
      tx.objectStore(JWXT_SNAPSHOT_STORE).put(snapshot, JWXT_SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("快照写入失败"));
    });
  } finally {
    db.close();
  }
}

export async function loadSnapshotCache(): Promise<JwxtSnapshotV1 | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  try {
    return await new Promise<JwxtSnapshotV1 | null>((resolve, reject) => {
      const tx = db.transaction(JWXT_SNAPSHOT_STORE, "readonly");
      const request = tx.objectStore(JWXT_SNAPSHOT_STORE).get(JWXT_SNAPSHOT_KEY);
      request.onsuccess = () => resolve((request.result as JwxtSnapshotV1) ?? null);
      request.onerror = () => reject(request.error ?? new Error("快照读取失败"));
    });
  } finally {
    db.close();
  }
}

export async function clearSnapshotCache(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(JWXT_SNAPSHOT_STORE, "readwrite");
      tx.objectStore(JWXT_SNAPSHOT_STORE).delete(JWXT_SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("快照删除失败"));
    });
  } finally {
    db.close();
  }
}

export { loadPlan, savePlan };
export type { SchedulePlanV2 };
