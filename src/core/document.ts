import { createId } from "./id";
import { reconcileWorkflowBundles } from "./bundles";
import { migrateWorkflowDocument } from "./migrations";
import { nodeMetrics, snapNodeSize } from "./nodeShapes";
import type {
  NodeKind,
  Point,
  Selection,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowGroup,
  WorkflowNode,
  WorkflowPalette,
  WorkflowTheme,
} from "./types";

export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 106;
export const GROUP_PADDING = 36;

const allowedNodeKinds: NodeKind[] = [
  "start",
  "fork",
  "task",
  "decision",
  "end",
  "note",
];

function forkWidthForTitle(title: string): number {
  const trimmed = title.trim();
  if (!trimmed) return 44;
  const visualLength = Array.from(trimmed).reduce(
    (length, character) =>
      length + (/^[\x00-\x7F]$/.test(character) ? 7 : 12),
    0,
  );
  return Math.max(120, Math.min(220, visualLength + 48));
}

export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

function now(): string {
  return new Date().toISOString();
}

export function createDocument(
  title = "未命名工作流",
  theme: WorkflowTheme = "paper",
  palette: WorkflowPalette = "default",
): WorkflowDocument {
  const timestamp = now();
  return {
    schemaVersion: 2,
    id: createId("doc"),
    metadata: {
      title,
      description: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    provenance: {},
    nodes: [],
    edges: [],
    groups: [],
    bundles: [],
    layout: {
      nodes: {},
      groups: {},
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    display: {
      showDescriptions: true,
      theme,
      palette,
    },
  };
}

export function createNode(
  title = "未命名节点",
  position: Point = { x: 120, y: 120 },
  type: NodeKind = "task",
): WorkflowNode {
  return {
    id: createId("node"),
    title,
    description: "",
    type,
    tags: [],
    origin: { kind: "manual" },
    important: false,
  };
}

export function withNode(
  document: WorkflowDocument,
  node: WorkflowNode,
  position: Point,
): WorkflowDocument {
  const metrics = nodeMetrics(node);
  return {
    ...document,
    nodes: [...document.nodes, node],
    layout: {
      ...document.layout,
      nodes: {
        ...document.layout.nodes,
        [node.id]: {
          ...position,
          width: metrics.width,
          height: metrics.height,
        },
      },
    },
  };
}

export function connectNodes(
  document: WorkflowDocument,
  source: string,
  target: string,
  label?: string,
  origin: WorkflowEdge["origin"] = "manual",
): WorkflowDocument {
  if (source === target) return document;
  if (
    document.edges.some(
      (edge) => edge.source === source && edge.target === target,
    )
  ) {
    return document;
  }
  const edge: WorkflowEdge = {
    id: createId("edge"),
    source,
    target,
    ...(label ? { label } : {}),
    origin,
  };
  return { ...document, edges: [...document.edges, edge] };
}

export function updateNode(
  document: WorkflowDocument,
  nodeId: string,
  patch: Partial<Omit<WorkflowNode, "id">>,
): WorkflowDocument {
  const previous = document.nodes.find((node) => node.id === nodeId);
  if (!previous) return document;
  const next = { ...previous, ...patch, id: previous.id };
  const layout = document.layout.nodes[nodeId];
  const typeChanged = patch.type && patch.type !== previous.type;
  if (!layout) {
    return {
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === nodeId ? next : node,
      ),
    };
  }
  const previousMetrics = nodeMetrics(previous);
  const usesDefaultSize =
    layout.width === previousMetrics.width &&
    layout.height === previousMetrics.height;
  let nextLayout = layout;
  if (typeChanged && usesDefaultSize) {
    const nextMetrics = nodeMetrics(next);
    nextLayout = {
      ...layout,
      width: nextMetrics.width,
      height: nextMetrics.height,
    };
  }
  if (next.type === "fork" && patch.title !== undefined) {
    const previousAutoWidth = forkWidthForTitle(previous.title);
    const nextWidth = forkWidthForTitle(next.title);
    if (
      nextLayout.width === 44 ||
      nextLayout.width === previousAutoWidth ||
      (typeChanged && usesDefaultSize)
    ) {
      nextLayout = {
        ...nextLayout,
        width: nextWidth,
        height: nodeMetrics(next).height,
      };
    }
  }
  if (nextLayout === layout) {
    return {
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === nodeId ? next : node,
      ),
    };
  }
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === nodeId ? next : node,
    ),
    layout: {
      ...document.layout,
      nodes: {
        ...document.layout.nodes,
        [nodeId]: nextLayout,
      },
    },
  };
}

