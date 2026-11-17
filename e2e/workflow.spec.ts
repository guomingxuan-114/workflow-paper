import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("core editing, persistence, recovery, PDF and narrow layout", async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", async (message) => {
    if (message.type() !== "error") return;
    const values = await Promise.all(
      message.args().map((argument) =>
        argument
          .evaluate((value) =>
            value instanceof Error
              ? value.stack ?? value.message
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value),
          )
          .catch(() => "[unserializable]"),
      ),
    );
    consoleErrors.push(
      [message.text(), ...values.map(String)].join(" | "),
    );
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.stack ?? error.message);
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /把流程画下来/ })).toBeVisible();
  await page.getByRole("button", { name: "新建空白" }).click();
  await page.waitForTimeout(300);
  await expect(page.getByLabel("工作流画布")).toBeVisible();

  const canvas = page.locator(".react-flow__pane");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Canvas has no dimensions");
  const viewportBefore = await page
    .locator(".react-flow__viewport")
    .getAttribute("style");
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.72,
    canvasBox.y + canvasBox.height * 0.72,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.72 + 90,
    canvasBox.y + canvasBox.height * 0.72 + 55,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect
    .poll(() =>
      page.locator(".react-flow__viewport").getAttribute("style"),
    )
    .not.toBe(viewportBefore);

  await page.mouse.click(
    canvasBox.x + canvasBox.width * 0.38,
    canvasBox.y + canvasBox.height * 0.42,
    { button: "right" },
  );
  await page.getByRole("menuitem", { name: /新建步骤/ }).click();
  await expect(page.locator(".workflow-node")).toHaveCount(1);

  await page.locator(".workflow-node").first().dblclick();
  const editor = page.getByRole("dialog", { name: "编辑节点内容" });
  await editor.getByLabel("标题").fill("接收需求");
  await editor
    .getByLabel("描述")
    .fill("记录输入范围、约束和验收标准。");
  await editor.getByRole("button", { name: "保存内容" }).click();
  await expect(page.getByText("接收需求", { exact: true }).first()).toBeVisible();

  await page.keyboard.press("Control+z");
  await expect(page.getByText("新步骤", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByText("接收需求", { exact: true }).first()).toBeVisible();

  const sourceHandle = page.locator(".node-handle--source").first();
  const handleBox = await sourceHandle.boundingBox();
  if (!handleBox) throw new Error("Source handle has no dimensions");
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + 280,
    handleBox.y + 45,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(page.locator(".workflow-node")).toHaveCount(2);

  page.once("dialog", (dialog) => dialog.accept("e2e-flow"));
  await page.getByLabel("保存").click();
  await expect(page.getByText("已原子保存到本地文档目录")).toBeVisible();
  const savedPath = path.resolve("documents/e2e-flow.wflow");
  await expect.poll(() => fs.existsSync(savedPath)).toBe(true);
  const savedBytes = fs.readFileSync(savedPath);
  expect(savedBytes.subarray(0, 2).toString()).toBe("PK");

  await page.reload();
  await expect(page.getByRole("heading", { name: /把流程画下来/ })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("1"));
  await page.getByRole("button", { name: "打开本地文件" }).click();
  await expect(page.getByLabel("工作流画布")).toBeVisible();
  await expect(page.locator(".workflow-node")).toHaveCount(2);
  await expect(page.getByText("接收需求", { exact: true }).first()).toBeVisible();

  await page.locator(".workflow-node").first().dblclick();
  const renameEditor = page.getByRole("dialog", { name: "编辑节点内容" });
  await renameEditor.getByLabel("标题").fill("接收需求 v2");
  await renameEditor.getByRole("button", { name: "保存内容" }).click();
  await page.waitForTimeout(800);
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  const recovery = page.getByRole("dialog", { name: "发现未保存的编辑" });
  await expect(recovery).toBeVisible();
  await recovery.getByRole("button", { name: "恢复工作流" }).click();
  await expect(page.getByText("接收需求 v2", { exact: true }).first()).toBeVisible();

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "导出 PDF" }).click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");
  await expect(printPage.locator(".print-page")).toHaveCount(2);
  await expect(
    printPage.getByRole("heading", { name: "接收需求 v2" }),
  ).toBeVisible();
  await expect(printPage.getByText(/第 1 \/ 2 页/)).toBeVisible();
  const outputDir = path.resolve("tmp/validation");
  fs.mkdirSync(outputDir, { recursive: true });
  await printPage.pdf({
    path: path.join(outputDir, "e2e-export.pdf"),
    format: "A4",
    printBackground: true,
  });

  await page.setViewportSize({ width: 390, height: 840 });
  await page.getByLabel("打开大纲").click();
  await expect(page.locator(".sidebar")).toBeVisible();
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);

  await expect(page.getByRole("button", { name: "导出 PDF" })).toBeVisible();
  expect(consoleErrors.filter((message) => !message.includes("打印"))).toEqual([]);
});

test("imported snapshot keeps groups and exports complete paginated PDF", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "导入示例" }).click();
  await expect(page.getByLabel("工作流画布")).toBeVisible();
  await expect(page.locator(".workflow-node")).toHaveCount(6);
  await expect(page.locator(".workflow-group")).toHaveCount(2);

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "导出 PDF" }).click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");
  await expect(printPage.locator(".print-page")).toHaveCount(4);
  await expect(
    printPage.getByRole("heading", { name: "准备与验证" }),
  ).toBeVisible();
  await expect(
    printPage.getByRole("heading", { name: "发布决策" }),
  ).toBeVisible();
  await expect(printPage.getByText("执行单元测试、契约测试与静态检查。")).toBeVisible();
  const outputDir = path.resolve("output/pdf");
  fs.mkdirSync(outputDir, { recursive: true });
  await printPage.pdf({
    path: path.join(outputDir, "sample-workflow.pdf"),
    format: "A4",
    printBackground: true,
  });

  await page.locator(".workflow-group .group-collapse").first().click();
  await expect(page.locator(".workflow-node")).toHaveCount(4);
  await page.locator(".workflow-group .group-collapse").first().click();
  await expect(page.locator(".workflow-node")).toHaveCount(6);

  const firstNode = page.locator(".workflow-node").first();
  const nodeBox = await firstNode.boundingBox();
  if (!nodeBox) throw new Error("Imported node has no dimensions");
  await page.mouse.move(nodeBox.x + 40, nodeBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + 100, nodeBox.y + 70, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(5);

  const edgePoint = await page
    .locator(".workflow-edge-hitarea")
    .first()
    .evaluate((path) => {
      const point = (path as SVGPathElement).getPointAtLength(
        (path as SVGPathElement).getTotalLength() / 2,
      );
      const matrix = (path as SVGPathElement).getScreenCTM();
      if (!matrix) return { x: 0, y: 0 };
      return {
        x: point.x * matrix.a + point.y * matrix.c + matrix.e,
        y: point.x * matrix.b + point.y * matrix.d + matrix.f,
      };
    });
  await page.mouse.click(edgePoint.x, edgePoint.y);
  const edgeLabel = page.getByLabel("连线标签");
  await edgeLabel.fill("已校验");
  await edgeLabel.press("Tab");

  await page.getByRole("tab", { name: "大纲" }).click();
  const mainOutline = page.getByRole("main").getByTestId("outline-view");
  await expect(mainOutline).toBeVisible();
  await expect(
    mainOutline.getByLabel("大纲节点 运行质量门禁"),
  ).toHaveValue("运行质量门禁");
});

