import { describe, expect, it } from "vitest";
import {
  addEdgeToBundle,
  attachEdgeToSourceBundle,
  createBranchBundle,
  updateBundle,
} from "./bundles";
import {
  connectNodes,
  createDocument,
  createNode,
  withNode,
} from "./document";

function fixture() {
  let document = createDocument("分支束测试");
  const source = createNode("判断", { x: 100, y: 100 }, "decision");
  const first = createNode("是", { x: 480, y: 60 });
  const second = createNode("否", { x: 480, y: 220 });
  const third = createNode("例外", { x: 480, y: 380 });
  for (const node of [source, first, second, third]) {
    document = withNode(
      document,
      node,
      document.layout.nodes[node.id] ?? { x: 100, y: 100 },
    );
  }
  document = connectNodes(document, source.id, first.id, "通过");
  document = connectNodes(document, source.id, second.id, "拒绝");
  document = connectNodes(document, source.id, third.id, "待定");
  return { document, source, first, second, third };
}

describe("explicit workflow bundles", () => {
  it("adds a new branch to the same bundle", () => {
    const { document, source, first, second, third } = fixture();
    const firstEdge = document.edges.find((edge) => edge.target === first.id)!;
    const secondEdge = document.edges.find((edge) => edge.target === second.id)!;
    const thirdEdge = document.edges.find((edge) => edge.target === third.id)!;
    const bundled = createBranchBundle(
      document,
      source.id,
      [firstEdge.id, secondEdge.id],
      "方针",
    );
    const bundle = bundled.bundles[0];
    const expanded = addEdgeToBundle(bundled, bundle.id, thirdEdge.id);
    expect(expanded.bundles[0].edgeIds).toEqual(
      expect.arrayContaining([firstEdge.id, secondEdge.id, thirdEdge.id]),
    );
  });

  it("removes a one-member bundle and preserves its text on the remaining edge", () => {
    const { document, source, first, second } = fixture();
    const firstEdge = document.edges.find((edge) => edge.target === first.id)!;
    const secondEdge = document.edges.find((edge) => edge.target === second.id)!;
    const bundled = createBranchBundle(
      document,
      source.id,
      [firstEdge.id, secondEdge.id],
      "方针",
    );
    const oneMember = updateBundle(bundled, bundled.bundles[0].id, {
      edgeIds: [firstEdge.id],
    });
    expect(oneMember.bundles).toHaveLength(0);
    const retained = oneMember.edges.find((edge) => edge.id === firstEdge.id);
    expect(retained?.bundleId).toBeUndefined();
    expect(retained?.label).toContain("方针");
    expect(retained?.label).toContain("通过");
  });

  it("attaches border-created edges to the same-direction source bundle", () => {
    const { document, source, first, second } = fixture();
    const firstEdge = document.edges.find((edge) => edge.target === first.id)!;
    const secondEdge = document.edges.find((edge) => edge.target === second.id)!;
    const firstBundle = attachEdgeToSourceBundle(
      document,
      source.id,
      firstEdge.id,
      document.layout.nodes[first.id],
    );
    expect(firstBundle.bundles).toHaveLength(1);
    const joined = attachEdgeToSourceBundle(
      firstBundle,
      source.id,
      secondEdge.id,
      document.layout.nodes[second.id],
    );
    expect(joined.bundles).toHaveLength(1);
    expect(joined.bundles[0].edgeIds).toEqual(
      expect.arrayContaining([firstEdge.id, secondEdge.id]),
    );
    expect(
      joined.edges.find((edge) => edge.id === secondEdge.id)?.bundleId,
    ).toBe(joined.bundles[0].id);
  });
});
