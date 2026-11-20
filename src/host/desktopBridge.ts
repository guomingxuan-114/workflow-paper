export interface DesktopSaveResult {
  canceled: boolean;
  fileName?: string;
  mode?: string;
}

export interface DesktopOpenResult {
  fileName: string;
  data: string;
}

export interface DesktopBridge {
  saveWorkflow(payload: {
    fileName: string | null;
    proposedName: string;
    saveAs: boolean;
    autoSave: boolean;
    data: string;
  }): Promise<DesktopSaveResult>;
  openWorkflow(): Promise<DesktopOpenResult | null>;
  exportPdf(payload: { html: string; title: string }): Promise<"print">;
  setDirty(value: boolean): void;
  onMenuCommand(callback: (command: string) => void): () => void;
}

export function getDesktopBridge(): DesktopBridge | undefined {
  return (
    window as Window & {
      workflowDesktop?: DesktopBridge;
    }
  ).workflowDesktop;
}