export function updateEdge(
  document: WorkflowDocument,
  edgeId: string,
  patch: Partial<Omit<WorkflowEdge, "id" | "source" | "target">>,
): WorkflowDocument {
  return {
    ...document,
    edges: document.edges.map((edge) =>
      edge.id === edgeId ? { ...edge, ...patch } : edge,
    ),
  };
}

export function updateGroup(
  document: WorkflowDocument,
  groupId: string,
  patch: Partial<Omit<WorkflowGroup, "id">>,
): WorkflowDocument {
  return {
    ...document,
    groups: document.groups.map((group) =>
      group.id === groupId ? { ...group, ...patch, id: group.id } : group,
    ),
  };
}

export function moveNodes(
  document: WorkflowDocument,
  positions: Record<string, Point>,
): WorkflowDocument {
  const next = { ...document.layout.nodes };
  for (const [id, position] of Object.entries(positions)) {
    if (next[id]) {
      next[id] = { ...next[id], ...position };
    }
  }
  return {
    ...document,
    layout: { ...document.layout, nodes: next },
  };
}

export function moveGroup(
  document: WorkflowDocument,
  groupId: string,
  position: Point,
): WorkflowDocument {
  const groupLayout = document.layout.groups[groupId];
  if (!groupLayout) return document;
  const dx = position.x - groupLayout.x;
  const dy = position.y - groupLayout.y;
  if (dx === 0 && dy === 0) return document;

  const nodeIds = new Set(getGroupNodeIds(document, groupId));
  const groupIds = new Set<string>([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of document.groups) {
      if (
        group.parentId &&
        groupIds.has(group.parentId) &&
        !groupIds.has(group.id)
      ) {
        groupIds.add(group.id);
        group.nodeIds.forEach((nodeId) => nodeIds.add(nodeId));
        changed = true;
      }
    }
  }

  const nodes = { ...document.layout.nodes };
  for (const nodeId of nodeIds) {
    const layout = nodes[nodeId];
    if (layout) {
      nodes[nodeId] = {
        ...layout,
        x: layout.x + dx,
        y: layout.y + dy,
      };
    }
  }

  const groups = { ...document.layout.groups };
  for (const id of groupIds) {
    const layout = groups[id];
    if (layout) {
      groups[id] = {
        ...layout,
        x: layout.x + dx,
        y: layout.y + dy,
      };
    }
  }

  return {
    ...document,
    layout: { ...document.layout, nodes, groups },
  };
}

export function resizeNode(
  document: WorkflowDocument,
  nodeId: string,
  width: number,
  height: number,
): WorkflowDocument {
  const layout = document.layout.nodes[nodeId];
  const node = document.nodes.find((item) => item.id === nodeId);
  if (!layout || !node) return document;
  const metrics = nodeMetrics(node);
  const snapped = snapNodeSize(
    Math.max(metrics.minWidth, width),
    Math.max(metrics.minHeight, height),
  );
  if (layout.width === snapped.width && layout.height === snapped.height) {
    return document;
  }
  return {
    ...document,
    layout: {
      ...document.layout,
      nodes: {
        ...document.layout.nodes,
        [nodeId]: { ...layout, ...snapped },
      },
    },
  };
}

export function removeNodeFromGroup(
  document: WorkflowDocument,
  nodeId: string,
): WorkflowDocument {
  const groups = document.groups.map((group) =>
    group.nodeIds.includes(nodeId)
      ? { ...group, nodeIds: group.nodeIds.filter((id) => id !== nodeId) }
      : group,
  );
  return groups.some(
    (group, index) =>
      group.nodeIds.length !== document.groups[index].nodeIds.length,
  )
    ? { ...document, groups }
    : document;
}

