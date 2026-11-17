import type { WorkflowDocument } from "../core/types";

export interface HostDocument {
  fileName: string;
  document: WorkflowDocument;
  bytes: Uint8Array;
}

export interface HostSaveResult {
  fileName: string;
  mode: "local-atomic" | "download";
}

export interface WorkflowHost {
  readonly kind: "local-shell" | "browser";
  supportsAtomicAutoSave(): Promise<boolean>;
  openWorkflow(): Promise<HostDocument | null>;
  saveWorkflow(
    document: WorkflowDocument,
    currentName: string | null,
    saveAs?: boolean,
  ): Promise<HostSaveResult>;
  exportHtml(html: string, title: string): Promise<"print" | "download">;
  readContext(): Promise<Record<string, string>>;
}

