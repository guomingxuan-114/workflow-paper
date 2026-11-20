import { promises as fs } from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const MAX_BODY_BYTES = 50 * 1024 * 1024;
const productConfig = JSON.parse(
  readFileSync(new URL("../product.config.json", import.meta.url), "utf8"),
);
const ALLOWED_EXTENSION = `.${productConfig.fileExtension}`;

function safeName(input) {
  const cleaned = String(input ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/^\.+/, "");
  if (!cleaned) throw new Error("文件名不能为空");
  return cleaned.toLowerCase().endsWith(ALLOWED_EXTENSION)
    ? cleaned
    : `${cleaned}${ALLOWED_EXTENSION}`;
}

function json(response, status, value) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("请求体超过 50 MB 限制"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("请求体不是有效 JSON"));
      }
    });
    request.on("error", reject);
  });
}

async function atomicWrite(directory, name, data) {
  const target = path.join(directory, name);
  const temporary = path.join(directory, `.${name}.tmp-${randomUUID()}`);
  const backup = path.join(directory, `.${name}.bak-${randomUUID()}`);
  const handle = await fs.open(temporary, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }

  let movedExisting = false;
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    if (!["EEXIST", "EPERM", "EACCES"].includes(error.code)) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    try {
      await fs.rename(target, backup);
      movedExisting = true;
    } catch (moveError) {
      if (moveError.code !== "ENOENT") {
        await fs.rm(temporary, { force: true });
        throw moveError;
      }
    }
    try {
      await fs.rename(temporary, target);
      if (movedExisting) await fs.rm(backup, { force: true });
    } catch (error) {
      if (movedExisting) await fs.rename(backup, target);
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }
}

export function createHostMiddleware(workspaceRoot, options = {}) {
  const documentsDir = path.join(workspaceRoot, "documents");
  return async function hostMiddleware(request, response, next) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/")) return next();

    try {
      if (url.pathname === "/api/status" && request.method === "GET") {
        await fs.mkdir(documentsDir, { recursive: true });
        return json(response, 200, {
          host: "local-shell",
          appVersion: productConfig.appVersion,
          atomicSave: true,
          documentsDir,
        });
      }

      if (url.pathname === "/api/shutdown" && request.method === "POST") {
        json(response, 200, { stopping: true });
        if (typeof options.onShutdown === "function") {
          setImmediate(options.onShutdown);
        }
        return;
      }

      if (url.pathname === "/api/documents" && request.method === "GET") {
        await fs.mkdir(documentsDir, { recursive: true });
        const entries = await fs.readdir(documentsDir, { withFileTypes: true });
        const documents = [];
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.toLowerCase().endsWith(ALLOWED_EXTENSION)) {
            continue;
          }
          const stats = await fs.stat(path.join(documentsDir, entry.name));
          documents.push({ name: entry.name, size: stats.size, modifiedAt: stats.mtime.toISOString() });
        }
        documents.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
        return json(response, 200, documents);
      }

      if (url.pathname === "/api/documents" && request.method === "POST") {
        const body = await readJson(request);
        const name = safeName(body.name);
        if (typeof body.data !== "string") throw new Error("data 必须为 base64 字符串");
        const bytes = Buffer.from(body.data, "base64");
        if (bytes.length === 0) throw new Error("工作流文件为空");
        await fs.mkdir(documentsDir, { recursive: true });
        await atomicWrite(documentsDir, name, bytes);
        return json(response, 200, { name, saved: true, atomic: true });
      }

      if (
        url.pathname.startsWith("/api/documents/") &&
        request.method === "GET"
      ) {
        const requested = decodeURIComponent(
          url.pathname.slice("/api/documents/".length),
        );
        const name = safeName(requested);
        const data = await fs.readFile(path.join(documentsDir, name));
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/zip");
        response.setHeader(
          "Content-Disposition",
          `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        );
        return response.end(data);
      }

      return json(response, 404, { error: "未知的本地宿主接口" });
    } catch (error) {
      response.statusCode = 400;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      return response.end(error instanceof Error ? error.message : "请求失败");
    }
  };
}

