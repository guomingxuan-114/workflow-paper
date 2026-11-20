import { describe, expect, it } from "vitest";
import {
  addNodeToEdgeEndpointGroup,
  connectNodes,
  createDocument,
  createNode,
  duplicateNodes,
  groupNodes,
  moveGroup,
  moveNodes,
  removeNodeFromGroup,
  removeByIds,
  resizeNode,
  splitEdge,
  updateNode,
  withNode,
  WorkflowValidationError,
  validateDocument,
  workflowContentKey,
} from "./document";
import { packWorkflow, unpackWorkflow } from "./wflow";
import { nodeBoundaryPath, nodeMetrics } from "./nodeShapes";

function fixture() {
  let document = createDocument("测试流程");
  const first = createNode("提交", { x: 100, y: 100 }, "start");
  const second = createNode("审核", { x: 400, y: 100 }, "decision");
  document = withNode(document, first, { x: 100, y: 100 });
  document = withNode(document, second, { x: 400, y: 100 });
  document = connectNodes(document, first.id, second.id, "提交审核");
  return { document, first, second };
}

describe("workflow document", () => {
  it("keeps semantic nodes and edges unchanged when layout moves", () => {
    const { document, first } = fixture();
    const moved = moveNodes(document, {
      [first.id]: { x: 900, y: 320 },
    });

    expect(moved.nodes).toEqual(document.nodes);
    expect(moved.edges).toEqual(document.edges);
    expect(moved.layout.nodes[first.id]).toMatchObject({
      x: 900,
      y: 320,
    });
  });

  it("updates content without changing stable ids", () => {
    const { document, first } = fixture();
    const updated = updateNode(document, first.id, {
      title: "提交候选版本",
      tags: ["CI"],
    });
    expect(updated.nodes[0].id).toBe(first.id);
    expect(updated.nodes[0].title).toBe("提交候选版本");
    expect(updated.nodes[0].tags).toEqual(["CI"]);
  });

  it("adopts the new default size when switching type before manual resize", () => {
    let document = createDocument("类型尺寸测试");
    const node = createNode("普通节点", { x: 100, y: 100 }, "task");
    document = withNode(document, node, { x: 100, y: 100 });
    const changed = updateNode(document, node.id, { type: "decision" });
    const metrics = nodeMetrics({
      ...node,
      type: "decision",
    });
    expect(changed.layout.nodes[node.id]).toMatchObject({
      width: metrics.width,
      height: metrics.height,
    });
    const createdDecision = createNode("新建判断", { x: 0, y: 0 }, "decision");
    expect(nodeMetrics(createdDecision)).toMatchObject(metrics);
  });

  it("preserves a manually resized node when switching type", () => {
    let document = createDocument("手动尺寸测试");
    const node = createNode("宽节点", { x: 100, y: 100 }, "task");
    document = withNode(document, node, { x: 100, y: 100 });
    document = resizeNode(document, node.id, 320, 160);
    const changed = updateNode(document, node.id, { type: "end" });
    expect(changed.layout.nodes[node.id]).toMatchObject({
      width: 320,
      height: 160,
    });
  });

  it("creates a normal task as the default first node", () => {
    const node = createNode();
    expect(node.type).toBe("task");
    expect(node.title).toBe("未命名节点");
    expect(nodeBoundaryPath(node, 224, 106)).toContain("A 12 12");
  });

  it("round-trips an empty-title fork node with stadium geometry", () => {
    let document = createDocument("分叉点测试");
    const fork = createNode("", { x: 200, y: 160 }, "fork");
    document = withNode(document, fork, { x: 200, y: 160 });
    expect(nodeMetrics(fork).shape).toBe("capsule");
    expect(document.layout.nodes[fork.id].width).toBe(44);
    const named = updateNode(document, fork.id, { title: "发布分支" });
    expect(named.layout.nodes[fork.id].width).toBeGreaterThan(44);
    const cleared = updateNode(named, fork.id, { title: "" });
    expect(cleared.layout.nodes[fork.id].width).toBe(44);
    const reopened = unpackWorkflow(packWorkflow(document));
    const restored = reopened.nodes.find((node) => node.id === fork.id);
    expect(restored?.type).toBe("fork");
    expect(restored?.title).toBe("");
  });

  it("does not create duplicate or self relationships", () => {
    const { document, first, second } = fixture();
    expect(connectNodes(document, first.id, first.id).edges).toHaveLength(1);
    expect(connectNodes(document, first.id, second.id).edges).toHaveLength(1);
  });

  it("groups, duplicates, and deletes nodes while keeping edges consistent", () => {
    const { document, first, second } = fixture();
    const grouped = groupNodes(document, [first.id, second.id], "准备");
    expect(grouped.groups[0].nodeIds).toEqual([first.id, second.id]);

    const duplicated = duplicateNodes(grouped, [first.id, second.id]);
    expect(duplicated.nodeIds).toHaveLength(2);
    expect(duplicated.edgeIds).toHaveLength(1);
    const copiedEdge = duplicated.document.edges.find(
      (edge) => edge.id === duplicated.edgeIds[0],
    );
    expect(duplicated.nodeIds).toContain(copiedEdge?.source);
    expect(duplicated.nodeIds).toContain(copiedEdge?.target);

    const removed = removeByIds(grouped, { nodeIds: [second.id] });
    expect(removed.nodes).toHaveLength(1);
    expect(removed.edges).toHaveLength(0);
    expect(removed.groups[0].nodeIds).toEqual([first.id]);
  });

  it("rejects dangling edges and missing layout", () => {
    const { document } = fixture();
    const invalid = {
      ...document,
      edges: [
        ...document.edges,
        {
          id: "dangling",
          source: "missing",
          target: document.nodes[0].id,
          origin: "manual",
        },
      ],
    };
    expect(() => validateDocument(invalid)).toThrow(WorkflowValidationError);
  });

  it("moves group members and nested groups by the same delta", () => {
    const { document, first, second } = fixture();
    const root = groupNodes(document, [first.id], "根分组");
    const rootId = root.groups[0].id;
    const nestedId = "nested-group";
    const prepared: typeof root = {
      ...root,
      groups: [
        root.groups[0],
        {
          id: nestedId,
          title: "嵌套分组",
          nodeIds: [second.id],
          parentId: rootId,
          collapsed: false,
        },
      ],
      layout: {
        ...root.layout,
        groups: {
          ...root.layout.groups,
          [nestedId]: {
            x: 360,
            y: 60,
            width: 300,
            height: 200,
          },
        },
      },
    };
    const beforeNode = prepared.layout.nodes[second.id];
    const beforeNested = prepared.layout.groups[nestedId];
    const rootBefore = prepared.layout.groups[rootId];
    const moved = moveGroup(prepared, rootId, {
      x: rootBefore.x + 64,
      y: rootBefore.y + 48,
    });
    expect(moved.layout.nodes[first.id]).toMatchObject({
      x: prepared.layout.nodes[first.id].x + 64,
      y: prepared.layout.nodes[first.id].y + 48,
    });
    expect(moved.layout.nodes[second.id]).toMatchObject({
      x: beforeNode.x + 64,
      y: beforeNode.y + 48,
    });
    expect(moved.layout.groups[nestedId]).toMatchObject({
      x: beforeNested.x + 64,
      y: beforeNested.y + 48,
    });
    expect(moved.layout.groups[rootId]).toMatchObject({
      x: rootBefore.x + 64,
      y: rootBefore.y + 48,
    });
    const reopened = unpackWorkflow(packWorkflow(moved));
    expect(reopened.layout.nodes[second.id]).toMatchObject(
      moved.layout.nodes[second.id],
    );
    expect(reopened.layout.groups[nestedId]).toMatchObject(
      moved.layout.groups[nestedId],
    );
  });

  it("keeps grouping until the user explicitly removes a node", () => {
    const { document, first, second } = fixture();
    const grouped = groupNodes(document, [first.id, second.id], "准备");
    const moved = moveNodes(grouped, {
      [first.id]: { x: 1200, y: 420 },
    });
    expect(moved.groups[0].nodeIds).toContain(first.id);
    const removed = removeNodeFromGroup(moved, first.id);
    expect(removed.groups[0].nodeIds).not.toContain(first.id);
    expect(removed.groups[0].nodeIds).toContain(second.id);
  });

  it("resizes nodes with shape minimums and grid snapping", () => {
    const { document, second } = fixture();
    const resized = resizeNode(document, second.id, 191, 97);
    expect(resized.layout.nodes[second.id]).toMatchObject({
      width: 190,
      height: 100,
    });
  });

  it("splits an edge at an explicit point and inherits the label on the chosen segment", () => {
    const { document, second } = fixture();
    const edge = document.edges[0];
    const split = splitEdge(
      document,
      edge.id,
      { x: 360, y: 180 },
      "target",
    );
    expect(split.insertedNodeId).toBeTruthy();
    const sourceEdge = split.document.edges.find(
      (candidate) =>
        candidate.source === edge.source &&
        candidate.target === split.insertedNodeId,
    );
    const targetEdge = split.document.edges.find(
      (candidate) =>
        candidate.source === split.insertedNodeId &&
        candidate.target === second.id,
    );
    expect(sourceEdge?.label).toBeUndefined();
    expect(targetEdge?.label).toBe(edge.label);
  });

  it("places split and derived nodes in the endpoints' shared group", () => {
    const { document, first, second } = fixture();
    const grouped = groupNodes(document, [first.id, second.id], "同组流程");
    const split = splitEdge(
      grouped,
      grouped.edges[0].id,
      { x: 240, y: 110 },
      "source",
      { nodeTitle: "未命名节点" },
    );
    const breakNode = split.document.nodes.find(
      (node) => node.id === split.insertedNodeId,
    );
    expect(breakNode?.title).toBe("未命名节点");
    expect(split.document.groups[0].nodeIds).toContain(
      split.insertedNodeId,
    );

    const derived = createNode("未命名节点", { x: 300, y: 260 });
    const withDerived = withNode(
      split.document,
      derived,
      { x: 300, y: 260 },
    );
    const inherited = addNodeToEdgeEndpointGroup(
      withDerived,
      derived.id,
      first.id,
      second.id,
    );
    expect(inherited.groups[0].nodeIds).toContain(derived.id);
  });

  it("ignores viewport-only changes in the persisted content key", () => {
    const { document, first } = fixture();
    const panned = {
      ...document,
      layout: {
        ...document.layout,
        viewport: { x: 220, y: -90, zoom: 1.4 },
      },
    };
    expect(workflowContentKey(panned)).toBe(workflowContentKey(document));
    expect(
      workflowContentKey(
        moveNodes(document, { [first.id]: { x: 180, y: 260 } }),
      ),
    ).not.toBe(workflowContentKey(document));
  });
});