export function addNodeToEdgeEndpointGroup(
  document: WorkflowDocument,
  nodeId: string,
  sourceId: string,
  targetId: string,
): WorkflowDocument {
  const sharedGroup = document.groups.find(
    (group) =>
      group.nodeIds.includes(sourceId) &&
      group.nodeIds.includes(targetId),
  );
  if (!sharedGroup || sharedGroup.nodeIds.includes(nodeId)) {
    return document;
  }
  return {
    ...document,
    groups: document.groups.map((group) =>
      group.id === sharedGroup.id
        ? { ...group, nodeIds: [...group.nodeIds, nodeId] }
        : group,
    ),
  };
}

export function splitEdge(
  document: WorkflowDocument,
  edgeId: string,
  splitPoint?: Point,
  inheritedSegment: "source" | "target" = "source",
  options: {
    nodeTitle?: string;
    nodeType?: NodeKind;
    inheritEndpointGroup?: boolean;
  } = {},
): { document: WorkflowDocument; insertedNodeId?: string } {
  const edge = document.edges.find((item) => item.id === edgeId);
  if (!edge) return { document };
  const source = document.layout.nodes[edge.source];
  const target = document.layout.nodes[edge.target];
  if (!source || !target) return { document };
  const insertedNode = createNode(
    options.nodeTitle ?? "未命名节点",
    { x: 0, y: 0 },
    options.nodeType ?? "task",
  );
  const metrics = nodeMetrics(insertedNode);
  const position = {
    x:
      (splitPoint?.x ??
        (source.x + source.width / 2 + target.x + target.width / 2) / 2) -
      metrics.width / 2,
    y:
      (splitPoint?.y ??
        (source.y + source.height / 2 + target.y + target.height / 2) / 2) -
      metrics.height / 2,
  };
  const inserted = insertedNode;
  const sourceEdge: WorkflowEdge = {
    id: createId("edge"),
    source: edge.source,
    target: inserted.id,
    ...(inheritedSegment === "source" && edge.label?.trim()
      ? { label: edge.label }
      : {}),
    origin: "manual",
    ...(edge.important ? { important: true } : {}),
    ...(edge.bundleId ? { bundleId: edge.bundleId } : {}),
  };
  const targetEdge: WorkflowEdge = {
    id: createId("edge"),
    source: inserted.id,
    target: edge.target,
    origin: "manual",
    ...(inheritedSegment === "target" && edge.label?.trim()
      ? { label: edge.label }
      : {}),
  };
  const withNodeDoc = withNode(
    {
      ...document,
      edges: document.edges.filter((item) => item.id !== edgeId),
      bundles: document.bundles.map((bundle) =>
        bundle.edgeIds.includes(edgeId)
          ? {
              ...bundle,
              edgeIds: [
                ...bundle.edgeIds.filter((id) => id !== edgeId),
                sourceEdge.id,
              ],
            }
          : bundle,
      ),
    },
    inserted,
    position,
  );
  let next = reconcileWorkflowBundles({
      ...withNodeDoc,
      edges: [...withNodeDoc.edges, sourceEdge, targetEdge],
    });
  if (options.inheritEndpointGroup !== false) {
    next = addNodeToEdgeEndpointGroup(
      next,
      inserted.id,
      edge.source,
      edge.target,
    );
  }
  return {
    document: next,
    insertedNodeId: inserted.id,
  };
}

export function removeByIds(
  document: WorkflowDocument,
  {
    nodeIds = [],
    edgeIds = [],
    groupIds = [],
  }: { nodeIds?: string[]; edgeIds?: string[]; groupIds?: string[] },
): WorkflowDocument {
  const nodes = new Set(nodeIds);
  const edges = new Set(edgeIds);
  const groups = new Set(groupIds);
  const expandedNodes = new Set(nodes);

  for (const group of document.groups) {
    if (groups.has(group.id)) {
      getGroupNodeIds(document, group.id).forEach((id) =>
        expandedNodes.add(id),
      );
    }
  }

  const nodeLayout = { ...document.layout.nodes };
  expandedNodes.forEach((id) => delete nodeLayout[id]);
  const groupLayout = { ...document.layout.groups };
  groups.forEach((id) => delete groupLayout[id]);

  return reconcileWorkflowBundles({
    ...document,
    nodes: document.nodes.filter((node) => !expandedNodes.has(node.id)),
    edges: document.edges.filter(
      (edge) =>
        !edges.has(edge.id) &&
        !expandedNodes.has(edge.source) &&
        !expandedNodes.has(edge.target),
    ),
    groups: document.groups
      .filter((group) => !groups.has(group.id))
      .map((group) => ({
        ...group,
        nodeIds: group.nodeIds.filter((id) => !expandedNodes.has(id)),
        ...(group.parentId && groups.has(group.parentId)
          ? { parentId: undefined }
          : {}),
      })),
    layout: { ...document.layout, nodes: nodeLayout, groups: groupLayout },
  });
}

