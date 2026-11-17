import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productConfig = JSON.parse(
  await fs.readFile(path.join(root, "product.config.json"), "utf8"),
);
const snapshot = JSON.parse(
  await fs.readFile(path.join(root, "examples/import-snapshot.v1.json"), "utf8"),
);

const safe = (value) =>
  value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._:/-]/g, "-");
const nodeId = (id) => `import:${safe(snapshot.source.id)}:${safe(id)}`;
const groupId = (id) => `import:${safe(snapshot.source.id)}:group:${safe(id)}`;
const importedAt = "2026-11-17T08:31:00.000Z";

const nodes = snapshot.nodes.map((node) => ({
  id: nodeId(node.id),
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

const grouped = new Map();
for (const node of snapshot.nodes) {
  if (node.group) {
    if (!grouped.has(node.group)) grouped.set(node.group, []);
    grouped.get(node.group).push(nodeId(node.id));
  }
}

const groups = (snapshot.groups ?? []).map((group) => ({
  id: groupId(group.id),
  title: group.title,
  collapsed: group.collapsed ?? false,
  color: group.color ?? "sage",
  nodeIds: grouped.get(group.id) ?? [],
  ...(group.parentId ? { parentId: groupId(group.parentId) } : {}),
}));

const level = new Map();
const incoming = new Map(snapshot.nodes.map((node) => [node.id, 0]));
const outgoing = new Map(snapshot.nodes.map((node) => [node.id, []]));
for (const edge of snapshot.edges) {
  incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  outgoing.get(edge.source)?.push(edge.target);
}
const queue = snapshot.nodes
  .filter((node) => incoming.get(node.id) === 0)
  .map((node) => node.id);
queue.forEach((id) => level.set(id, 0));
for (let cursor = 0; cursor < queue.length; cursor += 1) {
  const id = queue[cursor];
  for (const target of outgoing.get(id) ?? []) {
    level.set(target, Math.max(level.get(target) ?? 0, level.get(id) + 1));
    if (!queue.includes(target)) queue.push(target);
  }
}
const columns = new Map();
const nodeLayout = {};
for (const node of snapshot.nodes) {
  const column = level.get(node.id) ?? 0;
  const row = columns.get(column) ?? 0;
  columns.set(column, row + 1);
  nodeLayout[nodeId(node.id)] = {
    x: 140 + column * 310,
    y: 160 + row * 170,
    width: 224,
    height: 106,
  };
}

const groupLayout = {};
for (const group of groups) {
  const positions = group.nodeIds.map((id) => nodeLayout[id]).filter(Boolean);
  const minX = Math.min(...positions.map((item) => item.x));
  const minY = Math.min(...positions.map((item) => item.y));
  const maxX = Math.max(...positions.map((item) => item.x + item.width));
  const maxY = Math.max(...positions.map((item) => item.y + item.height));
  groupLayout[group.id] = {
    x: minX - 36,
    y: minY - 86,
    width: maxX - minX + 72,
    height: maxY - minY + 100,
  };
}

const createdAt = "2026-11-17T08:31:00.000Z";
const document = {
  schemaVersion: 1,
  id: "doc-example-release-pipeline",
  metadata: {
    title: "发布程序 · 版本快照",
    description: snapshot.metadata.description,
    createdAt,
    updatedAt: createdAt,
    author: snapshot.metadata.author,
  },
  provenance: {
    system: snapshot.source.name,
    version: snapshot.version.label,
    commit: snapshot.version.commit,
    importedAt,
    sourceFile: snapshot.source.repository,
  },
  nodes,
  edges: snapshot.edges.map((edge, index) => ({
    id: `import:${safe(snapshot.source.id)}:edge:${edge.id ?? `${edge.source}->${edge.target}:${index}`}`,
    source: nodeId(edge.source),
    target: nodeId(edge.target),
    ...(edge.label ? { label: edge.label } : {}),
    origin: "import",
  })),
  groups,
  layout: {
    nodes: nodeLayout,
    groups: groupLayout,
    viewport: { x: 0, y: 0, zoom: 0.85 },
  },
  display: {
    showDescriptions: true,
    theme: "paper",
  },
};

const documentJson = JSON.stringify(document, null, 2);
function checksumText(value) {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 0x01000193);
    hashB ^= code + index;
    hashB = Math.imul(hashB, 0x85ebca6b);
  }
  return `${(hashA >>> 0).toString(16).padStart(8, "0")}${(hashB >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

const manifest = {
  format: "local-workflow",
  containerVersion: 1,
  documentSchemaVersion: 1,
  product: productConfig.name,
  appVersion: productConfig.appVersion,
  createdAt,
  checksum: checksumText(documentJson),
  files: [
    "manifest.json",
    "document.json",
    "assets/README.txt",
    "preview/README.txt",
  ],
};
const bytes = zipSync(
  {
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    "document.json": strToU8(documentJson),
    "assets/README.txt": strToU8(
      "工作流附件目录。初版保留该入口，文件内容仍由 document.json 引用。\n",
    ),
    "preview/README.txt": strToU8(
      "预览目录。预览是可重建缓存，不是工作流语义的权威来源。\n",
    ),
  },
  { level: 6 },
);
await fs.mkdir(path.join(root, "examples"), { recursive: true });
const outputPath = path.join(
  root,
  "examples",
  `sample-workflow.${productConfig.fileExtension}`,
);
await fs.writeFile(outputPath, bytes);
console.log(
  `Generated ${path.relative(root, outputPath)} (${bytes.length.toLocaleString()} bytes)`,
);

