import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

async function hideInspector(page: import("@playwright/test").Page) {
  const collapse = page.getByLabel("收起详情栏");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
  }
}

async function dragBetween(
  page: import("@playwright/test").Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
}

async function fitAndZoomOut(page: import("@playwright/test").Page) {
  await page.keyboard.press("Control+0");
  await page.waitForTimeout(350);
  const canvas = await page.locator(".react-flow__pane").boundingBox();
  if (canvas) {
    await page.mouse.move(
      canvas.x + canvas.width * 0.5,
      canvas.y + canvas.height * 0.5,
    );
    await page.mouse.wheel(0, 220);
    await page.waitForTimeout(350);
  }
}

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

test("capture connection interaction screenshots", async ({ page }) => {
  test.setTimeout(60_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) =>
    runtimeErrors.push(error.stack ?? error.message),
  );
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  const outputDirectory = path.resolve("output/screenshots");
  fs.mkdirSync(outputDirectory, { recursive: true });

  await page.goto("/");
  await page.getByRole("button", { name: "新建空白" }).click();
  await page.getByLabel("收起详情栏").click();
  await page.getByLabel("收起侧栏").click();

  const canvasBox = await page.locator(".react-flow__pane").boundingBox();
  if (!canvasBox) throw new Error("Canvas has no dimensions");
  await page.mouse.click(
    canvasBox.x + 250,
    canvasBox.y + 280,
    { button: "right" },
  );
  await page.getByRole("menuitem", { name: /新建节点/ }).click();
  await hideInspector(page);

  const first = page.locator(".workflow-node").nth(0);
  const firstBox = await first.boundingBox();
  if (!firstBox) throw new Error("First node unavailable");
  await page.mouse.click(
    firstBox.x + firstBox.width + 520,
    firstBox.y + 40,
    { button: "right" },
  );
  await page.getByRole("menuitem", { name: /新建节点/ }).click();
  await hideInspector(page);
  await expect(page.locator(".workflow-node")).toHaveCount(2);
  const second = page.locator(".workflow-node").nth(1);
  const secondBoxBeforeConnect = await second.boundingBox();
  const sourceRight = await nodeBorderPoint(first, "right");
  if (!secondBoxBeforeConnect) {
    throw new Error("Normal connection nodes unavailable");
  }
  await dragBetween(
    page,
    {
      x: sourceRight.x,
      y: sourceRight.y,
    },
    {
      x: secondBoxBeforeConnect.x + secondBoxBeforeConnect.width / 2,
      y: secondBoxBeforeConnect.y + secondBoxBeforeConnect.height / 2,
    },
  );
  await fitAndZoomOut(page);
  await page.screenshot({
    path: path.join(outputDirectory, "01-normal-connection.png"),
  });

  const firstTestId = (await first.getAttribute("data-testid"))!;
  const secondTestId = (await second.getAttribute("data-testid"))!;
  const firstId = firstTestId.replace(/^node-/, "");
  const secondId = secondTestId.replace(/^node-/, "");
  const secondBox = await second.boundingBox();
  const fittedFirstBox = await first.boundingBox();
  if (!secondBox || !fittedFirstBox) throw new Error("Fitted nodes unavailable");
  await dragBetween(
    page,
    {
      x: secondBox.x + secondBox.width / 2,
      y: secondBox.y + secondBox.height,
    },
    {
      x: fittedFirstBox.x + fittedFirstBox.width / 2,
      y: fittedFirstBox.y + fittedFirstBox.height / 2,
    },
  );
  await expect(
    page.locator(
      `.workflow-edge-hitarea[data-edge-source="${secondId}"][data-edge-target="${firstId}"]`,
    ),
  ).toHaveCount(1);
  await fitAndZoomOut(page);
  await hideInspector(page);
  await page.screenshot({
    path: path.join(outputDirectory, "02-reverse-connection.png"),
  });

  const fittedCanvas = await page.locator(".react-flow__pane").boundingBox();
  if (!fittedCanvas) throw new Error("Fitted canvas unavailable");
  const currentFirstBox = await first.boundingBox();
  if (!currentFirstBox) throw new Error("Current first node unavailable");
  await page.mouse.click(
    currentFirstBox.x + currentFirstBox.width / 2,
    fittedCanvas.y + 100,
    { button: "right" },
  );
  await page.getByRole("menuitem", { name: "新建判断" }).click();
  await hideInspector(page);
  const third = page.locator(".workflow-node").nth(2);
  const thirdBox = await third.boundingBox();
  const sourceTop = await nodeBorderPoint(first, "top");
  if (!thirdBox) throw new Error("Vertical nodes unavailable");
  await dragBetween(
    page,
    {
      x: sourceTop.x,
      y: sourceTop.y,
    },
    {
      x: thirdBox.x + thirdBox.width / 2,
      y: thirdBox.y + thirdBox.height / 2,
    },
  );
  await fitAndZoomOut(page);
  await hideInspector(page);
  await page.screenshot({
    path: path.join(outputDirectory, "03-vertical-connection.png"),
  });
  await page.getByLabel("切换深色模式").click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: path.join(outputDirectory, "05-dark-mode.png"),
  });
  await page.getByLabel("切换浅色模式").click();
  expect(runtimeErrors).toEqual([]);
});
