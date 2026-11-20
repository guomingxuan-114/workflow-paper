import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";

async function nodeBorderPoint(
  node: import("@playwright/test").Locator,
  side: "top" | "right" | "bottom" | "left",
) {
  const box = await node.locator(".node-border-hit-path").boundingBox();
  if (!box) throw new Error("Node border has no dimensions");
  if (side === "right") {
    return { x: box.x + box.width - 1, y: box.y + box.height / 2 };
  }
  if (side === "left") {
    return { x: box.x + 1, y: box.y + box.height / 2 };
  }
  if (side === "top") {
    return { x: box.x + box.width / 2, y: box.y + 1 };
  }
  return { x: box.x + box.width / 2, y: box.y + box.height - 1 };
}

test("core editing, persistence, recovery, PDF and narrow layout", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
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
  await page.getByLabel("收起详情栏").click();
  await page.getByLabel("收起侧栏").click();

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
  await expect(page.locator(".doc-state")).toContainText("已就绪");
  await page.getByLabel("切换深色模式").click();
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await page.getByLabel("切换浅色模式").click();
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-theme",
    "paper",
  );

  await page.mouse.click(
    canvasBox.x + canvasBox.width * 0.38,
    canvasBox.y + canvasBox.height * 0.42,
    { button: "right" },
  );
  await page.getByRole("menuitem", { name: /新建节点/ }).click();
  await expect(page.locator(".workflow-node")).toHaveCount(1);
  await expect(page.locator(".workflow-node").first()).toHaveClass(
    /workflow-node--task/,
  );

  await page
    .locator(".workflow-node")
    .first()
    .getByRole("heading")
    .dblclick();
  const editor = page.getByRole("dialog", { name: "编辑节点内容" });
  await editor.getByLabel("标题").fill("接收需求");
  await editor
    .getByLabel("描述")
    .fill("记录输入范围、约束和验收标准。");
  await editor.getByRole("button", { name: "保存内容" }).click();
  await expect(page.getByText("接收需求", { exact: true }).first()).toBeVisible();

  await page.keyboard.press("Control+z");
  await expect(
    page.getByText("未命名节点", { exact: true }).first(),
  ).toBeVisible();
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByText("接收需求", { exact: true }).first()).toBeVisible();

  const nodeBeforeDrag = await page.locator(".workflow-node").first().boundingBox();
  if (!nodeBeforeDrag) throw new Error("Node drag target unavailable");
  await page.mouse.move(
    nodeBeforeDrag.x + nodeBeforeDrag.width * 0.75,
    nodeBeforeDrag.y + nodeBeforeDrag.height * 0.75,
  );
  await page.mouse.down();
  await page.mouse.move(
    nodeBeforeDrag.x + nodeBeforeDrag.width * 0.75 + 36,
    nodeBeforeDrag.y + nodeBeforeDrag.height * 0.75 + 24,
    { steps: 6 },
  );
  await page.mouse.up();
  const nodeAfterDrag = await page.locator(".workflow-node").first().boundingBox();
  expect(nodeAfterDrag?.x).not.toBe(nodeBeforeDrag.x);
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await page.keyboard.press("Tab");
  const successorEditor = page.getByRole("dialog", {
    name: "编辑节点内容",
  });
  await expect(successorEditor).toBeVisible();
  await successorEditor.getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".workflow-node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.getByTitle("适应画布").click();
  await page.waitForTimeout(450);

  const secondNode = page.locator(".workflow-node").nth(1);
  const secondTestId = (await secondNode.getAttribute("data-testid"))!;
  const secondId = secondTestId.replace(/^node-/, "");
  await page.getByLabel("收起详情栏").click();
  await secondNode.click();
  await expect(secondNode).toHaveClass(/is-selected/);
  await page.mouse.click(
    canvasBox.x + canvasBox.width * 0.06,
    canvasBox.y + canvasBox.height * 0.82,
    { button: "right" },
  );
  await page.getByRole("menuitem", { name: "从选择创建分组" }).click();
  await expect(page.locator(".workflow-group")).toHaveCount(1);
  await page.getByLabel("收起详情栏").click();
  await page.waitForTimeout(300);
  const memberBefore = await secondNode.boundingBox();
  const groupTitlebar = page.locator(".group-titlebar").first();
  const groupBox = await groupTitlebar.boundingBox();
  if (!memberBefore || !groupBox) throw new Error("Group drag target unavailable");
  await page.mouse.move(
    groupBox.x + groupBox.width - 12,
    groupBox.y + 12,
  );
  await page.mouse.down();
  await page.mouse.move(groupBox.x - 120, groupBox.y + 55, { steps: 8 });
  await page.mouse.up();
  const memberAfter = await secondNode.boundingBox();
  expect(memberAfter?.x).not.toBe(memberBefore.x);
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => {
      const x = (await secondNode.boundingBox())?.x;
      return x === undefined ? Number.POSITIVE_INFINITY : Math.abs(x - memberBefore.x);
    })
    .toBeLessThan(3);
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(async () => {
      const x = (await secondNode.boundingBox())?.x;
      return x === undefined || memberAfter === undefined
        ? Number.POSITIVE_INFINITY
        : Math.abs(x - memberAfter.x);
    })
    .toBeLessThan(3);

  page.once("dialog", (dialog) => dialog.accept("e2e-flow"));
  await page.getByLabel("保存").click();
  await expect(page.getByText("已原子保存到本地文档目录")).toBeVisible();
  const savedPath = path.resolve("documents/e2e-flow.wflow");
  await expect.poll(() => fs.existsSync(savedPath)).toBe(true);
  const savedBytes = fs.readFileSync(savedPath);
  expect(savedBytes.subarray(0, 2).toString()).toBe("PK");
  const savedFiles = unzipSync(new Uint8Array(savedBytes));
  const savedDocument = JSON.parse(
    strFromU8(savedFiles["document.json"]),
  ) as {
    layout: {
      nodes: Record<string, { x: number; y: number }>;
      groups: Record<string, { x: number; y: number }>;
    };
  };
  const savedGroupPosition = Object.values(savedDocument.layout.groups)[0];
  const savedMemberPosition = savedDocument.layout.nodes[secondId];

  await page.reload();
  await expect(page.getByRole("heading", { name: /把流程画下来/ })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("1"));
  await page.getByRole("button", { name: "打开本地文件" }).click();
  await expect(page.getByLabel("工作流画布")).toBeVisible();
  await expect(page.locator(".workflow-node")).toHaveCount(2);
  await expect(page.getByText("接收需求", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => fs.existsSync(savedPath)).toBe(true);
  const reopenedFiles = unzipSync(new Uint8Array(fs.readFileSync(savedPath)));
  const reopenedDocument = JSON.parse(
    strFromU8(reopenedFiles["document.json"]),
  ) as typeof savedDocument;
  expect(Object.values(reopenedDocument.layout.groups)[0]).toMatchObject(
    savedGroupPosition,
  );
  expect(reopenedDocument.layout.nodes[secondId]).toMatchObject(
    savedMemberPosition,
  );

  await page
    .locator(".outline-row")
    .filter({ has: page.getByLabel("大纲节点 接收需求") })
    .first()
    .click({ position: { x: 6, y: 8 } });
  await page.keyboard.press("e");
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
  await page.locator(".group-collapse").first().click();

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "导出 PDF" }).click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");
  await expect(printPage.locator(".print-page")).toHaveCount(3);
  await expect(
    printPage.getByRole("heading", { name: "接收需求 v2", exact: true }),
  ).toBeVisible();
  await expect(printPage.getByText(/第 1 \/ 3 页/)).toBeVisible();
  await expect(printPage.getByText(/已折叠/).first()).toBeVisible();
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

  const modifiedImport = JSON.parse(
    fs.readFileSync(path.resolve("examples/import-snapshot.v1.json"), "utf8"),
  ) as {
    edges: Array<Record<string, unknown>>;
    nodes: Array<Record<string, unknown>>;
  };
  modifiedImport.edges[0].label = "夜间执行";
  const testsNode = modifiedImport.nodes.find((node) => node.id === "tests")!;
  testsNode.group = "release";
  const modifiedImportPath = path.resolve("tmp/e2e-modified-import.json");
  fs.mkdirSync(path.dirname(modifiedImportPath), { recursive: true });
  fs.writeFileSync(modifiedImportPath, JSON.stringify(modifiedImport, null, 2));
  await page.getByRole("button", { name: "版本对比" }).click();
  await page.getByTestId("compare-input").setInputFiles(modifiedImportPath);
  const diffDialog = page.getByRole("dialog", { name: "版本对比" });
  await expect(diffDialog).toBeVisible();
  await expect(diffDialog.getByRole("heading", { name: "关系差异" })).toBeVisible();
  await expect(diffDialog.getByRole("heading", { name: "分组差异" })).toBeVisible();
  await expect(diffDialog.getByText("夜间执行")).toBeVisible();
  await expect(diffDialog.getByText("nodeIds").first()).toBeVisible();
  await diffDialog.getByRole("button", { name: "关闭" }).click();

  await page.locator(".workflow-group .group-collapse").first().click();
  await expect(page.locator(".workflow-node")).toHaveCount(4);
  await page.locator(".workflow-group .group-collapse").first().click();
  await expect(page.locator(".workflow-node")).toHaveCount(6);

  const firstNode = page.locator(".workflow-node").first();
  const nodeBox = await firstNode.boundingBox();
  if (!nodeBox) throw new Error("Imported node has no dimensions");
  await page.mouse.move(
    nodeBox.x + nodeBox.width / 2,
    nodeBox.y + nodeBox.height / 2,
  );
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
  await expect(
    mainOutline
      .getByLabel("大纲节点 运行质量门禁")
      .locator("xpath=..")
      .locator(".outline-type"),
  ).toHaveText("节点");
});

