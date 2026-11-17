import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PRODUCT } from "../config/product";
import { checksumText } from "./checksum";
import { validateDocument, WorkflowValidationError } from "./document";
import type { WorkflowDocument, WorkflowManifest } from "./types";

const MANIFEST_PATH = "manifest.json";
const DOCUMENT_PATH = "document.json";

export function documentToJson(document: WorkflowDocument): string {
  return JSON.stringify(document, null, 2);
}

export function packWorkflow(document: WorkflowDocument): Uint8Array {
  const documentJson = documentToJson(document);
  const manifest: WorkflowManifest = {
    format: "local-workflow",
    containerVersion: 1,
    documentSchemaVersion: 1,
    product: PRODUCT.name,
    appVersion: PRODUCT.appVersion,
    createdAt: new Date().toISOString(),
    checksum: checksumText(documentJson),
    files: [MANIFEST_PATH, DOCUMENT_PATH, "assets/README.txt", "preview/README.txt"],
  };
  return zipSync(
    {
      [MANIFEST_PATH]: strToU8(JSON.stringify(manifest, null, 2)),
      [DOCUMENT_PATH]: strToU8(documentJson),
      "assets/README.txt": strToU8(
        "工作流附件目录。初版保留该入口，文件内容仍由 document.json 引用。\n",
      ),
      "preview/README.txt": strToU8(
        "预览目录。预览是可重建缓存，不是工作流语义的权威来源。\n",
      ),
    },
    { level: 6 },
  );
}

export function unpackWorkflow(data: Uint8Array): WorkflowDocument {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new WorkflowValidationError("无法打开文件：这不是有效的 ZIP 容器");
  }

  const manifestBytes = files[MANIFEST_PATH];
  const documentBytes = files[DOCUMENT_PATH];
  if (!manifestBytes || !documentBytes) {
    throw new WorkflowValidationError(
      "工作流文件缺少 manifest.json 或 document.json",
    );
  }

  let manifest: WorkflowManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as WorkflowManifest;
  } catch {
    throw new WorkflowValidationError("manifest.json 不是有效 JSON");
  }
  if (manifest.format !== "local-workflow") {
    throw new WorkflowValidationError("文件不是本产品的工作流容器");
  }
  if (manifest.containerVersion !== 1) {
    throw new WorkflowValidationError(
      `不支持的容器版本：${String(manifest.containerVersion)}`,
    );
  }

  const documentJson = strFromU8(documentBytes);
  if (manifest.checksum !== checksumText(documentJson)) {
    throw new WorkflowValidationError(
      "document.json 校验失败，文件可能已损坏或被截断",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(documentJson);
  } catch {
    throw new WorkflowValidationError("document.json 不是有效 JSON");
  }
  return validateDocument(parsed);
}

