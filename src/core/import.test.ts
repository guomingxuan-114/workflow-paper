import { describe, expect, it } from "vitest";
import { sampleImport } from "./templates";
import {
  importSnapshot,
  validateImportSnapshot,
} from "./import";
import { WorkflowValidationError } from "./document";

describe("program snapshot import v1", () => {
  it("creates stable ids, provenance and positions", () => {
    const first = importSnapshot(sampleImport);
    const second = importSnapshot(sampleImport);
    expect(first.nodes.map((node) => node.id)).toEqual(
      second.nodes.map((node) => node.id),
    );
    expect(first.nodes).toHaveLength(6);
    expect(first.edges).toHaveLength(5);
    expect(first.groups).toHaveLength(2);
    expect(first.provenance).toMatchObject({
      system: "示例发布程序",
      version: "v1.4.0",
      commit: "8c41ea2",
    });
    expect(first.nodes[0].origin).toMatchObject({
      kind: "import",
      originalId: "commit",
    });
    expect(first.nodes[4]).toMatchObject({
      type: "task",
      milestone: { label: "里程碑" },
    });
    expect(first.layout.nodes[first.nodes[0].id]).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
    });
  });

  it("reports an unsupported protocol version", () => {
    try {
      validateImportSnapshot({
        ...(sampleImport as Record<string, unknown>),
        schemaVersion: 99,
      });
      throw new Error("expected validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowValidationError);
      expect((error as WorkflowValidationError).issues).toContain(
        "仅支持导入协议 schemaVersion 1，收到 99",
      );
    }
  });

  it("reports dangling import relationships with details", () => {
    const invalid = {
      ...(sampleImport as Record<string, unknown>),
      edges: [{ source: "commit", target: "does-not-exist" }],
    };
    try {
      validateImportSnapshot(invalid);
      throw new Error("expected validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowValidationError);
      expect((error as WorkflowValidationError).issues[0]).toContain(
        "source/target",
      );
    }
  });
});