export function removeSelection(
  document: WorkflowDocument,
  selection: Selection,
): WorkflowDocument {
  if (selection.kind === "node") {
    return removeByIds(document, { nodeIds: [selection.id] });
  }
  if (selection.kind === "edge") {
    return removeByIds(document, { edgeIds: [selection.id] });
  }
  if (selection.kind === "group") {
    return removeByIds(document, { groupIds: [selection.id] });
  }
  return document;
}

export function duplicateNodes(
  document: WorkflowDocument,
  nodeIds: string[],
  groupIds: string[] = [],
  offset: Point = { x: 44, y: 44 },
): { document: WorkflowDocument; nodeIds: string[]; edgeIds: string[] } {
  const selected = new Set(nodeIds);
  const allNodes = new Set(nodeIds);
  for (const groupId of groupIds) {
    getGroupNodeIds(document, groupId).forEach((id) => allNodes.add(id));
  }

  const idMap = new Map<string, string>();
  const copies: WorkflowNode[] = [];
  const positionMap = { ...document.layout.nodes };
  for (const node of document.nodes) {
    if (!allNodes.has(node.id)) continue;
    const id = createId("node");
    idMap.set(node.id, id);
    copies.push({
      ...node,
      id,
      title: selected.has(node.id) ? `${node.title} 副本` : node.title,
      tags: [...node.tags],
      origin: { kind: "manual" },
    });
    const position = document.layout.nodes[node.id];
    if (position) {
      positionMap[id] = {
        ...position,
        x: position.x + offset.x,
        y: position.y + offset.y,
      };
    }
  }

  const edgeCopies: WorkflowEdge[] = [];
  for (const edge of document.edges) {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (source && target) {
      edgeCopies.push({
        ...edge,
        id: createId("edge"),
        source,
        target,
        origin: "manual",
      });
    }
  }

  return {
    document: {
      ...document,
      nodes: [...document.nodes, ...copies],
      edges: [...document.edges, ...edgeCopies],
      layout: { ...document.layout, nodes: positionMap },
    },
    nodeIds: copies.map((node) => node.id),
    edgeIds: edgeCopies.map((edge) => edge.id),
  };
}

export function groupNodes(
  document: WorkflowDocument,
  nodeIds: string[],
  title = "新分组",
): WorkflowDocument {
  const validIds = nodeIds.filter((id) =>
    document.nodes.some((node) => node.id === id),
  );
  if (validIds.length === 0) return document;
  const positions = validIds
    .map((id) => document.layout.nodes[id])
    .filter(Boolean);
  const minX = Math.min(...positions.map((p) => p.x));
  const minY = Math.min(...positions.map((p) => p.y)) - 48;
  const maxX = Math.max(...positions.map((p) => p.x + p.width));
  const maxY = Math.max(...positions.map((p) => p.y + p.height));
  const group: WorkflowGroup = {
    id: createId("group"),
    title,
    nodeIds: validIds,
    collapsed: false,
    color: "sage",
  };
  return {
    ...document,
    groups: [
      ...document.groups.map((existing) => ({
        ...existing,
        nodeIds: existing.nodeIds.filter((id) => !validIds.includes(id)),
      })),
      group,
    ],
    layout: {
      ...document.layout,
      groups: {
        ...document.layout.groups,
        [group.id]: {
          x: minX - GROUP_PADDING,
          y: minY - GROUP_PADDING,
          width: maxX - minX + GROUP_PADDING * 2,
          height: maxY - minY + GROUP_PADDING * 1.75,
        },
      },
    },
  };
}

