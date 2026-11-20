import { describe, expect, it } from "vitest";
import {
  connectNodes,
  createDocument,
  createNode,
  groupNodes,
  splitEdge,
  withNode,
} from "./document";
import {
  buildConnectionPreview,
  buildWorkflowRouting,
  documentWithNodePositions,
  distanceToRoute,
  projectPointOntoRoute,
  routeIntersectsRect,
  routeIntersectsNode,
} from "./edgeRouting";
import { createBranchBundle, updateBundle } from "./bundles";

function branchDocument() {
  let document = createDocument("分叉测试");
  const source = createNode("判断", { x: 100, y: 160 }, "decision");
  const left = createNode("左侧目标", { x: 460, y: 60 });
  const middle = createNode("中间目标", { x: 460, y: 180 });
  const right = createNode("右侧目标", { x: 460, y: 300 });
  for (const [node, x, y] of [
    [source, 100, 160],
    [left, 460, 60],
    [middle, 460, 180],
    [right, 460, 300],
  ] as const) {
    document = withNode(document, node, { x, y });
  }
  document = connectNodes(document, source.id, left.id, "低风险");
  document = connectNodes(document, source.id, middle.id, "中风险");
  document = connectNodes(document, source.id, right.id, "高风险");
  return { document, source, left, middle, right };
}

