import { PRODUCT } from "../config/product";
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

function graphScale(document: WorkflowDocument): GraphScale {
  const positions = document.nodes
    .map((node) => document.layout.nodes[node.id])
    .filter(Boolean);
  if (positions.length === 0) {
    return { viewBox: "0 0 900 420", width: 900, height: 420 };
  }
  const minX = Math.min(...positions.map((item) => item.x)) - 70;
  const minY = Math.min(...positions.map((item) => item.y)) - 70;
  const maxX = Math.max(...positions.map((item) => item.x + item.width)) + 70;
  const maxY = Math.max(...positions.map((item) => item.y + item.height)) + 70;
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

function edgePoints(
  source: WorkflowDocument["layout"]["nodes"][string],
  target: WorkflowDocument["layout"]["nodes"][string],
): { path: string; labelX: number; labelY: number } {
  const sx = source.x + source.width;
  const sy = source.y + source.height / 2;
  const tx = target.x;
  const ty = target.y + target.height / 2;
  const curve = Math.max(52, Math.abs(tx - sx) * 0.42);
  return {
    path: `M ${sx} ${sy} C ${sx + curve} ${sy}, ${tx - curve} ${ty}, ${tx} ${ty}`,
    labelX: (sx + tx) / 2,
    labelY: (sy + ty) / 2 - 8,
  };
}

function renderGraph(document: WorkflowDocument, compact = false): string {
  const scale = graphScale(document);
  const groupBoxes = document.groups
    .map((group) => {
      const layout = document.layout.groups[group.id];
      return layout
        ? `<g class="pdf-group"><rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="18"/><text x="${layout.x + 18}" y="${layout.y + 28}">${escapeHtml(group.title)}${group.collapsed ? " · 已折叠" : ""}</text></g>`
        : "";
    })
    .join("");
  const edges = document.edges
    .map((edge) => {
      const source = document.layout.nodes[edge.source];
      const target = document.layout.nodes[edge.target];
      if (!source || !target) return "";
      const points = edgePoints(source, target);
      return `<g class="pdf-edge"><path d="${points.path}" marker-end="url(#arrow)"/>${
        edge.label
          ? `<text x="${points.labelX}" y="${points.labelY}" text-anchor="middle">${escapeHtml(edge.label)}</text>`
          : ""
      }</g>`;
    })
    .join("");
  const nodes = document.nodes
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
    ${groupBoxes}${edges}${nodes}
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
    <div class="pdf-overview-frame">${renderGraph(document, true)}</div>
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
      <h2>${escapeHtml(group?.title ?? "流程步骤说明")}</h2>
      <p>${group ? `该分组包含 ${nodes.length} 个节点。以下内容来自可编辑语义模型。` : "不属于任何分组、但仍需完整保留阅读信息的节点。"}</p>
    </div>
    <div class="pdf-detail-list">${nodes.map(nodeDetail).join("")}</div>
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
  const total = Math.max(1, 1 + detailPages.length);
  const pages = [
    renderOverview(document, 1, total),
    ...detailPages.map((detail, index) =>
      renderDetailPage(
        document,
        detail.nodes,
        detail.group,
        index + 2,
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
  .pdf-group text { font-size: 14px; font-weight: 700; fill: #68735f; }
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

