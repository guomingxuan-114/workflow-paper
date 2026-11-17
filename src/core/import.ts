import { stableImportId } from "./id";
import {
  createDocument,
  GROUP_PADDING,
  NODE_HEIGHT,
  NODE_WIDTH,
  WorkflowValidationError,
} from "./document";
import type {
  ImportSnapshotV1,
  NodeKind,
  WorkflowDocument,
  WorkflowGroup,
  WorkflowNode,
} from "./types";

const importNodeTypes: NodeKind[] = [
  "start",
  "task",
  "decision",
  "milestone",
  "end",
  "note",
];

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateImportSnapshot(input: unknown): ImportSnapshotV1 {
  const issues: string[] = [];
  if (!object(input)) {
    throw new WorkflowValidationError("导入内容必须是 JSON 对象");
  }
  if (input.format !== "workflow-import") {
    issues.push('format 必须为 "workflow-import"');
  }
  if (input.schemaVersion !== 1) {
    issues.push(`仅支持导入协议 schemaVersion 1，收到 ${String(input.schemaVersion)}`);
  }
  if (!object(input.version) || typeof input.version.label !== "string") {
    issues.push("version.label 必须存在");
  }
  if (!object(input.source) || typeof input.source.id !== "string") {
    issues.push("source.id 必须存在");
  }
  if (!object(input.source) || typeof input.source.name !== "string") {
    issues.push("source.name 必须存在");
  }
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) {
    issues.push("nodes 必须是非空数组");
  }
  if (!Array.isArray(input.edges)) {
    issues.push("edges 必须是数组");
  }

  if (issues.length === 0) {
    const ids = new Set<string>();
    for (const raw of input.nodes as unknown[]) {
      if (!object(raw) || typeof raw.id !== "string" || !raw.id.trim()) {
        issues.push("每个节点都必须有非空字符串 id");
        continue;
      }
      if (ids.has(raw.id)) issues.push(`节点 id 重复：${raw.id}`);
      ids.add(raw.id);
      if (typeof raw.title !== "string" || !raw.title.trim()) {
        issues.push(`节点 ${raw.id} 缺少 title`);
      }
      if (raw.type !== undefined && !importNodeTypes.includes(raw.type as NodeKind)) {
        issues.push(`节点 ${raw.id} 的 type 不受支持：${String(raw.type)}`);
      }
      if (raw.tags !== undefined && !Array.isArray(raw.tags)) {
        issues.push(`节点 ${raw.id} 的 tags 必须是数组`);
      }
    }
    for (const raw of input.edges as unknown[]) {
      if (!object(raw)) {
        issues.push("边必须是对象");
        continue;
      }
      if (
        typeof raw.source !== "string" ||
        typeof raw.target !== "string" ||
        !ids.has(raw.source) ||
        !ids.has(raw.target)
      ) {
        issues.push(`关系引用了不存在的 source/target`);
      }
    }
    const groupIds = new Set<string>();
    for (const raw of (input.groups ?? []) as unknown[]) {
      if (!object(raw) || typeof raw.id !== "string" || !raw.id.trim()) {
        issues.push("每个分组都必须有非空字符串 id");
        continue;
      }
      if (groupIds.has(raw.id)) issues.push(`分组 id 重复：${raw.id}`);
      groupIds.add(raw.id);
    }
    for (const raw of input.nodes as Array<Record<string, unknown>>) {
      if (
        raw.group !== undefined &&
        (typeof raw.group !== "string" || !groupIds.has(raw.group))
      ) {
        issues.push(`节点 ${String(raw.id)} 引用了不存在的 group`);
      }
    }
  }

  if (issues.length > 0) {
    throw new WorkflowValidationError("导入快照校验失败", issues);
  }
  return input as unknown as ImportSnapshotV1;
}

function layoutPositions(snapshot: ImportSnapshotV1) {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  snapshot.nodes.forEach((node) => {
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
  });
  snapshot.edges.forEach((edge) => {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  });

  const level = new Map<string, number>();
  const queue = snapshot.nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  queue.forEach((id) => level.set(id, 0));
  if (queue.length === 0) {
    snapshot.nodes.slice(0, 1).forEach((node) => {
      queue.push(node.id);
      level.set(node.id, 0);
    });
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    const current = level.get(id) ?? 0;
    for (const target of outgoing.get(id) ?? []) {
      const next = Math.max(level.get(target) ?? 0, current + 1);
      level.set(target, next);
      if (!queue.includes(target)) queue.push(target);
    }
  }
  snapshot.nodes.forEach((node) => {
    if (!level.has(node.id)) level.set(node.id, 0);
  });

  const columns = new Map<number, number>();
  const result = new Map<string, { x: number; y: number }>();
  for (const node of snapshot.nodes) {
    const column = level.get(node.id) ?? 0;
    const row = columns.get(column) ?? 0;
    columns.set(column, row + 1);
    result.set(node.id, { x: 140 + column * 310, y: 160 + row * 170 });
  }
  return result;
}

