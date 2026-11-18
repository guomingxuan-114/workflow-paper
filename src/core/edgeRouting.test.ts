import { describe, expect, it } from "vitest";
import {
  connectNodes,
  createDocument,
  createNode,
  groupNodes,
  withNode,
} from "./document";
import {
  buildConnectionPreview,
  buildWorkflowRouting,
  distanceToRoute,
  routeIntersectsRect,
} from "./edgeRouting";

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
  it("gives every outgoing edge one common trunk and branch point", () => {
    const { document, source } = branchDocument();
    const routing = buildWorkflowRouting(document);
    const routes = Object.values(routing.routes);
    expect(routes).toHaveLength(3);
    expect(new Set(routes.map((route) => route.trunkPath)).size).toBe(1);
    expect(new Set(routes.map((route) => JSON.stringify(route.forkPoint))).size).toBe(1);
    const branch = Object.values(routing.branches)[0];
    expect(branch.edgeIds).toHaveLength(3);
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

  it("only shares a fork for edges that naturally leave the same side", () => {
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
    expect(branches).toHaveLength(1);
    expect(branches[0].side).toBe("right");
    expect(branches[0].edgeIds).toHaveLength(2);
    expect(Object.values(routing.routes)).toHaveLength(5);
    for (const route of Object.values(routing.routes)) {
      expect(routeIntersectsRect(route, document.layout.nodes[source.id], 4)).toBe(false);
      expect(routeIntersectsRect(route, document.layout.nodes[route.targetId], 4)).toBe(false);
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
    expect(preview?.endPoint.x).toBeLessThanOrEqual(460);
  });
});
