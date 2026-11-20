import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

async function hideInspector(page: Page) {
  const collapse = page.getByLabel("收起详情栏");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
  }
}

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element has no dimensions");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function borderPoint(
  node: Locator,
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

async function dragFromControl(
  page: Page,
  control: Locator,
  end: { x: number; y: number },
  startOverride?: { x: number; y: number },
) {
  const start = startOverride ?? (await center(control));
  await control.dispatchEvent("pointerdown", {
    button: 0,
    buttons: 1,
    clientX: start.x,
    clientY: start.y,
    pointerId: 1,
    pointerType: "mouse",
  });
  await page.evaluate(
    ({ x, y }) => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          buttons: 1,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: "mouse",
        }),
      );
    },
    end,
  );
  await page.evaluate(
    ({ x, y }) => {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: "mouse",
        }),
      );
    },
    end,
  );
  await page.waitForTimeout(150);
}

test("0.2.3 fork point object, branching, persistence and PDF", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByRole("button", { name: "新建空白" }).click();
  await page.waitForTimeout(250);
  await page.getByLabel("收起侧栏").click();
  await hideInspector(page);
  const pane = page.locator(".react-flow__pane");
  let paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("Canvas unavailable");

  await page.mouse.click(
    paneBox.x + paneBox.width * 0.74,
    paneBox.y + paneBox.height * 0.35,
    { button: "right" },
  );
  await page.getByRole("menuitem", { name: "新建节点" }).click();
  await hideInspector(page);
  const existingTarget = page.locator("[data-node-kind='task']").first();

  paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("Canvas unavailable after target");
  await page.mouse.click(
    paneBox.x + paneBox.width * 0.18,
    paneBox.y + paneBox.height * 0.35,
    { button: "right" },
  );
  await expect(page.getByRole("menuitem", { name: "新建开始" })).toBeVisible();
  await page.getByRole("menuitem", { name: "新建分叉点" }).click();

  const fork = page.locator("[data-node-kind='fork']");
  await expect(fork).toHaveCount(1);
  await expect(fork).toHaveAttribute("data-node-title", "");
  await expect(fork).toHaveAttribute("data-node-kind", "fork");
  await expect(fork).toHaveAttribute("data-node-shape", "capsule");
  await expect(fork.locator(".node-fork-count")).toHaveText("0");
  await expect
    .poll(() =>
      fork.evaluate((element) => {
        const wrapper = element.closest(".react-flow__node") as HTMLElement;
        return wrapper.style.width;
      }),
    )
    .toBe("44px");
  expect(
    Number.parseFloat(
      await fork.evaluate(
        (element) => getComputedStyle(element).borderTopLeftRadius,
      ),
    ),
  ).toBeGreaterThan(100);

  const inspector = page.locator(".inspector");
  const titleInput = inspector.getByPlaceholder("填写分叉点名称");
  await expect(titleInput).toHaveValue("");
  await expect(inspector.getByText("分叉点", { exact: true }).first()).toBeVisible();
  await existingTarget.dispatchEvent("click");
  await expect(
    inspector.getByLabel("类型").locator("option:checked"),
  ).toHaveText("节点");
  await expect(
    inspector.getByLabel("类型").locator("option", { hasText: "分叉点" }),
  ).toHaveCount(1);
  await fork.dispatchEvent("click");
  await expect(titleInput).toBeVisible();

  const backgroundBefore = await fork.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await page.getByLabel("配色方案").selectOption("bauhaus");
  const backgroundAfter = await fork.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(backgroundAfter).not.toBe(backgroundBefore);
  await page.getByLabel("配色方案").selectOption("default");

  await page.getByRole("button", { name: "Fit View" }).click();
  await page.waitForTimeout(350);
  await page.screenshot({
    path: path.resolve("output/screenshots/28-fork-point.png"),
  });

  await hideInspector(page);
  await fork.dispatchEvent("dblclick");
  await expect(page.getByRole("dialog", { name: "编辑节点内容" })).toHaveCount(0);
  await fork.dispatchEvent("click");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "编辑节点内容" })).toHaveCount(0);

  await hideInspector(page);
  await dragFromControl(
    page,
    fork.locator(".node-border-hit-path"),
    await center(existingTarget),
    await borderPoint(fork, "right"),
  );
  await hideInspector(page);
  await expect(fork.locator(".node-fork-count")).toHaveText("1");
  const targetId = (
    await existingTarget.getAttribute("data-testid")
  )!.replace(/^node-/, "");
  await expect(
    page.locator(
      `.workflow-edge-hitarea[data-edge-target="${targetId}"]`,
    ),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Fit View" }).click();
  await page.waitForTimeout(350);
  paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("Canvas unavailable before branch");
  await dragFromControl(
    page,
    fork.locator(".node-border-hit-path"),
    {
      x: paneBox.x + paneBox.width * 0.45,
      y: paneBox.y + paneBox.height * 0.18,
    },
    await borderPoint(fork, "top"),
  );
  await hideInspector(page);
  paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("Canvas unavailable before second branch");
  await dragFromControl(
    page,
    fork.locator(".node-border-hit-path"),
    {
      x: paneBox.x + paneBox.width * 0.85,
      y: paneBox.y + paneBox.height * 0.18,
    },
    await borderPoint(fork, "top"),
  );
  await hideInspector(page);

  await expect(fork.locator(".node-fork-count")).toHaveText("3");
  await expect(
    page.locator(".workflow-edge.is-bundle-arm"),
  ).toHaveCount(0);
  await fork.dispatchEvent("click");
  await expect(titleInput).toBeVisible();
  await titleInput.fill("发布分支");
  await expect(fork.locator(".node-title--fork")).toHaveText("发布分支");
  await expect(fork.locator(".node-fork-count")).toHaveText("3");
  await expect
    .poll(() =>
      fork.evaluate((element) => {
        const wrapper = element.closest(".react-flow__node") as HTMLElement;
        return Number.parseFloat(wrapper.style.width);
      }),
    )
    .toBeGreaterThan(44);

  const typeSelect = inspector.getByLabel("类型");
  await typeSelect.selectOption("task");
  await expect(fork).toHaveCount(0);
  await expect(inspector.getByLabel("类型")).toHaveValue("task");
  await inspector.getByLabel("类型").selectOption("fork");
  await expect(fork).toHaveCount(1);
  await expect(fork.locator(".node-title--fork")).toHaveText("发布分支");

  await page.mouse.click(
    paneBox.x + paneBox.width * 0.92,
    paneBox.y + paneBox.height * 0.12,
  );
  await fork.dispatchEvent("click");
  await page.keyboard.press("Delete");
  await expect(fork).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(fork).toHaveCount(1);
  await expect(fork.locator(".node-title--fork")).toHaveText("发布分支");
  await page.keyboard.press("Control+Shift+z");
  await expect(fork).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(fork).toHaveCount(1);

  await hideInspector(page);
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "导出 PDF" }).click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");
  await expect(printPage.locator(".pdf-node--fork")).toHaveCount(1);
  await expect(
    printPage.locator(".pdf-node--fork.pdf-node--shape-capsule"),
  ).toHaveCount(1);
  await expect(printPage.locator(".pdf-fork-count")).toHaveText("3");
  await expect(printPage.getByText("分叉点", { exact: true }).first()).toBeVisible();
  await printPage.locator(".print-page").first().screenshot({
    path: path.resolve("output/screenshots/29-fork-pdf.png"),
  });
  fs.mkdirSync(path.resolve("output/pdf"), { recursive: true });
  await printPage.pdf({
    path: path.resolve("output/pdf/version-023.pdf"),
    format: "A4",
    printBackground: true,
  });
});

