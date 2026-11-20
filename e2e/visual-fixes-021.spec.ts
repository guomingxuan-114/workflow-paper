import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element has no dimensions");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function nodeInlineSize(node: Locator) {
  return node.evaluate((element) => {
    const wrapper = element.closest(".react-flow__node") as HTMLElement | null;
    return {
      width: Number.parseFloat(wrapper?.style.width ?? "0"),
      height: Number.parseFloat(wrapper?.style.height ?? "0"),
    };
  });
}

async function screenshotNode(page: Page, node: Locator, filename: string) {
  const outputDir = path.resolve("output/screenshots");
  fs.mkdirSync(outputDir, { recursive: true });
  await page.locator(".toast-stack").evaluate((element) => {
    (element as HTMLElement).style.display = "none";
  });
  await expect(node).toBeVisible();
  await page.getByTitle("适应画布").click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outputDir, filename) });
}

test("0.2.1 visual emphasis, node sizing, chips and live drag", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  await page.goto("/");
  await page.getByRole("button", { name: "导入示例" }).click();
  const task = page.locator(
    '.workflow-node[data-testid="node-import:example-release-pipeline:tests"]',
  );
  const decision = page.locator(
    '.workflow-node[data-testid="node-import:example-release-pipeline:approve"]',
  );
  const milestone = page.locator(
    '.workflow-node[data-testid="node-import:example-release-pipeline:observe"]',
  );

  await expect(task.locator(".node-tag")).toHaveCount(2);
  await expect(task.locator(".node-id")).toHaveCount(0);
  await expect(task.getByText("未标记", { exact: true })).toHaveCount(0);
  await task.getByRole("heading").click();
  await screenshotNode(page, task, "15-step-tags.png");

  await decision.getByRole("heading").click();
  await expect(decision.locator("p")).toHaveCount(0);
  await expect(decision.locator(".node-footer")).toHaveCount(0);
  await expect(decision.locator(".node-title--decision")).toBeVisible();
  await screenshotNode(page, decision, "16-decision-ellipse.png");

  await milestone.getByRole("heading").click();
  const milestoneFill = await milestone.evaluate((element) =>
    getComputedStyle(element, "::before").backgroundColor,
  );
  expect(milestoneFill).not.toBe("rgba(0, 0, 0, 0)");
  await screenshotNode(page, milestone, "17-milestone-fill.png");

  await decision.getByRole("heading").click();
  await page.getByTitle("标记所选对象为重要").click();
  const importantFill = await decision.evaluate((element) =>
    getComputedStyle(element, "::before").backgroundColor,
  );
  expect(importantFill).not.toBe("rgba(0, 0, 0, 0)");
  expect(importantFill).not.toBe(milestoneFill);
  await expect(decision.locator(".node-important-marker")).toBeVisible();
  await screenshotNode(page, decision, "18-important-fill.png");

  await expect(page.locator(".react-flow__resize-control")).toHaveCount(0);
  const deploy = page.locator(
    '.workflow-node[data-testid="node-import:example-release-pipeline:deploy"]',
  );
  await deploy.getByRole("heading").click();
  const inspector = page.locator(".inspector");
  await inspector.getByLabel("类型").selectOption("decision");
  await expect(deploy).toHaveAttribute("data-node-shape", "ellipse");
  const decisionSize = await nodeInlineSize(deploy);
  expect(decisionSize).toMatchObject({ width: 252, height: 136 });

  await inspector.getByLabel("节点宽度").fill("320");
  await inspector.getByLabel("节点宽度").press("Tab");
  await inspector.getByLabel("节点高度").fill("160");
  await inspector.getByLabel("节点高度").press("Tab");
  await expect
    .poll(() => nodeInlineSize(deploy))
    .toMatchObject({ width: 320, height: 160 });
  await inspector.getByLabel("类型").selectOption("end");
  await expect
    .poll(() => nodeInlineSize(deploy))
    .toMatchObject({ width: 320, height: 160 });
  await screenshotNode(page, deploy, "20-resized-type-switch.png");

  const paneBox = await page.locator(".react-flow__pane").boundingBox();
  if (!paneBox) throw new Error("Canvas unavailable");
  await page.mouse.click(
    paneBox.x + paneBox.width * 0.12,
    paneBox.y + paneBox.height * 0.78,
    { button: "right" },
  );
  await page.getByRole("menuitem", { name: "新建备注" }).click();
  const note = page.locator(".workflow-node--note").last();
  await expect(note).toBeVisible();
  await screenshotNode(page, note, "19-note-node.png");

  const dragTarget = page.locator(
    '.workflow-node[data-testid="node-import:example-release-pipeline:tests"]',
  );
  const beforeHandle = await dragTarget.elementHandle();
  const start = await center(dragTarget);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 120, start.y + 86, { steps: 8 });
  const duringHandle = await dragTarget.elementHandle();
  expect(
    await page.evaluate(
      ([before, during]) => before === during,
      [beforeHandle, duringHandle],
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.resolve("output/screenshots/21-live-drag.png"),
  });
  await page.mouse.up();

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "导出 PDF" }).click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");
  const milestonePath = printPage.locator(
    ".pdf-node.is-milestone:not(.is-important) > path",
  );
  await expect(milestonePath).toHaveCount(1);
  expect(await milestonePath.getAttribute("style")).toMatch(/fill:#[0-9a-f]{6}/i);
  await printPage.locator(".print-page").first().screenshot({
    path: path.resolve("output/screenshots/22-pdf-emphasis.png"),
  });
  fs.mkdirSync(path.resolve("output/pdf"), { recursive: true });
  await printPage.pdf({
    path: path.resolve("output/pdf/version-021.pdf"),
    format: "A4",
    printBackground: true,
  });

  expect(runtimeErrors).toEqual([]);
});
