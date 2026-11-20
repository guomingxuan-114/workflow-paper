import { describe, expect, it } from "vitest";
import { compareWorkflowVersions } from "./diff";
import { importSnapshot } from "./import";
import { sampleImport } from "./templates";

describe("version diff", () => {
  it("identifies added, removed and changed imported nodes by stable id", () => {
    const base = importSnapshot(sampleImport);
    const nextInput = structuredClone(sampleImport) as Record<string, unknown>;
    const nodes = nextInput.nodes as Array<Record<string, unknown>>;
    nodes[0].title = "冻结候选版本";
    nodes[1].id = "quality-gate";
    const edges = nextInput.edges as Array<Record<string, unknown>>;
    edges[0].target = "quality-gate";
    edges[1].source = "quality-gate";
    nodes.push({
      id: "audit",
      title: "生成审计记录",
      type: "task",
    });
    edges.push({ source: "finish", target: "audit" });
    const next = importSnapshot(nextInput);
    const diff = compareWorkflowVersions(base, next);
    expect(diff.added.map((node) => node.title)).toContain("生成审计记录");
    expect(diff.removed.map((node) => node.title)).toContain("运行质量门禁");
    expect(
      diff.changed.some(
        (entry) =>
          entry.after.title === "冻结候选版本" &&
          entry.fields.includes("title"),
      ),
    ).toBe(true);
  });

  it("reports edge label changes and group membership changes", () => {
    const base = importSnapshot(sampleImport);
    const current = structuredClone(base);
    current.edges[0] = {
      ...current.edges[0],
      label: "只在夜间发布",
    };
    current.edges[1] = {
      ...current.edges[1],
      target: base.nodes[1].id,
    };
    current.edges.splice(2, 1);
    current.edges.push({
      id: "new-edge",
      source: base.nodes[1].id,
      target: base.nodes[2].id,
      label: "新增关系",
      origin: "manual",
    });
    current.groups[0] = {
      ...current.groups[0],
      nodeIds: current.groups[0].nodeIds.slice(0, 1),
      collapsed: true,
    };
    current.groups[1] = {
      ...current.groups[1],
      nodeIds: [
        ...current.groups[1].nodeIds,
        base.groups[0].nodeIds[1],
      ],
      important: true,
    };
    current.nodes[0] = {
      ...current.nodes[0],
      milestone: { label: "M1" },
      important: true,
    };
    current.edges[0] = {
      ...current.edges[0],
      important: true,
      bundleId: "bundle-main",
    };
    const diff = compareWorkflowVersions(base, current);
    expect(diff.edges.changed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: base.edges[0].id,
          fields: expect.arrayContaining(["label"]),
        }),
      ]),
    );
    expect(diff.groups.changed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: base.groups[0].id,
          fields: expect.arrayContaining(["collapsed", "nodeIds"]),
        }),
      ]),
    );
    expect(diff.edges.added.map((edge) => edge.id)).toContain("new-edge");
    expect(diff.edges.removed).toHaveLength(1);
    expect(
      diff.edges.changed.some((entry) => entry.fields.includes("target")),
    ).toBe(true);
    expect(
      diff.edges.changed.some((entry) =>
        entry.fields.includes("important") &&
        entry.fields.includes("bundleId"),
      ),
    ).toBe(true);
    expect(
      diff.changed.some((entry) =>
        entry.fields.includes("milestone") &&
        entry.fields.includes("important"),
      ),
    ).toBe(true);
    expect(
      diff.groups.changed.some((entry) =>
        entry.fields.includes("important"),
      ),
    ).toBe(true);
  });
});

