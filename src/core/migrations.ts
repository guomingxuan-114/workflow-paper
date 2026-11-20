import { reconcileWorkflowBundles } from "./bundles";
import { nodeMetrics } from "./nodeShapes";
import type {
  NodeKind,
  WorkflowBundle,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowGroup,
  WorkflowNode,
  WorkflowPalette,
} from "./types";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function migrateWorkflowDocument(input: unknown): WorkflowDocument {
  if (!object(input)) return input as unknown as WorkflowDocument;
  const isV1 = input.schemaVersion === 1;
  if (!isV1 && input.schemaVersion !== 2) {
    return input as unknown as WorkflowDocument;
  }

  const nodes = (Array.isArray(input.nodes) ? input.nodes : []).map(
    (raw): WorkflowNode => {
      const node = raw as WorkflowNode;
      const legacyType = (raw as { type?: NodeKind | "milestone" }).type;
      const wasMilestone = legacyType === "milestone";
      return {
        ...node,
        type: wasMilestone ? "task" : legacyType ?? node.type,
        milestone:
          node.milestone ??
          (wasMilestone ? { label: "里程碑" } : undefined),
        important: Boolean(node.important),
      };
    },
  );
  const edges = (
    Array.isArray(input.edges) ? input.edges : []
  ).map(
    (raw): WorkflowEdge => ({
      ...(raw as WorkflowEdge),
      important: Boolean((raw as WorkflowEdge).important),
    }),
  );
  const groups = (
    Array.isArray(input.groups) ? input.groups : []
  ).map(
    (raw): WorkflowGroup => ({
      ...(raw as WorkflowGroup),
      important: Boolean((raw as WorkflowGroup).important),
    }),
  );
  const bundles = (
    Array.isArray(input.bundles) ? input.bundles : []
  ) as WorkflowBundle[];
  const rawLayout = object(input.layout) ? input.layout : {};
  const rawNodeLayout = object(rawLayout.nodes) ? rawLayout.nodes : {};
  const nodeLayout = Object.fromEntries(
    nodes.map((node) => {
      const existing = rawNodeLayout[node.id];
      const metrics = nodeMetrics(node);
      return [
        node.id,
        object(existing)
          ? {
              x: Number(existing.x) || 0,
              y: Number(existing.y) || 0,
              width: Number(existing.width) || metrics.width,
              height: Number(existing.height) || metrics.height,
            }
          : { x: 120, y: 120, width: metrics.width, height: metrics.height },
      ];
    }),
  );
  const migrated: WorkflowDocument = {
    ...(input as unknown as WorkflowDocument),
    schemaVersion: 2,
    nodes,
    edges,
    groups,
    bundles,
    layout: {
      nodes: nodeLayout,
      groups: object(rawLayout.groups)
        ? (rawLayout.groups as WorkflowDocument["layout"]["groups"])
        : {},
      viewport: object(rawLayout.viewport)
        ? (rawLayout.viewport as unknown as WorkflowDocument["layout"]["viewport"])
        : { x: 0, y: 0, zoom: 1 },
    },
    display: {
      showDescriptions: object(input.display)
        ? Boolean(input.display.showDescriptions)
        : true,
      theme:
        object(input.display) && input.display.theme === "dark"
          ? "dark"
          : "paper",
      palette:
        object(input.display) && input.display.palette === "bauhaus"
          ? "bauhaus"
          : ("default" as WorkflowPalette),
    },
  };
  return reconcileWorkflowBundles(migrated);
}
