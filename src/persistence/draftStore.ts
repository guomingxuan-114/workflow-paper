import { PRODUCT } from "../config/product";
import type { WorkflowDocument } from "../core/types";

export interface RecoveryDraft {
  id: "current";
  fileName: string | null;
  savedAt: string;
  document: WorkflowDocument;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PRODUCT.draftDatabase, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PRODUCT.draftStore)) {
        database.createObjectStore(PRODUCT.draftStore, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveRecoveryDraft(
  document: WorkflowDocument,
  fileName: string | null,
): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PRODUCT.draftStore, "readwrite");
    transaction.objectStore(PRODUCT.draftStore).put({
      id: "current",
      fileName,
      savedAt: new Date().toISOString(),
      document,
    } satisfies RecoveryDraft);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function loadRecoveryDraft(): Promise<RecoveryDraft | null> {
  const database = await openDatabase();
  const draft = await new Promise<RecoveryDraft | null>((resolve, reject) => {
    const transaction = database.transaction(PRODUCT.draftStore, "readonly");
    const request = transaction.objectStore(PRODUCT.draftStore).get("current");
    request.onsuccess = () => resolve((request.result as RecoveryDraft) ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return draft;
}

export async function clearRecoveryDraft(): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PRODUCT.draftStore, "readwrite");
    transaction.objectStore(PRODUCT.draftStore).delete("current");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