describe("shared workflow edge routing", () => {
  it("keeps edges from one node visually independent even with legacy bundles", () => {
    const { document, source } = branchDocument();
    const edgeIds = document.edges.map((edge) => edge.id);
    const bundled = createBranchBundle(
      document,
      source.id,
      edgeIds,
      "方针",
    );
    const routing = buildWorkflowRouting(bundled);
    const routes = Object.values(routing.routes);
    expect(routes).toHaveLength(3);
    expect(Object.values(routing.branches)).toHaveLength(0);
    expect(routes.every((route) => route.bundleId === undefined)).toBe(true);
    expect(routes.every((route) => route.trunkPath === "")).toBe(true);
    for (const route of routes) {
      expect(route.sourceId).toBe(source.id);
      expect(route.path.startsWith(`M ${route.sourcePoint.x}`)).toBe(true);
    }
  });

  it("routes semantic direction independently from node side", () => {
    const { document, left, right } = branchDocument();
    const reversed = connectNodes(document, right.id, left.id, "回退");
    const routing = buildWorkflowRouting(reversed);
    const edge = reversed.edges.find(
      (candidate) => candidate.source === right.id && candidate.target === left.id,
    )!;
    const route = routing.routes[edge.id];
    expect(route.sourceId).toBe(right.id);
    expect(route.targetId).toBe(left.id);
    const rightRect = reversed.layout.nodes[right.id];
    const leftRect = reversed.layout.nodes[left.id];
    expect(route.sourcePoint.x).toBeGreaterThanOrEqual(rightRect.x);
    expect(route.sourcePoint.x).toBeLessThanOrEqual(rightRect.x + rightRect.width);
    expect(route.targetPoint.x).toBeGreaterThanOrEqual(leftRect.x);
    expect(route.targetPoint.x).toBeLessThanOrEqual(leftRect.x + leftRect.width);
    expect(route.targetPoint.y).toBeGreaterThanOrEqual(leftRect.y);
    expect(route.targetPoint.y).toBeLessThanOrEqual(leftRect.y + leftRect.height);
    expect(distanceToRoute(route.forkPoint, route)).toBeLessThan(0.01);
    expect(routeIntersectsRect(route, rightRect, 4)).toBe(false);
    expect(routeIntersectsRect(route, leftRect, 4)).toBe(false);
  });

  it("omits collapsed group members and their edges from visible routing", () => {
    const { document, source, left, middle, right } = branchDocument();
    const grouped = groupNodes(
      document,
      [middle.id, right.id],
      "折叠分支",
    );
    const group = grouped.groups.find((item) =>
      item.nodeIds.includes(middle.id),
    )!;
    const collapsed = {
      ...grouped,
      groups: grouped.groups.map((item) =>
        item.id === group.id ? { ...item, collapsed: true } : item,
      ),
    };
    const routing = buildWorkflowRouting(collapsed);
    expect(Object.values(routing.routes).every((route) => route.targetId === left.id)).toBe(true);
    expect(
      Object.values(routing.branches).some(
        (branch) => branch.sourceId === source.id,
      ),
    ).toBe(false);
  });

  it("keeps multiple outgoing edges independent until the user creates a bundle", () => {
    let document = createDocument("多方向测试");
    const source = createNode("中心", { x: 500, y: 400 }, "decision");
    const rightA = createNode("右一", { x: 900, y: 340 });
    const rightB = createNode("右二", { x: 900, y: 500 });
    const left = createNode("左", { x: 120, y: 400 });
    const top = createNode("上", { x: 520, y: 60 });
    const bottom = createNode("下", { x: 520, y: 760 });
    for (const node of [source, rightA, rightB, left, top, bottom]) {
      document = withNode(
        document,
        node,
        document.layout.nodes[node.id] ?? { x: 0, y: 0 },
      );
    }
    document = {
      ...document,
      layout: {
        ...document.layout,
        nodes: {
          ...document.layout.nodes,
          [source.id]: { x: 500, y: 400, width: 224, height: 106 },
          [rightA.id]: { x: 900, y: 340, width: 224, height: 106 },
          [rightB.id]: { x: 900, y: 500, width: 224, height: 106 },
          [left.id]: { x: 120, y: 400, width: 224, height: 106 },
          [top.id]: { x: 520, y: 60, width: 224, height: 106 },
          [bottom.id]: { x: 520, y: 760, width: 224, height: 106 },
        },
      },
    };
    for (const target of [rightA, rightB, left, top, bottom]) {
      document = connectNodes(document, source.id, target.id);
    }
    const routing = buildWorkflowRouting(document);
    const branches = Object.values(routing.branches).filter(
      (branch) => branch.sourceId === source.id,
    );
    expect(branches).toHaveLength(0);
    expect(Object.values(routing.routes)).toHaveLength(5);
    const sourcePoints = new Set(
      Object.values(routing.routes).map((route) =>
        `${route.sourcePoint.x.toFixed(2)}:${route.sourcePoint.y.toFixed(2)}`,
      ),
    );
    expect(sourcePoints.size).toBe(5);
    for (const route of Object.values(routing.routes)) {
      expect(
        routeIntersectsNode(
          route,
          source,
          document.layout.nodes[source.id],
          4,
        ),
        `${route.edgeId} -> ${document.nodes.find((node) => node.id === route.targetId)?.title} intersects source`,
      ).toBe(false);
      const targetNode = document.nodes.find(
        (node) => node.id === route.targetId,
      )!;
      expect(
        routeIntersectsNode(
          route,
          targetNode,
          document.layout.nodes[route.targetId],
          4,
        ),
      ).toBe(false);
    }
  });

  it("routes vertical and diagonal edges without entering either endpoint", () => {
    let document = createDocument("方向测试");
    const center = createNode("中心", { x: 420, y: 360 }, "decision");
    const top = createNode("上方", { x: 450, y: 40 });
    const diagonal = createNode("斜向", { x: 920, y: 640 });
    document = withNode(document, center, { x: 420, y: 360 });
    document = withNode(document, top, { x: 450, y: 40 });
    document = withNode(document, diagonal, { x: 920, y: 640 });
    document = connectNodes(document, center.id, top.id);
    document = connectNodes(document, center.id, diagonal.id);
    const routing = buildWorkflowRouting(document);
    for (const route of Object.values(routing.routes)) {
      expect(route.path).toContain("M ");
      expect(
        routeIntersectsNode(
          route,
          center,
          document.layout.nodes[center.id],
          3,
        ),
        `${route.edgeId} -> ${document.nodes.find((node) => node.id === route.targetId)?.title} intersects source`,
      ).toBe(false);
      expect(
        routeIntersectsNode(
          route,
          document.nodes.find((node) => node.id === route.targetId)!,
          document.layout.nodes[route.targetId],
          3,
        ),
      ).toBe(false);
    }
  });

  it("builds a visible preview while dragging from a border", () => {
    const { document, source, middle } = branchDocument();
    const preview = buildConnectionPreview(
      document,
      source.id,
      { x: 800, y: 180 },
      middle.id,
    );
    expect(preview).not.toBeNull();
    expect(preview?.path).toContain("C");
    expect(preview?.path).not.toContain(" L ");
    expect(preview?.endPoint.x).toBeLessThanOrEqual(460);
  });

  it("renders every single edge as one continuous cubic curve", () => {
    const { document } = branchDocument();
    const routing = buildWorkflowRouting(document);
    for (const route of Object.values(routing.routes)) {
      expect(route.path.startsWith("M ")).toBe(true);
      expect(route.path).not.toContain(" L ");
      expect(route.path).toContain(" C ");
      expect(route.segments).toHaveLength(1);
      expect(route.hitPoints[0]).toEqual(route.sourcePoint);
      expect(route.hitPoints.at(-1)).toEqual(route.targetPoint);
    }
  });

  it("uses independent smooth cubic paths for legacy bundle members", () => {
    const { document, source } = branchDocument();
    const bundled = createBranchBundle(
      document,
      source.id,
      document.edges.map((edge) => edge.id),
      "方针",
    );
    const routing = buildWorkflowRouting(bundled);
    for (const route of Object.values(routing.routes)) {
      expect(route.trunkPath).toBe("");
      expect(route.path).not.toContain(" L ");
      expect(route.armPath.startsWith("C ")).toBe(true);
      expect(route.segments).toHaveLength(1);
    }
    expect(routing.branches).toEqual({});
  });

  it("keeps route coordinates finite after editing bundle labels", () => {
    const { document, source } = branchDocument();
    const bundled = createBranchBundle(
      document,
      source.id,
      document.edges.map((edge) => edge.id),
      "",
    );
    const updated = updateBundle(bundled, bundled.bundles[0].id, {
      label: "方针",
      visible: true,
    });
    const routing = buildWorkflowRouting(updated);
    for (const route of Object.values(routing.routes)) {
      expect(JSON.stringify(route)).not.toContain("null");
      expect(Number.isFinite(route.sourcePoint.x)).toBe(true);
      expect(Number.isFinite(route.targetPoint.y)).toBe(true);
      expect(Number.isFinite(route.forkPoint.x)).toBe(true);
      expect(route.path).not.toContain("NaN");
    }
    for (const branch of Object.values(routing.branches)) {
      expect(Number.isFinite(branch.labelPoint.x)).toBe(true);
      expect(Number.isFinite(branch.point.y)).toBe(true);
    }
  });

  it("pulls right-side curves toward targets above or below the source", () => {
    let document = createDocument("方向弧线测试");
    const source = createNode("源", { x: 100, y: 320 });
    const above = createNode("上方", { x: 520, y: 80 });
    const below = createNode("下方", { x: 520, y: 560 });
    document = withNode(document, source, { x: 100, y: 320 });
    document = withNode(document, above, { x: 520, y: 80 });
    document = withNode(document, below, { x: 520, y: 560 });
    document = connectNodes(document, source.id, above.id);
    document = connectNodes(document, source.id, below.id);
    const routing = buildWorkflowRouting(document);
    const upward = routing.routes[document.edges[0].id];
    const downward = routing.routes[document.edges[1].id];
    expect(upward.side).toBe("right");
    expect(downward.side).toBe("right");
    expect(upward.control1.y).toBeLessThan(upward.forkPoint.y);
    expect(downward.control1.y).toBeGreaterThan(downward.forkPoint.y);
    expect(Math.abs(upward.control1.x - upward.forkPoint.x)).toBeLessThan(50);
    expect(Math.abs(downward.control1.x - downward.forkPoint.x)).toBeLessThan(50);
  });

  it("builds live routing without replacing semantic node or edge arrays", () => {
    const { document, source } = branchDocument();
    const live = documentWithNodePositions(document, {
      [source.id]: { x: 180, y: 240 },
    });
    expect(live.nodes).toBe(document.nodes);
    expect(live.edges).toBe(document.edges);
    expect(live.layout.nodes[source.id]).toMatchObject({ x: 180, y: 240 });
  });

  it("projects a pointer onto the actual routed curve for line breaks", () => {
    const { document } = branchDocument();
    const route = Object.values(buildWorkflowRouting(document).routes)[0];
    const onCurve = {
      x: route.sourcePoint.x * 0.55 + route.targetPoint.x * 0.45 + 18,
      y: route.sourcePoint.y * 0.55 + route.targetPoint.y * 0.45 - 14,
    };
    const projection = projectPointOntoRoute(onCurve, route);
    expect(projection.progress).toBeGreaterThan(0);
    expect(projection.progress).toBeLessThan(1);
    expect(projection.distance).toBeGreaterThan(0);
    expect(
      projectPointOntoRoute(projection.point, route).distance,
    ).toBeLessThan(0.5);
  });

  it("splits a line with C centered on the projected route point", () => {
    const { document, source, left } = branchDocument();
    const edge = document.edges.find(
      (candidate) =>
        candidate.source === source.id && candidate.target === left.id,
    )!;
    const route = buildWorkflowRouting(document).routes[edge.id];
    const pointer = {
      x: route.sourcePoint.x * 0.4 + route.targetPoint.x * 0.6 + 22,
      y: route.sourcePoint.y * 0.4 + route.targetPoint.y * 0.6 - 18,
    };
    const projection = projectPointOntoRoute(pointer, route);
    const split = splitEdge(
      document,
      edge.id,
      projection.point,
      "source",
      { nodeTitle: "", nodeType: "fork" },
    );
    expect(
      split.document.nodes.find(
        (node) => node.id === split.insertedNodeId,
      )?.type,
    ).toBe("fork");
    const layout = split.document.layout.nodes[split.insertedNodeId!];
    expect(layout.x + layout.width / 2).toBeCloseTo(projection.point.x, 6);
    expect(layout.y + layout.height / 2).toBeCloseTo(projection.point.y, 6);
    expect(
      projectPointOntoRoute(projection.point, route).distance,
    ).toBeLessThan(0.5);
  });
});
