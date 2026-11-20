import type {
  VersionDiff,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowGroup,
  WorkflowNode,
} from "./types";

function comparable(node: WorkflowNode) {
  return {
    title: node.title,
    description: node.description,
    type: node.type,
    tags: node.tags,
    source: node.source,
    milestone: node.milestone,
    important: Boolean(node.important),
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
  const edgesBefore = new Map(base.edges.map((edge) => [edge.id, edge]));
  const edgesAfter = new Map(current.edges.map((edge) => [edge.id, edge]));
  const addedEdges = current.edges.filter((edge) => !edgesBefore.has(edge.id));
  const removedEdges = base.edges.filter((edge) => !edgesAfter.has(edge.id));
  const changedEdges: VersionDiff["edges"]["changed"] = [];
  for (const edge of current.edges) {
    const previous = edgesBefore.get(edge.id);
    if (!previous) continue;
    const fields = (
      ["source", "target", "label", "important", "bundleId"] as const
    ).filter(
      (field) =>
        JSON.stringify(previous[field] ?? null) !==
        JSON.stringify(edge[field] ?? null),
    );
    if (fields.length > 0) {
      changedEdges.push({
        id: edge.id,
        before: previous,
        after: edge,
        fields: [...fields],
      });
    }
  }

  const groupsBefore = new Map(base.groups.map((group) => [group.id, group]));
  const groupsAfter = new Map(current.groups.map((group) => [group.id, group]));
  const addedGroups = current.groups.filter((group) => !groupsBefore.has(group.id));
  const removedGroups = base.groups.filter((group) => !groupsAfter.has(group.id));
  const changedGroups: VersionDiff["groups"]["changed"] = [];
  for (const group of current.groups) {
    const previous = groupsBefore.get(group.id);
    if (!previous) continue;
    const fields = (
      [
        "title",
        "collapsed",
        "color",
        "nodeIds",
        "parentId",
        "important",
      ] as const
    ).filter(
      (field) =>
        JSON.stringify(previous[field]) !== JSON.stringify(group[field]),
    );
    if (fields.length > 0) {
      changedGroups.push({
        id: group.id,
        before: previous,
        after: group,
        fields: [...fields],
      });
    }
  }

  return {
    added,
    removed,
    changed,
    edges: {
      added: addedEdges,
      removed: removedEdges,
      changed: changedEdges,
    },
    groups: {
      added: addedGroups,
      removed: removedGroups,
      changed: changedGroups,
    },
  };
}

