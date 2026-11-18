import { PRODUCT } from "../config/product";
import { getHiddenNodeIds } from "../core/document";
import { buildWorkflowRouting, type EdgeRoute } from "../core/edgeRouting";
import type {
  WorkflowDocument,
  WorkflowEdge,
  WorkflowGroup,
  WorkflowNode,
} from "../core/types";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(typeof value === "string" ? new Date(value) : value);
}

interface GraphScale {
  viewBox: string;
  width: number;
  height: number;
}

function graphScale(
  document: WorkflowDocument,
  visibleNodeIds: Set<string>,
): GraphScale {
  const positions = document.nodes
    .filter((node) => visibleNodeIds.has(node.id))
    .map((node) => document.layout.nodes[node.id])
    .filter(Boolean);
  const groupBounds = document.groups
    .map((group) => {
      const layout = document.layout.groups[group.id];
      if (!layout) return null;
      return {
        x: layout.x,
        y: layout.y,
        width: group.collapsed ? Math.min(layout.width, 300) : layout.width,
        height: group.collapsed ? 76 : layout.height,
      };
    })
    .filter(Boolean) as Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  if (positions.length === 0 && groupBounds.length === 0) {
    return { viewBox: "0 0 900 420", width: 900, height: 420 };
  }
  const minX =
    Math.min(
      ...positions.map((item) => item.x),
      ...groupBounds.map((item) => item.x),
    ) - 70;
  const minY =
    Math.min(
      ...positions.map((item) => item.y),
      ...groupBounds.map((item) => item.y),
    ) - 70;
  const maxX =
    Math.max(
      ...positions.map((item) => item.x + item.width),
      ...groupBounds.map((item) => item.x + item.width),
    ) + 70;
  const maxY =
    Math.max(
      ...positions.map((item) => item.y + item.height),
      ...groupBounds.map((item) => item.y + item.height),
    ) + 70;
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    viewBox: `${minX} ${minY} ${width} ${height}`,
    width,
    height,
  };
}

