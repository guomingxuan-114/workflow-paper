const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const product = require("../product.config.json");

if (process.env.WORKFLOW_DESKTOP_TEST_USER_DATA) {
  app.setPath("userData", process.env.WORKFLOW_DESKTOP_TEST_USER_DATA);
}

let mainWindow = null;
let rendererDirty = false;
let currentDocumentPath = null;
let printWindow = null;

const gotLock =
  process.env.WORKFLOW_DESKTOP_TEST === "1"
    ? true
    : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function appRoot() {
  return path.join(__dirname, "..");
}

function defaultDocumentsDirectory() {
  return path.join(app.getPath("documents"), product.name);
}

function safeFileName(value) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/^\.+/, "");
  const base = cleaned || "\u672A\u547D\u540D\u5DE5\u4F5C\u6D41";
  return base.toLowerCase().endsWith(`.${product.fileExtension}`)
    ? base
    : `${base}.${product.fileExtension}`;
}

async function atomicWrite(target, data) {
  const directory = path.dirname(target);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.tmp-${randomUUID()}`);
  const backup = path.join(directory, `.${path.basename(target)}.bak-${randomUUID()}`);
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

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 560,
    show: false,
    backgroundColor: "#f7f5ef",
    title: product.name,
    icon: path.join(appRoot(), "build", "icon.ico"),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void mainWindow.loadFile(path.join(appRoot(), "dist", "index.html"));
}

function sendMenuCommand(command) {
  mainWindow?.webContents.send("workflow:menu-command", command);
}

function createMenu() {
  const template = [
    {
      label: "\u6587\u4EF6",
      submenu: [
        { label: "\u65B0\u5EFA\u5DE5\u4F5C\u6D41", accelerator: "CmdOrCtrl+N", click: () => sendMenuCommand("new") },
        { label: "\u6253\u5F00\u5DE5\u4F5C\u6D41", accelerator: "CmdOrCtrl+O", click: () => sendMenuCommand("open") },
        { type: "separator" },
        { label: "\u4FDD\u5B58", accelerator: "CmdOrCtrl+S", click: () => sendMenuCommand("save") },
        { label: "\u53E6\u5B58\u4E3A", accelerator: "CmdOrCtrl+Shift+S", click: () => sendMenuCommand("save-as") },
        { label: "\u5BFC\u51FA PDF", accelerator: "CmdOrCtrl+E", click: () => sendMenuCommand("export-pdf") },
        { type: "separator" },
        { role: "quit", label: "\u9000\u51FA" },
      ],
    },
    {
      label: "\u89C6\u56FE",
      submenu: [
        { role: "reload", label: "\u5237\u65B0" },
        { role: "resetZoom", label: "\u5B9E\u9645\u5927\u5C0F" },
        { role: "zoomIn", label: "\u653E\u5927" },
        { role: "zoomOut", label: "\u7F29\u5C0F" },
        { type: "separator" },
        { role: "togglefullscreen", label: "\u5168\u5C4F" },
      ],
    },
    {
      label: "\u5E2E\u52A9",
      submenu: [
        {
          label: "\u5173\u4E8E\u6D41\u7A0B\u7A3F\u7EB8",
          click: () => dialog.showMessageBox({
            type: "info",
            title: `\u5173\u4E8E ${product.name}`,
            message: product.name,
            detail: `\u7248\u672C ${product.appVersion}\n\u672C\u5730\u4F18\u5148\u7684\u53EF\u89C6\u5316\u5DE5\u4F5C\u6D41\u6587\u6863\u7F16\u8F91\u5668`,
            buttons: ["\u786E\u5B9A"],
          }),
        },
        {
          label: "\u6253\u5F00\u6587\u6863\u76EE\u5F55",
          click: () => shell.openPath(defaultDocumentsDirectory()),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.on("workflow:set-dirty", (_event, value) => {
    rendererDirty = Boolean(value);
  });

  ipcMain.handle("workflow:open", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "\u6253\u5F00\u5DE5\u4F5C\u6D41",
      properties: ["openFile"],
      filters: [
        { name: "\u6D41\u7A0B\u7A3F\u7EB8\u5DE5\u4F5C\u6D41", extensions: [product.fileExtension] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    currentDocumentPath = result.filePaths[0];
    const bytes = await fs.readFile(currentDocumentPath);
    return {
      fileName: path.basename(currentDocumentPath),
      data: bytes.toString("base64"),
    };
  });

  ipcMain.handle("workflow:save", async (_event, payload) => {
    const requestedName = safeFileName(payload.fileName || payload.proposedName);
    let target = null;
    if (
      !payload.saveAs &&
      payload.fileName &&
      currentDocumentPath &&
      path.basename(currentDocumentPath) === requestedName
    ) {
      target = currentDocumentPath;
    }

    if (!target && payload.autoSave && !currentDocumentPath) {
      target = path.join(defaultDocumentsDirectory(), requestedName);
    }

    if (!target) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "\u4FDD\u5B58\u5DE5\u4F5C\u6D41",
        defaultPath: path.join(defaultDocumentsDirectory(), requestedName),
        filters: [
          { name: "\u6D41\u7A0B\u7A3F\u7EB8\u5DE5\u4F5C\u6D41", extensions: [product.fileExtension] },
        ],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      target = result.filePath.toLowerCase().endsWith(`.${product.fileExtension}`)
        ? result.filePath
        : `${result.filePath}.${product.fileExtension}`;
    }

    await atomicWrite(target, Buffer.from(payload.data, "base64"));
    currentDocumentPath = target;
    return {
      canceled: false,
      fileName: path.basename(target),
      mode: "local-atomic",
    };
  });

  ipcMain.handle("workflow:export-pdf", async (_event, payload) => {
    const temporary = path.join(app.getPath("temp"), `workflow-print-${randomUUID()}.html`);
    await fs.writeFile(temporary, payload.html, "utf8");
    if (printWindow && !printWindow.isDestroyed()) printWindow.close();
    printWindow = new BrowserWindow({
      width: 1120,
      height: 900,
      show: true,
      title: `${payload.title}.pdf`,
      parent: mainWindow,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await new Promise((resolve, reject) => {
      printWindow.webContents.once("did-finish-load", resolve);
      printWindow.webContents.once(
        "did-fail-load",
        (_event, code, description) =>
          reject(new Error(`Print preview failed: ${code} ${description}`)),
      );
      void printWindow.loadFile(temporary);
    });
    if (printWindow) {
      setTimeout(() => {
        printWindow?.webContents.print({ silent: false, printBackground: true });
      }, 450);
    }
    printWindow.once("closed", () => {
      printWindow = null;
      void fs.rm(temporary, { force: true });
    });
    return "print";
  });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  registerIpc();
  createMenu();
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
