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
});