function wrapSvgText(value: string, max = 16): string[] {
  const characters = Array.from(value);
  const lines: string[] = [];
  let current = "";
  for (const character of characters) {
    if (current.length >= max) {
      lines.push(current);
      current = "";
    }
    current += character;
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function renderGraph(document: WorkflowDocument, compact = false): string {
  const hidden = getHiddenNodeIds(document);
  const visibleNodeIds = new Set(
    document.nodes
      .filter((node) => !hidden.has(node.id))
      .map((node) => node.id),
  );
  const scale = graphScale(document, visibleNodeIds);
  const routing = buildWorkflowRouting(document, visibleNodeIds);
  const groupBoxes = document.groups
    .map((group) => {
      const layout = document.layout.groups[group.id];
      if (!layout) return "";
      const width = group.collapsed
        ? Math.min(layout.width, 300)
        : layout.width;
      const height = group.collapsed
        ? 76
        : layout.height;
      return `<g class="pdf-group ${group.collapsed ? "is-collapsed" : ""}"><rect x="${layout.x}" y="${layout.y}" width="${width}" height="${height}" rx="18"/></g>`;
    })
    .join("");
  const groupLabels = document.groups
    .map((group) => {
      const layout = document.layout.groups[group.id];
      if (!layout) return "";
      return `<text class="pdf-group-label" x="${layout.x + 18}" y="${layout.y + 28}">${escapeHtml(group.title)}${group.collapsed ? ` · 已折叠（${group.nodeIds.length} 个节点）` : ""}</text>`;
    })
    .join("");
  const edgeById = new Map(document.edges.map((edge) => [edge.id, edge]));
  const routesBySource = new Map<string, EdgeRoute[]>();
  for (const route of Object.values(routing.routes)) {
    const routeKey = `${route.sourceId}:${route.side}`;
    const routes = routesBySource.get(routeKey) ?? [];
    routes.push(route);
    routesBySource.set(routeKey, routes);
  }
  const edges = [...routesBySource.values()]
    .map((routes) => {
      const trunk = routes[0]?.trunkPath ?? "";
      const arms = routes
        .map((route) => {
          const edge = edgeById.get(route.edgeId);
          const label = edge?.label ?? "";
          return `<g class="pdf-edge"><path d="${route.armPath}" marker-end="url(#arrow)"/>${
            label
              ? `<text x="${route.labelPoint.x}" y="${route.labelPoint.y}" text-anchor="middle">${escapeHtml(label)}</text>`
              : ""
          }</g>`;
        })
        .join("");
      return `<path class="pdf-edge-trunk" d="${trunk}" marker-end="none"/>${arms}`;
    })
    .join("");
  const nodes = document.nodes
    .filter((node) => visibleNodeIds.has(node.id))
    .map((node) => {
      const layout = document.layout.nodes[node.id];
      if (!layout) return "";
      const titleLines = wrapSvgText(node.title, compact ? 13 : 16);
      return `<g class="pdf-node pdf-node--${node.type}"><rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="12"/>${titleLines
        .map(
          (line, index) =>
            `<text class="pdf-node-title" x="${layout.x + 16}" y="${layout.y + 30 + index * 20}">${escapeHtml(line)}</text>`,
        )
        .join("")}<text class="pdf-node-type" x="${layout.x + layout.width - 16}" y="${layout.y + layout.height - 14}" text-anchor="end">${escapeHtml(node.type)}</text></g>`;
    })
    .join("");
  return `<svg class="pdf-graph" viewBox="${scale.viewBox}" role="img" aria-label="工作流总览图">
    <defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#8b8173"/></marker></defs>
    ${groupBoxes}${edges}${nodes}${groupLabels}
  </svg>`;
}

function renderLegend(): string {
  return `<div class="pdf-legend">
    <span><i class="legend-line"></i> 有向关系</span>
    <span><i class="legend-box legend-start"></i> 开始 / 结束</span>
    <span><i class="legend-box legend-task"></i> 步骤</span>
    <span><i class="legend-box legend-decision"></i> 判断</span>
    <span><i class="legend-box legend-import"></i> 程序导入</span>
  </div>`;
}

function pageHeader(document: WorkflowDocument, label: string): string {
  return `<header class="pdf-page-header"><div class="pdf-brand">${PRODUCT.name}</div><div>${escapeHtml(label)}</div></header>`;
}

function renderOverview(document: WorkflowDocument, page: number, total: number): string {
  const generatedAt = new Date();
  const hidden = getHiddenNodeIds(document);
  const visibleCount = document.nodes.length - hidden.size;
  const bounds = graphScale(
    document,
    new Set(
      document.nodes
        .filter((node) => !hidden.has(node.id))
        .map((node) => node.id),
    ),
  );
  const useGroupMap =
    visibleCount > 16 || bounds.width > 2200 || bounds.height > 1500;
  return `<section class="print-page print-page--overview">
    ${pageHeader(document, "工作流总览")}
    <div class="pdf-title-block">
      <div class="pdf-kicker">WORKFLOW DOCUMENT</div>
      <h1>${escapeHtml(document.metadata.title)}</h1>
      <p>${escapeHtml(document.metadata.description || "未填写文档说明")}</p>
      <div class="pdf-meta">
        <span>版本 <strong>${escapeHtml(document.provenance.version ?? "手工编辑")}</strong></span>
        <span>来源 <strong>${escapeHtml(document.provenance.system ?? "本地创建")}</strong></span>
        ${document.provenance.commit ? `<span>提交 <strong>${escapeHtml(document.provenance.commit)}</strong></span>` : ""}
        <span>最后更新 <strong>${formatDate(document.metadata.updatedAt)}</strong></span>
        <span>生成时间 <strong>${formatDate(generatedAt)}</strong></span>
      </div>
    </div>
    <div class="pdf-overview-frame">${
      useGroupMap ? renderGroupMap(document) : renderGraph(document, true)
    }</div>
    <div class="pdf-summary-strip">
      <span><strong>${document.nodes.length}</strong> 节点</span>
      <span><strong>${document.edges.length}</strong> 关系</span>
      <span><strong>${document.groups.length}</strong> 分组</span>
      <span><strong>${document.nodes.filter((node) => node.origin.kind === "import").length}</strong> 导入节点</span>
    </div>
    ${renderLegend()}
    <footer class="pdf-footer"><span>${PRODUCT.name} · 仅作为阅读输出</span><span>第 ${page} / ${total} 页</span></footer>
  </section>`;
}

function paginateNodes(
  nodes: WorkflowNode[],
  maxPerPage = 5,
): WorkflowNode[][] {
  const pages: WorkflowNode[][] = [];
  for (let index = 0; index < nodes.length; index += maxPerPage) {
    pages.push(nodes.slice(index, index + maxPerPage));
  }
  return pages.length > 0 ? pages : [[]];
}

function nodeDetail(node: WorkflowNode): string {
  return `<article class="pdf-node-detail">
    <div class="pdf-detail-head">
      <span class="pdf-kind">${escapeHtml(node.type)}</span>
      <span>${node.origin.kind === "import" ? `导入自 ${escapeHtml(node.origin.system)} · ${escapeHtml(node.origin.version)}` : "手工节点"}</span>
    </div>
    <h3>${escapeHtml(node.title)}</h3>
    <p>${escapeHtml(node.description || "（暂无描述）")}</p>
    ${node.tags.length > 0 ? `<div class="pdf-tags">${node.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
    ${node.source?.file ? `<div class="pdf-source">${escapeHtml(node.source.file)}${node.source.symbol ? ` · ${escapeHtml(node.source.symbol)}` : ""}</div>` : ""}
  </article>`;
}

function detailLabel(group?: WorkflowGroup): string {
  return group ? `分组详情 · ${group.title}` : "分支与未分组节点";
}

function renderDetailPage(
  document: WorkflowDocument,
  nodes: WorkflowNode[],
  group: WorkflowGroup | undefined,
  page: number,
  total: number,
  part: number,
  parts: number,
): string {
  return `<section class="print-page print-page--details">
    ${pageHeader(document, detailLabel(group))}
    <div class="pdf-detail-title">
      <div class="pdf-kicker">DETAIL ${part} / ${parts}</div>
      <h2>${escapeHtml(group?.title ?? "流程步骤说明")}${
        group?.collapsed ? " · 已折叠" : ""
      }</h2>
      <p>${group ? `该分组包含 ${nodes.length} 个节点${group.collapsed ? "，当前在画布中处于折叠状态" : ""}。以下内容来自可编辑语义模型。` : "不属于任何分组、但仍需完整保留阅读信息的节点。"}</p>
    </div>
    <div class="pdf-detail-list">${nodes.map(nodeDetail).join("")}</div>
    <footer class="pdf-footer"><span>${escapeHtml(document.metadata.title)}</span><span>第 ${page} / ${total} 页</span></footer>
  </section>`;
}

function renderGroupMap(document: WorkflowDocument): string {
  const cards = document.groups.map((group) => {
    const memberCount =
      group.nodeIds.length +
      document.groups
        .filter((child) => child.parentId === group.id)
        .reduce((sum, child) => sum + child.nodeIds.length, 0);
    return `<article class="pdf-group-map-card">
      <strong>${escapeHtml(group.title)}</strong>
      <span>${memberCount} 个节点 · ${group.collapsed ? "已折叠" : "展开"}</span>
    </article>`;
  });
  const grouped = new Set(document.groups.flatMap((group) => group.nodeIds));
  const ungroupedCount = document.nodes.filter(
    (node) => !grouped.has(node.id),
  ).length;
  if (ungroupedCount > 0) {
    cards.push(`<article class="pdf-group-map-card">
      <strong>未分组节点</strong><span>${ungroupedCount} 个节点</span>
    </article>`);
  }
  return `<div class="pdf-group-map">
    <p>画布较大，总览页按分组提供阅读索引；完整节点与条件在后续详情页分页呈现。</p>
    <div class="pdf-group-map-grid">${cards.join("")}</div>
  </div>`;
}

interface BranchPageSection {
  source: WorkflowNode;
  edges: WorkflowEdge[];
  part: number;
  parts: number;
}

function branchPageSections(document: WorkflowDocument): BranchPageSection[] {
  const sections: BranchPageSection[] = [];
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  for (const source of document.nodes) {
    const edges = document.edges.filter((edge) => edge.source === source.id);
    if (edges.length < 2) continue;
    const chunks = Array.from(
      { length: Math.ceil(edges.length / 7) },
      (_, index) => edges.slice(index * 7, index * 7 + 7),
    );
    chunks.forEach((chunk, index) => {
      sections.push({
        source: nodeById.get(source.id) ?? source,
        edges: chunk,
        part: index + 1,
        parts: chunks.length,
      });
    });
  }
  return sections;
}

function renderBranchPage(
  document: WorkflowDocument,
  section: BranchPageSection,
  page: number,
  total: number,
): string {
  const nodeTitle = (id: string) =>
    document.nodes.find((node) => node.id === id)?.title ?? id;
  const hidden = getHiddenNodeIds(document);
  return `<section class="print-page print-page--branches">
    ${pageHeader(document, "分支条件")}
    <div class="pdf-detail-title">
      <div class="pdf-kicker">BRANCH ${section.part} / ${section.parts}</div>
      <h2>${escapeHtml(section.source.title)} · 出口条件</h2>
      <p>该源节点共有 ${document.edges.filter((edge) => edge.source === section.source.id).length} 条出边。所有分支从同一计算分叉点出发。</p>
    </div>
    <table class="pdf-branch-table">
      <thead><tr><th>目标节点</th><th>方向</th><th>条件 / 标签</th><th>状态</th></tr></thead>
      <tbody>
        ${section.edges
          .map(
            (edge) => `<tr>
              <td>${escapeHtml(nodeTitle(edge.target))}</td>
              <td>${escapeHtml(section.source.title)} → ${escapeHtml(nodeTitle(edge.target))}</td>
              <td>${escapeHtml(edge.label || "未填写条件")}</td>
              <td>${hidden.has(edge.target) ? "目标节点已折叠" : "可见"}</td>
            </tr>`,
          )
          .join("")}
      </tbody>
    </table>
    <footer class="pdf-footer"><span>${escapeHtml(document.metadata.title)}</span><span>第 ${page} / ${total} 页</span></footer>
  </section>`;
}

export function createPrintHtml(document: WorkflowDocument): string {
  const groupedNodeIds = new Set(
    document.groups.flatMap((group) => group.nodeIds),
  );
  const ungrouped = document.nodes.filter((node) => !groupedNodeIds.has(node.id));
  const sections: Array<{ group?: WorkflowGroup; nodes: WorkflowNode[] }> = [
    ...document.groups.map((group) => ({
      group,
      nodes: document.nodes.filter((node) => group.nodeIds.includes(node.id)),
    })),
    ...(ungrouped.length > 0 ? [{ group: undefined, nodes: ungrouped }] : []),
  ].filter((section) => section.nodes.length > 0 || section.group);

  const detailPages: Array<{
    group?: WorkflowGroup;
    nodes: WorkflowNode[];
    part: number;
    parts: number;
  }> = [];
  for (const section of sections) {
    const pages = paginateNodes(section.nodes, 5);
    pages.forEach((nodes, index) => {
      detailPages.push({
        ...section,
        nodes,
        part: index + 1,
        parts: pages.length,
      });
    });
  }
  const branchPages = branchPageSections(document);
  const total = Math.max(1, 1 + branchPages.length + detailPages.length);
  const pages = [
    renderOverview(document, 1, total),
    ...branchPages.map((section, index) =>
      renderBranchPage(document, section, index + 2, total),
    ),
    ...detailPages.map((detail, index) =>
      renderDetailPage(
        document,
        detail.nodes,
        detail.group,
        index + 2 + branchPages.length,
        total,
        detail.part,
        detail.parts,
      ),
    ),
  ];

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(document.metadata.title)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #eeeae2; color: #2d2a25; font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .print-page { width: 210mm; height: 297mm; padding: 15mm 16mm 13mm; background: #fbfaf6; margin: 0 auto 10mm; position: relative; page-break-after: always; overflow: hidden; display: flex; flex-direction: column; }
  .print-page:last-child { page-break-after: auto; }
  .pdf-page-header { display: flex; justify-content: space-between; align-items: center; color: #82796b; font-size: 10px; letter-spacing: .08em; border-bottom: 1px solid #dcd6cb; padding-bottom: 8px; }
  .pdf-brand { font-weight: 700; color: #3e3a33; letter-spacing: .12em; }
  .pdf-title-block { padding: 24px 0 17px; }
  .pdf-kicker { font-size: 9px; font-weight: 700; letter-spacing: .16em; color: #85806e; margin-bottom: 9px; }
  .pdf-title-block h1 { font-family: "STSong", "Songti SC", "Microsoft YaHei", serif; font-size: 30px; line-height: 1.2; margin: 0 0 10px; font-weight: 650; letter-spacing: -.02em; }
  .pdf-title-block > p { margin: 0; color: #625d54; font-size: 12px; line-height: 1.65; max-width: 165mm; }
  .pdf-meta { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 14px; font-size: 9px; color: #8a8275; }
  .pdf-meta strong { color: #4c463d; font-weight: 600; }
  .pdf-overview-frame { flex: 1; min-height: 0; border: 1px solid #ddd7cc; border-radius: 16px; padding: 14px; background-color: #f8f6f0; background-image: radial-gradient(#d8d2c7 .7px, transparent .7px); background-size: 16px 16px; display: flex; align-items: center; justify-content: center; }
  .pdf-graph { width: 100%; height: 100%; max-height: 152mm; overflow: visible; }
  .pdf-group rect { fill: rgba(222, 230, 216, .34); stroke: #b8c7ad; stroke-width: 1.5; }
  .pdf-group.is-collapsed rect { fill: rgba(238, 231, 218, .72); stroke: #c4b18f; stroke-dasharray: 6 4; }
  .pdf-group-label { font-size: 14px; font-weight: 700; fill: #68735f; paint-order: stroke; stroke: #f8f6f0; stroke-width: 5px; stroke-linejoin: round; }
  .pdf-edge-trunk { fill: none; stroke: #8b8173; stroke-width: 1.7; }
  .pdf-edge path { fill: none; stroke: #8b8173; stroke-width: 1.7; }
  .pdf-edge text { font-size: 11px; fill: #685f52; paint-order: stroke; stroke: #f8f6f0; stroke-width: 4px; }
  .pdf-node rect { fill: #fffefa; stroke: #bdb5a7; stroke-width: 1.3; }
  .pdf-node--start rect, .pdf-node--end rect { fill: #e4ebdf; stroke: #8da27d; }
  .pdf-node--decision rect { fill: #f1e7d8; stroke: #b79b75; }
  .pdf-node-title { font-size: 14px; fill: #302c27; font-weight: 650; }
  .pdf-node-type { font-size: 9px; fill: #928777; letter-spacing: .08em; }
  .pdf-summary-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-top: 12px; }
  .pdf-summary-strip span { background: #f1eee6; border-radius: 7px; padding: 8px 10px; color: #776f62; font-size: 9px; }
  .pdf-summary-strip strong { color: #34302a; font-size: 14px; margin-right: 4px; }
  .pdf-group-map { width: 100%; }
  .pdf-group-map > p { margin: 0 0 12px; color: #756e62; font-size: 10px; line-height: 1.6; }
  .pdf-group-map-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .pdf-group-map-card { padding: 12px; border: 1px solid #d7d0c4; border-radius: 9px; background: #fffefa; }
  .pdf-group-map-card strong { display: block; margin-bottom: 5px; font-size: 12px; }
  .pdf-group-map-card span { color: #81796c; font-size: 9px; }
  .pdf-legend { display: flex; flex-wrap: wrap; gap: 12px 22px; align-items: center; margin: 10px 2px 0; color: #71695d; font-size: 8.5px; }
  .pdf-legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend-line { width: 20px; height: 1px; background: #8b8173; position: relative; }
  .legend-line::after { content: ""; position: absolute; right: -1px; top: -2px; border-left: 4px solid #8b8173; border-top: 2.5px solid transparent; border-bottom: 2.5px solid transparent; }
  .legend-box { width: 12px; height: 9px; border-radius: 2px; border: 1px solid #bdb5a7; background: #fffefa; }
  .legend-start { background: #e4ebdf; border-color: #8da27d; }
  .legend-task { background: #fffefa; }
  .legend-decision { background: #f1e7d8; border-color: #b79b75; }
  .legend-import { border-left: 3px solid #738968; }
  .pdf-footer { margin-top: auto; padding-top: 10px; border-top: 1px solid #e3ded5; display: flex; justify-content: space-between; font-size: 8.5px; color: #948b7e; }
  .pdf-detail-title { padding: 21px 0 15px; }
  .pdf-detail-title h2 { margin: 0 0 7px; font-size: 23px; }
  .pdf-detail-title p { margin: 0; color: #756e62; font-size: 10px; }
  .pdf-detail-list { display: flex; flex-direction: column; gap: 9px; flex: 1; }
  .pdf-branch-table { width: 100%; border-collapse: collapse; }
  .pdf-branch-table th { padding: 7px 8px; border-bottom: 1px solid #cabfae; color: #756d60; font-size: 8px; text-align: left; }
  .pdf-branch-table td { padding: 8px; border-bottom: 1px solid #e5dfd5; color: #4f493f; font-size: 9px; line-height: 1.45; }
  .pdf-node-detail { border: 1px solid #ddd7cc; border-radius: 10px; padding: 10px 13px; background: #fffefa; page-break-inside: avoid; }
  .pdf-detail-head { display: flex; justify-content: space-between; gap: 12px; color: #8b8276; font-size: 8px; }
  .pdf-kind { text-transform: uppercase; letter-spacing: .08em; font-weight: 700; color: #5e7055; }
  .pdf-node-detail h3 { margin: 5px 0; font-size: 13px; }
  .pdf-node-detail p { margin: 0; color: #5e584f; font-size: 9.5px; line-height: 1.55; white-space: pre-wrap; }
  .pdf-tags { display: flex; gap: 5px; margin-top: 6px; flex-wrap: wrap; }
  .pdf-tags span { background: #eef1e8; border-radius: 10px; padding: 2px 7px; color: #65735c; font-size: 7.5px; }
  .pdf-source { margin-top: 6px; color: #8d857a; font-family: Consolas, monospace; font-size: 7.5px; }
  @media print {
    html, body { background: #fff; }
    .print-page { margin: 0; break-after: page; }
    .print-page:last-child { break-after: auto; }
  }
</style>
</head>
<body>${pages.join("")}</body>
</html>`;
}

