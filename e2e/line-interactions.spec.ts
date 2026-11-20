import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element has no dimensions");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function hideInspector(page: Page) {
  const collapse = page.getByLabel("收起详情栏");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
  }
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

async function nodeRadius(node: Locator) {
  return node.evaluate(
    (element) => getComputedStyle(element).borderTopLeftRadius,
  );
}

async function pathPoint(pathLocator: Locator) {
  return pathLocator.evaluate((path) => {
    const svgPath = path as SVGPathElement;
    const matrix = svgPath.getScreenCTM();
    if (!matrix) throw new Error("Path matrix unavailable");
    const length = svgPath.getTotalLength();
    for (let fraction = 0.18; fraction < 0.86; fraction += 0.04) {
      const local = svgPath.getPointAtLength(length * fraction);
      const point = {
        x: local.x * matrix.a + local.y * matrix.c + matrix.e,
        y: local.x * matrix.b + local.y * matrix.d + matrix.f,
      };
      const hit = document.elementFromPoint(point.x, point.y);
      if (hit?.closest(".workflow-edge-hitarea") === path) return point;
    }
    throw new Error("No exposed edge point");
  });
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

async function openSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "导入示例" }).click();
  await page.getByLabel("收起侧栏").click();
  await hideInspector(page);
}

test("0.2.1 right-click line still inserts one step", async ({ page }) => {
  await openSample(page);
  const edge = page.locator(
    '.workflow-edge-hitarea[data-edge-source="import:example-release-pipeline:approve"][data-edge-target="import:example-release-pipeline:deploy"]',
  );
  const point = await pathPoint(edge);
  await edge.evaluate((element, coordinates) => {
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: coordinates.x,
        clientY: coordinates.y,
      }),
    );
  }, point);
  await expect(page.locator(".edge-context-menu button")).toBeVisible();
  await page
    .getByRole("menuitem", { name: "插入节点" })
    .click({ force: true });
  const editor = page.getByRole("dialog", { name: "编辑节点内容" });
  await editor.getByRole("button", { name: "取消" }).click();

  await expect(page.locator(".workflow-node")).toHaveCount(7);
  const inserted = page.locator(
    ".workflow-node[data-node-title='未命名节点']",
  );
  await expect(inserted).toHaveCount(1);
  await expect(inserted.locator(".node-kind")).toContainText("节点");
  await expect(inserted).toHaveAttribute("data-node-shape", "rounded");
  expect(await nodeRadius(inserted)).toBe("12px");
  const insertedId = (await inserted.getAttribute("data-testid"))!.replace(
    /^node-/,
    "",
  );
  await expect(
    page.locator(
      '.workflow-edge-hitarea[data-edge-source="import:example-release-pipeline:approve"][data-edge-target="import:example-release-pipeline:deploy"]',
    ),
  ).toHaveCount(0);
  await expect(
    page.locator(
      `.workflow-edge-hitarea[data-edge-source="import:example-release-pipeline:approve"][data-edge-target="${insertedId}"]`,
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(
      `.workflow-edge-hitarea[data-edge-source="${insertedId}"][data-edge-target="import:example-release-pipeline:deploy"]`,
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(".edge-label").filter({ hasText: "批准" }),
  ).toHaveCount(1);
});