export function importSnapshot(input: unknown): WorkflowDocument {
  const snapshot = validateImportSnapshot(input);
  const importedAt = new Date().toISOString();
  const document = createDocument(
    snapshot.metadata?.title ?? `${snapshot.source.name} · ${snapshot.version.label}`,
  );
  const groupIdMap = new Map<string, string>();
  for (const group of snapshot.groups ?? []) {
    groupIdMap.set(group.id, stableImportId(snapshot.source.id, `group:${group.id}`));
  }

  const nodes: WorkflowNode[] = snapshot.nodes.map((node) => ({
    id: stableImportId(snapshot.source.id, node.id),
    title: node.title,
    description: node.description ?? "",
    type: node.type ?? "task",
    tags: node.tags ?? [],
    origin: {
      kind: "import",
      system: snapshot.source.name,
      version: snapshot.version.label,
      ...(snapshot.version.commit ? { commit: snapshot.version.commit } : {}),
      originalId: node.id,
      importedAt,
    },
    ...(node.source ? { source: node.source } : {}),
  }));
  const nodeIdMap = new Map(
    snapshot.nodes.map((node) => [
      node.id,
      stableImportId(snapshot.source.id, node.id),
    ]),
  );
  const nodeGroups = new Map<string, string>();
  for (const node of snapshot.nodes) {
    if (node.group) {
      const groupId = groupIdMap.get(node.group);
      if (groupId) nodeGroups.set(nodeIdMap.get(node.id)!, groupId);
    }
  }

  const groups: WorkflowGroup[] = (snapshot.groups ?? []).map((group) => ({
    id: groupIdMap.get(group.id)!,
    title: group.title,
    collapsed: group.collapsed ?? false,
    color: group.color ?? "sage",
    nodeIds: [],
    ...(group.parentId && groupIdMap.get(group.parentId)
      ? { parentId: groupIdMap.get(group.parentId)! }
      : {}),
  }));
  for (const group of groups) {
    group.nodeIds = [...nodeGroups.entries()]
      .filter(([, groupId]) => groupId === group.id)
      .map(([nodeId]) => nodeId);
  }

  const positions = layoutPositions(snapshot);
  const nodeLayout = Object.fromEntries(
    nodes.map((node) => {
      const originalId = (node.origin as { originalId: string }).originalId;
      const position = positions.get(originalId) ?? { x: 100, y: 100 };
      return [
        node.id,
        { ...position, width: NODE_WIDTH, height: NODE_HEIGHT },
      ];
    }),
  );

  const groupLayout: WorkflowDocument["layout"]["groups"] = {};
  for (const group of groups) {
    const members = group.nodeIds
      .map((id) => nodeLayout[id])
      .filter(Boolean) as Array<{ x: number; y: number; width: number; height: number }>;
    if (members.length === 0) {
      groupLayout[group.id] = {
        x: 80,
        y: 80,
        width: 280,
        height: 180,
      };
      continue;
    }
    const minX = Math.min(...members.map((item) => item.x));
    const minY = Math.min(...members.map((item) => item.y)) - 50;
    const maxX = Math.max(...members.map((item) => item.x + item.width));
    const maxY = Math.max(...members.map((item) => item.y + item.height));
    groupLayout[group.id] = {
      x: minX - GROUP_PADDING,
      y: minY - GROUP_PADDING,
      width: maxX - minX + GROUP_PADDING * 2,
      height: maxY - minY + GROUP_PADDING * 1.6,
    };
  }

  return {
    ...document,
    metadata: {
      ...document.metadata,
      description: snapshot.metadata?.description ?? "",
      ...(snapshot.metadata?.author
        ? { author: snapshot.metadata.author }
        : {}),
    },
    provenance: {
      system: snapshot.source.name,
      version: snapshot.version.label,
      ...(snapshot.version.commit ? { commit: snapshot.version.commit } : {}),
      importedAt,
      ...(snapshot.source.repository
        ? { sourceFile: snapshot.source.repository }
        : {}),
    },
    nodes,
    edges: snapshot.edges.map((edge, index) => ({
      id: stableImportId(
        snapshot.source.id,
        `edge:${edge.id ?? `${edge.source}->${edge.target}:${index}`}`,
      ),
      source: nodeIdMap.get(edge.source)!,
      target: nodeIdMap.get(edge.target)!,
      ...(edge.label ? { label: edge.label } : {}),
      origin: "import",
    })),
    groups,
    layout: {
      nodes: nodeLayout,
      groups: groupLayout,
      viewport: { x: 0, y: 0, zoom: 0.85 },
    },
  };
}