test("0.2.3 ordinary node branches stay independent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建空白" }).click();
  await page.waitForTimeout(250);
  await page.getByLabel("收起侧栏").click();
  await hideInspector(page);
  const pane = page.locator(".react-flow__pane");
  let paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("Canvas unavailable");

  await page.mouse.click(
    paneBox.x + paneBox.width * 0.16,
    paneBox.y + paneBox.height * 0.42,
    { button: "right" },
  );
  await page.getByRole("menuitem", { name: "新建节点" }).click();
  await hideInspector(page);
  const source = page.locator("[data-node-kind='task']").first();
  const sourceId = (await source.getAttribute("data-testid"))!.replace(
    /^node-/,
    "",
  );

  paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("Canvas unavailable before first branch");
  await dragFromControl(
    page,
    source.locator(".node-border-hit-path"),
    {
      x: paneBox.x + paneBox.width * 0.62,
      y: paneBox.y + paneBox.height * 0.25,
    },
    await borderPoint(source, "right"),
  );
  await hideInspector(page);
  paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("Canvas unavailable before second branch");
  await dragFromControl(
    page,
    source.locator(".node-border-hit-path"),
    {
      x: paneBox.x + paneBox.width * 0.62,
      y: paneBox.y + paneBox.height * 0.72,
    },
    await borderPoint(source, "right"),
  );
  await hideInspector(page);

  await expect(page.locator(".workflow-node--fork")).toHaveCount(0);
  await expect(page.locator(".branch-point")).toHaveCount(0);
  await expect(
    page.locator(
      `.workflow-edge-hitarea[data-edge-source="${sourceId}"]`,
    ),
  ).toHaveCount(2);
  await expect(
    page.locator(".workflow-edge.is-bundle-arm"),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Fit View" }).click();
  await page.waitForTimeout(350);
  await page.screenshot({
    path: path.resolve("output/screenshots/30-independent-branches.png"),
  });
});
