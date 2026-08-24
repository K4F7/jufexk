/**
 * 候选与教务快照放 IndexedDB；小型计划仍走 localStorage。
 * 页面加载只读本机缓存，不访问教务。
 */
import { loadPlan, savePlan, type SchedulePlanV2 } from "./jwxt-plan";
import {
  mergeSnapshots,
  snapshotSelectionKey,
  type JwxtSnapshotV1,
} from "./jwxt-snapshot";

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
      const store = tx.objectStore(JWXT_SNAPSHOT_STORE);
      store.put(snapshot, snapshotSelectionKey(snapshot));
      store.delete(JWXT_SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("快照写入失败"));
    });
  } finally {
    db.close();
  }
}

export async function loadSnapshotCache(): Promise<JwxtSnapshotV1 | null> {
  return (await loadSnapshotCaches())[0] ?? null;
}

export async function loadSnapshotCaches(): Promise<JwxtSnapshotV1[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  try {
    return await new Promise<JwxtSnapshotV1[]>((resolve, reject) => {
      const tx = db.transaction(JWXT_SNAPSHOT_STORE, "readonly");
      const request = tx.objectStore(JWXT_SNAPSHOT_STORE).getAll();
      request.onsuccess = () => {
        const merged = new Map<string, JwxtSnapshotV1>();
        for (const snapshot of request.result as JwxtSnapshotV1[]) {
          const key = snapshotSelectionKey(snapshot);
          const previous = merged.get(key);
          merged.set(key, previous ? mergeSnapshots(previous, snapshot) : snapshot);
        }
        resolve([...merged.values()]);
      };
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
      tx.objectStore(JWXT_SNAPSHOT_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("快照删除失败"));
    });
  } finally {
    db.close();
  }
}

export { loadPlan, savePlan };
export type { SchedulePlanV2 };