test("0.2.1 line drag splits at C and derives D with one undo", async ({
  page,
  context,
}) => {
  await openSample(page);
  const edge = page.locator(
    '.workflow-edge-hitarea[data-edge-source="import:example-release-pipeline:approve"][data-edge-target="import:example-release-pipeline:deploy"]',
  );
  const point = await pathPoint(edge);
  const paneBox = await page.locator(".react-flow__pane").boundingBox();
  if (!paneBox) throw new Error("Canvas unavailable");
  const blank = {
    x: paneBox.x + paneBox.width * 0.82,
    y: paneBox.y + paneBox.height * 0.2,
  };

  await edge.dispatchEvent("pointerdown", {
    button: 0,
    buttons: 1,
    clientX: point.x,
    clientY: point.y,
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
    blank,
  );
  await expect(page.locator(".edge-break-preview")).toHaveText("未命名节点");
  await expect(page.locator(".edge-insert-preview")).toHaveText("未命名节点");
  expect(
    await page
      .locator(".edge-break-preview")
      .evaluate((element) => getComputedStyle(element).borderTopLeftRadius),
  ).toBe("12px");
  const previewPath = await page
    .locator(".edge-branch-preview")
    .getAttribute("d");
  expect(previewPath).toContain(" C ");
  expect(previewPath).not.toContain(" L ");
  await page.screenshot({
    path: path.resolve("output/screenshots/27-box-preview.png"),
  });
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
    blank,
  );

  await expect(page.locator(".workflow-node")).toHaveCount(8);
  const breakNode = page.locator(".workflow-node--fork");
  const derivedNode = page.locator(
    ".workflow-node[data-node-title='未命名节点']",
  );
  await expect(breakNode).toHaveCount(1);
  await expect(
    page.locator(".workflow-node[data-node-title='未命名节点']"),
  ).toHaveCount(1);
  await expect(breakNode).toHaveAttribute("data-node-title", "");
  await expect(breakNode).toHaveAttribute("data-node-kind", "fork");
  await expect(breakNode).toHaveAttribute("data-node-shape", "capsule");
  await expect(breakNode.locator(".node-fork-count")).toHaveText("2");
  await expect(derivedNode.locator(".node-kind")).toContainText("节点");
  await expect(derivedNode).toHaveAttribute("data-node-shape", "rounded");
  expect(await nodeRadius(derivedNode)).toBe("12px");
  await hideInspector(page);
  await page.waitForTimeout(350);
  const breakId = (await breakNode.getAttribute("data-testid"))!.replace(
    /^node-/,
    "",
  );
  const derivedId = (await derivedNode.getAttribute("data-testid"))!.replace(
    /^node-/,
    "",
  );
  await expect(
    page.locator(
      `.workflow-edge-hitarea[data-edge-source="import:example-release-pipeline:approve"][data-edge-target="${breakId}"]`,
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(
      `.workflow-edge-hitarea[data-edge-source="${breakId}"][data-edge-target="import:example-release-pipeline:deploy"]`,
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(
      `.workflow-edge-hitarea[data-edge-source="${breakId}"][data-edge-target="${derivedId}"]`,
    ),
  ).toHaveCount(1);
  await expect(breakNode.locator(".node-group-membership")).toHaveText(
    "发布决策",
  );
  await expect(derivedNode.locator(".node-group-membership")).toHaveText(
    "发布决策",
  );
  await page.screenshot({
    path: path.resolve("output/screenshots/26-line-derivation.png"),
  });

  await page.keyboard.press("Control+z");
  await expect(page.locator(".workflow-node")).toHaveCount(6);
  await expect(
    page.locator(
      '.workflow-edge-hitarea[data-edge-source="import:example-release-pipeline:approve"][data-edge-target="import:example-release-pipeline:deploy"]',
    ),
  ).toHaveCount(1);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".workflow-node")).toHaveCount(8);

  await hideInspector(page);
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "导出 PDF" }).click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");
  await expect(printPage.locator(".print-page").first()).toBeVisible();
  await expect(printPage.getByText(/第 1 \//)).toBeVisible();
  expect(await printPage.content()).not.toContain("NaN");
});

test("0.2.1 border drag connects existing or new nodes into one bundle", async ({
  page,
}) => {
  await openSample(page);
  const source = page.locator(
    '.workflow-node[data-testid="node-import:example-release-pipeline:tests"]',
  );
  const pane = page.locator(".react-flow__pane");
  let paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("Canvas unavailable");
  await dragFromControl(
    page,
    source.locator(".node-border-hit-path"),
    {
      x: paneBox.x + paneBox.width * 0.72,
      y: paneBox.y + paneBox.height * 0.12,
    },
    await borderPoint(source, "top"),
  );
  await hideInspector(page);
  const firstDerived = page
    .locator(".workflow-node[data-node-title='未命名节点']")
    .last();
  const firstDerivedId = (
    await firstDerived.getAttribute("data-testid")
  )!.replace(/^node-/, "");

  paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("Canvas unavailable after first border drag");
  await dragFromControl(
    page,
    source.locator(".node-border-hit-path"),
    {
      x: paneBox.x + paneBox.width * 0.94,
      y: paneBox.y + paneBox.height * 0.28,
    },
    await borderPoint(source, "top"),
  );
  await hideInspector(page);
  const secondDerived = page
    .locator(".workflow-node[data-node-title='未命名节点']")
    .last();
  const secondDerivedId = (
    await secondDerived.getAttribute("data-testid")
  )!.replace(/^node-/, "");
  await expect(
    page.locator(".workflow-edge.is-bundle-arm"),
  ).toHaveCount(0);
  await expect(page.locator(".workflow-node--fork")).toHaveCount(0);
  await expect(page.locator(".branch-point")).toHaveCount(0);
  await expect(firstDerived.locator(".node-kind")).toContainText("节点");
  await expect(firstDerived).toHaveAttribute("data-node-shape", "rounded");
  await expect(secondDerived.locator(".node-kind")).toContainText("节点");
  await expect(secondDerived).toHaveAttribute("data-node-shape", "rounded");
  await expect(
    page.locator(
      `.workflow-edge-hitarea[data-edge-source="import:example-release-pipeline:tests"][data-edge-target="${firstDerivedId}"]`,
    ),
  ).toHaveCount(1);

  const existingSource = page.locator(
    '.workflow-node[data-testid="node-import:example-release-pipeline:approve"]',
  );
  const nodeCount = await page.locator(".workflow-node").count();
  await dragFromControl(
    page,
    existingSource.locator(".node-border-hit-path"),
    await center(secondDerived),
    await borderPoint(existingSource, "right"),
  );
  await expect(page.locator(".workflow-node")).toHaveCount(nodeCount);
  await expect(
    page.locator(
      `.workflow-edge-hitarea[data-edge-source="import:example-release-pipeline:approve"][data-edge-target="${secondDerivedId}"]`,
    ),
  ).toHaveCount(1);
  await expect(
    page.locator(".workflow-edge.is-bundle-arm"),
  ).toHaveCount(0);
  await expect(
    page.locator(
      `.workflow-edge-hitarea[data-edge-source="import:example-release-pipeline:tests"]`,
    ),
  ).toHaveCount(3);
});

