import type { VersionDiff, WorkflowDocument, WorkflowNode } from "./types";

function comparable(node: WorkflowNode) {
  return {
    title: node.title,
    description: node.description,
    type: node.type,
    tags: node.tags,
    source: node.source,
  };
}

export function compareWorkflowVersions(
  base: WorkflowDocument,
  current: WorkflowDocument,
): VersionDiff {
  const before = new Map(base.nodes.map((node) => [node.id, node]));
  const after = new Map(current.nodes.map((node) => [node.id, node]));
  const added = current.nodes.filter((node) => !before.has(node.id));
  const removed = base.nodes.filter((node) => !after.has(node.id));
  const changed: VersionDiff["changed"] = [];

  for (const node of current.nodes) {
    const previous = before.get(node.id);
    if (!previous) continue;
    const a = comparable(previous);
    const b = comparable(node);
    const fields = Object.keys(a).filter(
      (key) =>
        JSON.stringify(a[key as keyof typeof a]) !==
        JSON.stringify(b[key as keyof typeof b]),
    );
    if (fields.length > 0) {
      changed.push({ id: node.id, before: previous, after: node, fields });
    }
  }
  return { added, removed, changed };
}

