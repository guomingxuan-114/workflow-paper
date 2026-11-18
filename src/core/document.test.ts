import { describe, expect, it } from "vitest";
import {
  connectNodes,
  createDocument,
  createNode,
  duplicateNodes,
  groupNodes,
  moveGroup,
  moveNodes,
  removeByIds,
  updateNode,
  withNode,
  WorkflowValidationError,
  validateDocument,
  workflowContentKey,
} from "./document";

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