export function getGroupNodeIds(
  document: WorkflowDocument,
  groupId: string,
): string[] {
  const visited = new Set<string>();
  const result: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const group = document.groups.find((entry) => entry.id === id);
    if (!group) return;
    result.push(...group.nodeIds);
    document.groups
      .filter((entry) => entry.parentId === id)
      .forEach((child) => visit(child.id));
  };
  visit(groupId);
  return [...new Set(result)];
}

export function getHiddenNodeIds(document: WorkflowDocument): Set<string> {
  const hidden = new Set<string>();
  const visit = (group: WorkflowGroup) => {
    if (group.collapsed) {
      getGroupNodeIds(document, group.id).forEach((id) => hidden.add(id));
    }
    document.groups
      .filter((entry) => entry.parentId === group.id)
      .forEach(visit);
  };
  document.groups.filter((group) => !group.parentId).forEach(visit);
  return hidden;
}

export function touchDocument(document: WorkflowDocument): WorkflowDocument {
  return {
    ...document,
    metadata: { ...document.metadata, updatedAt: now() },
  };
}

export function workflowContentKey(document: WorkflowDocument): string {
  return JSON.stringify({
    ...document,
    layout: {
      nodes: document.layout.nodes,
      groups: document.layout.groups,
    },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateDocument(input: unknown): WorkflowDocument {
  const issues: string[] = [];
  if (!isObject(input)) {
    throw new WorkflowValidationError("文件内容不是有效的工作流文档");
  }
  const migrated = migrateWorkflowDocument(input);
  if (migrated.schemaVersion !== 2) {
    issues.push(
      `不支持的文档 schemaVersion：${String(input.schemaVersion)}；当前支持 1 和 2`,
    );
  }
  const document = migrated;
  if (!Array.isArray(document.nodes)) issues.push("nodes 必须是数组");
  if (!Array.isArray(document.edges)) issues.push("edges 必须是数组");
  if (!Array.isArray(document.groups)) issues.push("groups 必须是数组");
  if (!Array.isArray(document.bundles)) issues.push("bundles 必须是数组");
  if (!isObject(document.layout) || !isObject(document.layout?.nodes)) {
    issues.push("layout.nodes 必须是对象");
  }
  if (!isObject(document.layout) || !isObject(document.layout?.groups)) {
    issues.push("layout.groups 必须是对象");
  }
  if (!isObject(document.metadata)) issues.push("metadata 缺失");

  if (issues.length === 0) {
    const nodeIds = new Set<string>();
    for (const node of document.nodes) {
      if (!node.id || nodeIds.has(node.id)) {
        issues.push(`节点 ID 缺失或重复：${node.id || "(empty)"}`);
      }
      nodeIds.add(node.id);
      if (!allowedNodeKinds.includes(node.type)) {
        issues.push(`节点 ${node.id} 的类型无效：${String(node.type)}`);
      }
      if (!Array.isArray(node.tags)) {
        issues.push(`节点 ${node.id} 的 tags 必须是数组`);
      }
      if (!document.layout.nodes[node.id]) {
        issues.push(`节点 ${node.id} 缺少布局位置`);
      }
    }
    for (const edge of document.edges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        issues.push(`关系 ${edge.id} 指向不存在的节点`);
      }
    }
    for (const group of document.groups) {
      for (const nodeId of group.nodeIds) {
        if (!nodeIds.has(nodeId)) {
          issues.push(`分组 ${group.id} 引用了不存在的节点 ${nodeId}`);
        }
      }
    }
    for (const bundle of document.bundles) {
      if (!nodeIds.has(bundle.sourceId)) {
        issues.push(`分支束 ${bundle.id} 的 source 不存在`);
      }
      if (bundle.forkNodeId) {
        const forkNode = document.nodes.find(
          (node) => node.id === bundle.forkNodeId,
        );
        if (!forkNode || forkNode.type !== "fork") {
          issues.push(`分支束 ${bundle.id} 的 forkNodeId 无效`);
        }
      }
      for (const edgeId of bundle.edgeIds) {
        const edge = document.edges.find((item) => item.id === edgeId);
        if (!edge || edge.source !== bundle.sourceId) {
          issues.push(`分支束 ${bundle.id} 包含无效成员边 ${edgeId}`);
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new WorkflowValidationError("工作流文档校验失败", issues);
  }
  return document;
}

