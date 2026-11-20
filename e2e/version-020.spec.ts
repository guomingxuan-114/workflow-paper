import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const sourcePrefix = "import:example-release-pipeline";

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

async function pathPoint(
  pathLocator: Locator,
  startFraction = 0.08,
  requireHit = true,
) {
  const point = await pathLocator.evaluate((path, options) => {
    const svgPath = path as SVGPathElement;
    const matrix = svgPath.getScreenCTM();
    if (!matrix) return null;
    const length = svgPath.getTotalLength();
    let fallback = null;
    for (
      let fraction = options.start;
      fraction < 0.94;
      fraction += 0.03
    ) {
      const local = svgPath.getPointAtLength(length * fraction);
      const candidate = {
        x: local.x * matrix.a + local.y * matrix.c + matrix.e,
        y: local.x * matrix.b + local.y * matrix.d + matrix.f,
      };
      fallback ??= candidate;
      const hit = document.elementFromPoint(candidate.x, candidate.y);
      if (hit?.closest(".workflow-edge-hitarea, .bundle-trunk-hit-path") === path) {
        return candidate;
      }
    }
    return options.requireHit ? null : fallback;
  }, { start: startFraction, requireHit });
  if (!point) throw new Error("No exposed point found on edge path");
  return point;
}

async function drag(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function hideInspector(page: Page) {
  const collapse = page.getByLabel("收起详情栏");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
  }
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

test("0.2 branching, emphasis, notes, themes and PDF", async ({
  page,
  context,
}) => {
  test.setTimeout(45_000);
  const outputDir = path.resolve("output/screenshots");
  fs.mkdirSync(outputDir, { recursive: true });
  const runtimeErrors: string[] = [];
  let stage = "start";
  page.on("pageerror", (error) =>
    runtimeErrors.push(`${stage}: ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(`${stage}: ${message.text()}`);
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "导入示例" }).click();
  await page.getByLabel("收起侧栏").click();
  await page.getByLabel("收起详情栏").click();

  await page.screenshot({
    path: path.join(outputDir, "12-default-theme.png"),
  });

  const pane = page.locator(".react-flow__pane");
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("Canvas unavailable");
  const blankA = {
    x: paneBox.x + paneBox.width * 0.7,
    y: paneBox.y + paneBox.height * 0.78,
  };
  const approveToDeploy = page.locator(
    `.workflow-edge-hitarea[data-edge-source="${sourcePrefix}:approve"][data-edge-target="${sourcePrefix}:deploy"]`,
  );
  await expect(approveToDeploy).toHaveCount(1);
  const nodeCountBeforeInsert = await page.locator(".workflow-node").count();
  stage = "edge-derivation";
  await dragFromControl(page, approveToDeploy, blankA);
  await expect(page.locator(".workflow-node")).toHaveCount(
    nodeCountBeforeInsert + 2,
  );
  await expect(
    page.locator(".workflow-node[data-node-title='未命名节点']"),
  ).toHaveCount(1);
  await expect(page.locator(".workflow-node--fork")).toHaveCount(1);
  await expect(approveToDeploy).toHaveCount(0);
  await page.screenshot({
    path: path.join(outputDir, "07-trunk-independent-branch.png"),
  });

  stage = "border-bundle";
  await hideInspector(page);
  const actionPaneBox = await pane.boundingBox();
  if (!actionPaneBox) throw new Error("Canvas unavailable after insert");
  const bundleTargetA = {
    x: actionPaneBox.x + actionPaneBox.width * 0.78,
    y: actionPaneBox.y + actionPaneBox.height * 0.24,
  };
  const bundleTargetB = {
    x: actionPaneBox.x + actionPaneBox.width * 0.93,
    y: actionPaneBox.y + actionPaneBox.height * 0.35,
  };
  const approveNode = page.locator(
    `.workflow-node[data-testid="node-${sourcePrefix}:approve"]`,
  );
  await dragFromControl(
    page,
    approveNode.locator(".node-border-hit-path"),
    bundleTargetA,
    await borderPoint(approveNode, "top"),
  );
  const firstBundleTarget = page
    .locator(".workflow-node[data-node-title='未命名节点']")
    .last();
  const firstBundleTargetId = (
    await firstBundleTarget.getAttribute("data-testid")
  )!.replace(/^node-/, "");
  await dragFromControl(
    page,
    approveNode.locator(".node-border-hit-path"),
    bundleTargetB,
    await borderPoint(approveNode, "top"),
  );
  const secondBundleTarget = page
    .locator(".workflow-node[data-node-title='未命名节点']")
    .last();
  const secondBundleTargetId = (
    await secondBundleTarget.getAttribute("data-testid")
  )!.replace(/^node-/, "");
  expect(secondBundleTargetId).not.toBe(firstBundleTargetId);
  await expect(
    page.locator(".workflow-edge.is-bundle-arm"),
  ).toHaveCount(0);
  const lineFork = page.locator(".workflow-node--fork");
  await expect(lineFork).toHaveCount(1);
  await expect(lineFork.locator(".node-fork-count")).toHaveText("2");
  await expect(page.locator(".branch-point")).toHaveCount(0);
  await expect(page.locator(".bundle-label")).toHaveCount(0);

  const secondArm = page.locator(
    `.workflow-edge-hitarea[data-edge-source="${sourcePrefix}:approve"][data-edge-target="${secondBundleTargetId}"]`,
  );
  await expect(secondArm).toHaveCount(1);
  await page.screenshot({
    path: path.join(outputDir, "06-independent-branches.png"),
  });

  await hideInspector(page);
  await page.locator(".toast-stack").evaluate((element) => {
    (element as HTMLElement).style.display = "none";
  });
  stage = "zoom";
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "Zoom In" }).click();
  }
  await page.screenshot({
    path: path.join(outputDir, "06-line-fork-zoom.png"),
  });
  stage = "fit-view";
  await page.getByRole("button", { name: "Fit View" }).click();

  const insertPoint = await pathPoint(secondArm, 0.4);
  stage = "insert-menu";
  await page.mouse.click(insertPoint.x, insertPoint.y, { button: "right" });
  stage = "insert-menu-visible";
  await expect(page.locator(".edge-context-menu button")).toBeVisible();
  stage = "insert-menu-shot";
  await page.screenshot({
    path: path.join(outputDir, "08-insert-step-menu.png"),
  });
  stage = "insert-menu-close";
  await page.mouse.click(
    paneBox.x + paneBox.width * 0.8,
    paneBox.y + paneBox.height * 0.2,
  );

  stage = "note";
  await page.mouse.click(
    paneBox.x + paneBox.width * 0.74,
    paneBox.y + paneBox.height * 0.58,
    { button: "right" },
  );
  await page.getByRole("menuitem", { name: "新建备注" }).click();
  const note = page.locator(".workflow-node--note").last();
  await expect(note).toHaveCount(1);
  const noteId = (await note.getAttribute("data-testid"))!.replace(/^node-/, "");
  const startNode = page.locator(
    `.workflow-node[data-testid="node-${sourcePrefix}:commit"]`,
  );
  await hideInspector(page);
  await dragFromControl(
    page,
    startNode.locator(".node-border-hit-path"),
    await center(note),
    await borderPoint(startNode, "right"),
  );
  const noteEdge = page.locator(
    `.workflow-edge-hitarea[data-edge-source="${sourcePrefix}:commit"][data-edge-target="${noteId}"]`,
  );
  await expect(noteEdge).toHaveCount(1);
  await expect(
    page.locator(".workflow-edge.is-note-edge").first(),
  ).toBeVisible();
  await expect(
    page.locator(".workflow-edge.is-note-edge").first(),
  ).not.toHaveAttribute("marker-end", /.+/);
  await page.screenshot({
    path: path.join(outputDir, "10-note-dashed.png"),
  });

  stage = "group";
  const decision = approveNode;
  await decision.getByRole("heading").click();
  await page.getByTitle("标记所选对象为重要").click();
  await expect(decision).toHaveClass(/is-important/);
  await page.getByTitle("将所选节点创建为分组").click();
  await expect(page.locator(".workflow-group")).toHaveCount(3);
  await page.getByTitle("标记所选对象为重要").click();
  const curvedRadius = await page
    .locator(".workflow-group")
    .last()
    .evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
  expect(Number.parseFloat(curvedRadius)).toBeGreaterThanOrEqual(40);
  await page.screenshot({
    path: path.join(outputDir, "11-group-emphasis.png"),
  });

  stage = "membership";
  const decisionBox = await decision.boundingBox();
  if (!decisionBox) throw new Error("Decision node unavailable");
  await page.mouse.move(
    decisionBox.x + decisionBox.width * 0.72,
    decisionBox.y + decisionBox.height * 0.55,
  );
  await page.mouse.down();
  await page.mouse.move(
    decisionBox.x + decisionBox.width * 0.72 + 130,
    decisionBox.y + decisionBox.height * 0.55 + 120,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(decision.locator(".node-group-membership")).toBeVisible();
  await page.getByRole("button", { name: "移出", exact: true }).click();
  await expect(decision.locator(".node-group-membership")).toHaveCount(0);

  stage = "outline";
  await page.getByRole("tab", { name: "大纲" }).click();
  const outline = page.getByTestId("outline-view").last();
  await expect(outline.getByTestId("important-view")).toContainText(
    "确认发布窗口",
  );
  await expect(outline.getByTestId("milestone-view")).toContainText(
    "里程碑",
  );
  await page.screenshot({
    path: path.join(outputDir, "09-milestone-important.png"),
  });
  await page.getByRole("tab", { name: "画布" }).click();

  stage = "theme";
  await page.getByLabel("配色方案").selectOption("bauhaus");
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-palette",
    "bauhaus",
  );
  await page.screenshot({
    path: path.join(outputDir, "13-bauhaus-theme.png"),
  });

  stage = "pdf";
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "导出 PDF" }).click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");
  await expect(printPage.locator(".print-page").first()).toBeVisible();
  await expect(printPage.getByText(/分支束“方针”/)).toHaveCount(0);
  await printPage.locator(".print-page").first().screenshot({
    path: path.join(outputDir, "14-pdf-overview.png"),
  });
  fs.mkdirSync(path.resolve("output/pdf"), { recursive: true });
  await printPage.pdf({
    path: path.resolve("output/pdf/version-020.pdf"),
    format: "A4",
    printBackground: true,
  });
  expect(
    runtimeErrors.filter(
      (message) =>
        !message.includes("favicon") &&
        !message.includes("ERR_CONNECTION_REFUSED"),
    ),
  ).toEqual([]);
});
