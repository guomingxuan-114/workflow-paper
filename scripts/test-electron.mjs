import { _electron as electron } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagedExecutable = process.env.WORKFLOW_APP_EXE;
const executablePath =
  packagedExecutable ||
  path.join(root, "node_modules", "electron", "dist", "electron.exe");
const testDirectory = path.join(root, ".electron-test");
const savePath = path.join(testDirectory, "desktop-smoke.wflow");
const userDataDirectory = path.join(testDirectory, "user-data");

await fs.rm(testDirectory, { recursive: true, force: true });
await fs.mkdir(testDirectory, { recursive: true });

const electronApp = await electron.launch({
  executablePath,
  args: packagedExecutable ? [] : ["."],
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    WORKFLOW_DESKTOP_TEST: "1",
    WORKFLOW_DESKTOP_TEST_USER_DATA: userDataDirectory,
  },
  timeout: 30_000,
});

try {
  electronApp.process().stdout?.on("data", (data) => process.stdout.write(data));
  electronApp.process().stderr?.on("data", (data) => process.stderr.write(data));
  electronApp.on("window", async (window) => {
    console.log("Electron window:", window.url());
    window.on("pageerror", (error) => console.error("Renderer:", error));
    window.on("console", (message) => {
      if (message.type() === "error") {
        console.error("Renderer console:", message.text());
      }
    });
  });
  const page = await electronApp.firstWindow({ timeout: 20_000 });
  await page.waitForLoadState("domcontentloaded");
  console.log("Loaded:", await page.title(), page.url());
  if ((await page.title()) !== "流程稿纸") {
    throw new Error(`Unexpected window title: ${await page.title()}`);
  }
  await page.getByRole("heading", { name: /把流程画下来/ }).waitFor();
  await page.getByRole("button", { name: "新建空白" }).click();
  await page.getByLabel("工作流画布").waitFor();
  await page.getByLabel("切换深色模式").click();
  await page.locator(".app-shell").waitFor();
  const theme = await page.locator(".app-shell").getAttribute("data-theme");
  if (theme !== "dark") {
    throw new Error(`Dark theme did not apply: ${theme}`);
  }
  await page.getByLabel("切换浅色模式").click();
  await page.keyboard.press("Tab");
  const editor = page.getByRole("dialog", { name: "编辑节点内容" });
  await editor.getByLabel("标题").fill("桌面版验收");
  await editor.getByLabel("描述").fill("通过 Electron 原生窗口保存。");
  await editor.getByRole("button", { name: "保存内容" }).click();

  await electronApp.evaluate(
    async ({ dialog }, targetPath) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: targetPath,
      });
    },
    savePath,
  );

  await page.getByRole("button", { name: "保存", exact: true }).click();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const bytes = await fs.readFile(savePath);
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) break;
    } catch {
      // Save dialog/atomic write may still be in progress.
    }
    await page.waitForTimeout(150);
  }
  const saved = await fs.readFile(savePath);
  if (saved[0] !== 0x50 || saved[1] !== 0x4b) {
    throw new Error("Electron save did not produce a ZIP-based .wflow file");
  }
  await page.waitForTimeout(500);

  const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return window?.getBounds();
  });
  if (!bounds || bounds.width < 700) {
    throw new Error("Main application window was not created correctly");
  }

  console.log(
    JSON.stringify({
      desktopWindow: true,
      title: await page.title(),
      savedBytes: saved.length,
      bounds,
    }),
  );
} finally {
  await electronApp.close();
  await fs.rm(testDirectory, { recursive: true, force: true });
}