test("0.2.1 smooth live routing, realtime inspector and PDF", async ({
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
  await page.getByLabel("收起侧栏").click();
  await hideInspector(page);

  const task = page.locator(
    '.workflow-node[data-testid="node-import:example-release-pipeline:tests"]',
  );
  await task.dispatchEvent("click");
  const inspector = page.locator(".inspector");
  await expect(inspector.getByLabel("标题")).toBeVisible();
  await expect(task.locator(".node-kind")).toContainText("节点");
  await expect(
    inspector.getByLabel("类型").locator("option:checked"),
  ).toHaveText("节点");
  const titleInput = inspector.getByLabel("标题");
  const originalTitle = await titleInput.inputValue();
  await titleInput.fill("实时标题");
  await expect(task.getByRole("heading")).toHaveText("实时标题");
  await page.waitForTimeout(200);

  const pane = page.locator(".react-flow__pane");
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("Canvas unavailable");
  await page.mouse.click(
    paneBox.x + paneBox.width * 0.72,
    paneBox.y + paneBox.height * 0.16,
  );
  await page.waitForTimeout(150);
  await page.keyboard.press("Control+z");
  await expect(task.getByRole("heading")).toHaveText(originalTitle);
  await page.keyboard.press("Control+Shift+z");
  await expect(task.getByRole("heading")).toHaveText("实时标题");

  await task.dispatchEvent("click");
  await expect(inspector.getByLabel("节点宽度")).toBeVisible();
  await inspector.getByLabel("节点宽度").fill("300");
  await expect
    .poll(() => nodeInlineSize(task))
    .toMatchObject({ width: 300 });
  await inspector.getByLabel("节点高度").fill("140");
  await expect
    .poll(() => nodeInlineSize(task))
    .toMatchObject({ width: 300, height: 140 });
  await inspector
    .getByLabel("描述")
    .fill("右侧栏输入时画布立即同步。");
  await expect(task.getByText("右侧栏输入时画布立即同步。")).toBeVisible();
  await inspector.getByLabel("标签").fill("实时, 重点");
  await expect(task.locator(".node-tag")).toHaveCount(2);
  await expect(task.getByText("实时", { exact: true })).toBeVisible();
  await expect(task.getByText("重点", { exact: true })).toBeVisible();
  await page.screenshot({
    path: path.resolve("output/screenshots/24-realtime-inspector.png"),
  });

  const labelEdge = page.locator(".workflow-edge-hitarea").first();
  const edgePoint = await pathPoint(labelEdge);
  await page.mouse.click(edgePoint.x, edgePoint.y);
  await inspector.getByLabel("连线标签").fill("即时条件");
  await expect(
    page.locator(".edge-label").filter({ hasText: "即时条件" }),
  ).toBeVisible();

  const group = page.locator(".workflow-group").first();
  const groupBox = await group.boundingBox();
  if (!groupBox) throw new Error("Group unavailable");
  await page.mouse.click(groupBox.x + 28, groupBox.y + 12);
  await inspector.getByLabel("分组名").fill("实时分组");
  await expect(group.locator(".group-titlebar strong")).toHaveText("实时分组");

  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "导出 PDF" }).click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");
  const pdfEdgePaths = await printPage
    .locator(".pdf-edge path")
    .evaluateAll((paths) => paths.map((edge) => edge.getAttribute("d") ?? ""));
  expect(pdfEdgePaths.length).toBeGreaterThan(0);
  expect(pdfEdgePaths.every((value) => value.includes(" C "))).toBe(true);
  expect(pdfEdgePaths.every((value) => !value.includes(" L "))).toBe(true);
  await printPage.locator(".print-page").first().screenshot({
    path: path.resolve("output/screenshots/25-pdf-smooth-curves.png"),
  });
  fs.mkdirSync(path.resolve("output/pdf"), { recursive: true });
  await printPage.pdf({
    path: path.resolve("output/pdf/version-021.pdf"),
    format: "A4",
    printBackground: true,
  });

  expect(runtimeErrors).toEqual([]);
});
