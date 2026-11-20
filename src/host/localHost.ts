import { PRODUCT, fileAccept } from "../config/product";
import { packWorkflow, unpackWorkflow } from "../core/wflow";
import type { WorkflowDocument } from "../core/types";
import type {
  HostDocument,
  HostSaveResult,
  WorkflowHost,
} from "./types";
import { getDesktopBridge } from "./desktopBridge";

function safeDownloadName(name: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|]+/g, "-") || "未命名工作流";
  return base.endsWith(`.${PRODUCT.fileExtension}`)
    ? base
    : `${base}.${PRODUCT.fileExtension}`;
}

function download(bytes: BlobPart, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function localHostAvailable(): Promise<boolean> {
  try {
    const response = await fetch("/api/status", {
      headers: { Accept: "application/json" },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function chooseWorkflowFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = fileAccept;
    input.hidden = true;
    input.addEventListener(
      "change",
      () => {
        resolve(input.files?.[0] ?? null);
        input.remove();
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
  });
}

function createPdfHtmlHost(): WorkflowHost["exportHtml"] {
  return async (html, title) => {
    const popup = window.open("", "_blank", "width=1120,height=900");
    if (popup) {
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
      popup.document.title = `${title}.pdf`;
      popup.focus();
      window.setTimeout(() => popup.print(), 500);
      return "print";
    }
    download(html, `${title}.html`, "text/html;charset=utf-8");
    return "download";
  };
}

export const localHost: WorkflowHost = {
  kind: "local-shell",

  async supportsAtomicAutoSave() {
    if (getDesktopBridge()) return true;
    return localHostAvailable();
  },

  async openWorkflow(): Promise<HostDocument | null> {
    const desktop = getDesktopBridge();
    if (desktop) {
      const opened = await desktop.openWorkflow();
      if (!opened) return null;
      const bytes = base64ToBytes(opened.data);
      return {
        fileName: opened.fileName,
        bytes,
        document: unpackWorkflow(bytes),
      };
    }
    if (await localHostAvailable()) {
      const response = await fetch("/api/documents");
      if (response.ok) {
        const documents = (await response.json()) as Array<{ name: string }>;
        if (documents.length > 0) {
          const options = documents
            .slice(0, 8)
            .map((item, index) => `${index + 1}. ${item.name}`)
            .join("\n");
          const answer = window.prompt(
            `输入本地文档编号，或取消后手动选择文件：\n\n${options}`,
            "1",
          );
          if (answer) {
            const selected =
              documents[Number.parseInt(answer, 10) - 1] ?? documents[0];
            if (selected) {
              const openResponse = await fetch(
                `/api/documents/${encodeURIComponent(selected.name)}`,
              );
              if (openResponse.ok) {
                const bytes = new Uint8Array(await openResponse.arrayBuffer());
                return {
                  fileName: selected.name,
                  bytes,
                  document: unpackWorkflow(bytes),
                };
              }
            }
          }
        }
      }
    }
    const file = await chooseWorkflowFile();
    if (!file) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
      fileName: file.name,
      bytes,
      document: unpackWorkflow(bytes),
    };
  },

  async saveWorkflow(
    document: WorkflowDocument,
    currentName: string | null,
    saveAs = false,
    autoSave = false,
  ): Promise<HostSaveResult> {
    const desktop = getDesktopBridge();
    const bytes = packWorkflow(document);
    if (desktop) {
      const proposedName = safeDownloadName(document.metadata.title);
      const result = await desktop.saveWorkflow({
        fileName: currentName,
        proposedName,
        saveAs,
        autoSave,
        data: bytesToBase64(bytes),
      });
      if (result.canceled) throw new Error("已取消保存");
      return {
        fileName:
          result.fileName ??
          currentName ??
          proposedName,
        mode: "local-atomic",
      };
    }
    let name = saveAs ? null : currentName;
    if (!name) {
      const proposed = safeDownloadName(document.metadata.title);
      name = window.prompt(
        `保存为 .${PRODUCT.fileExtension} 工作流文件`,
        proposed,
      );
      if (!name) throw new Error("已取消保存");
    }
    name = safeDownloadName(name);
    if (await localHostAvailable()) {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data: bytesToBase64(bytes) }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(`本地原子保存失败：${message}`);
      }
      return { fileName: name, mode: "local-atomic" };
    }
    download(bytes.buffer as ArrayBuffer, name, PRODUCT.fileMimeType);
    return { fileName: name, mode: "download" };
  },

  async exportHtml(html, title) {
    const desktop = getDesktopBridge();
    if (desktop) {
      return desktop.exportPdf({ html, title });
    }
    return createPdfHtmlHost()(html, title);
  },

  async readContext() {
    if (getDesktopBridge()) {
      return {
        host: "desktop",
        locale: navigator.language,
        offline: "true",
      };
    }
    return {
      host: "local-shell",
      locale: navigator.language,
      offline: String(!navigator.onLine),
    };
  },
};

export function decodeWorkflowBytes(bytes: Uint8Array): WorkflowDocument {
  return unpackWorkflow(bytes);
}

export { base64ToBytes };

