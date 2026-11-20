import { PRODUCT } from "../config/product";
import { getHiddenNodeIds } from "../core/document";
import { buildWorkflowRouting, type EdgeRoute } from "../core/edgeRouting";
import { nodeBoundaryPath, nodeMetrics } from "../core/nodeShapes";
import { mixHex, PALETTES } from "../core/palettes";
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
  const palette = PALETTES[document.display.palette] ?? PALETTES.default;
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
      return `<g class="pdf-group ${group.collapsed ? "is-collapsed" : ""} ${
        group.important ? "is-important" : ""
      }"><rect x="${layout.x}" y="${layout.y}" width="${width}" height="${height}" rx="34"/></g>`;
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
  const routeGroups = new Map<string, EdgeRoute[]>();
  for (const route of Object.values(routing.routes)) {
    const routeKey = route.bundleId ? `bundle:${route.bundleId}` : `edge:${route.edgeId}`;
    const routes = routeGroups.get(routeKey) ?? [];
    routes.push(route);
    routeGroups.set(routeKey, routes);
  }
  const edges = [...routeGroups.values()]
    .map((routes) => {
      const trunk =
        routes.length > 1 ? routes[0]?.trunkPath ?? "" : "";
      const branch = routes[0]?.bundleId
        ? routing.branches[routes[0].bundleId]
        : undefined;
      const arms = routes
        .map((route) => {
          const edge = edgeById.get(route.edgeId);
          const label = edge?.label ?? "";
          const noteEdge =
            document.nodes.find((node) => node.id === route.sourceId)?.type ===
              "note" ||
            document.nodes.find((node) => node.id === route.targetId)?.type ===
              "note";
          const pathData =
            routes.length > 1
              ? `M ${route.forkPoint.x} ${route.forkPoint.y} ${route.armPath}`
              : route.path;
          return `<g class="pdf-edge ${
            route.bundleId ? "is-bundle-arm" : ""
          } ${route.important ? "is-important" : ""} ${
            noteEdge ? "is-note-edge" : ""
          }"><path d="${pathData}" ${
            noteEdge
              ? ""
              : route.important
                ? 'marker-end="url(#arrow-important)"'
                : route.bundleId
                  ? 'marker-end="url(#arrow-branch)"'
                  : 'marker-end="url(#arrow)"'
          }/>${
            label
              ? `<text x="${route.labelPoint.x}" y="${route.labelPoint.y}" text-anchor="middle">${escapeHtml(label)}</text>`
              : ""
          }</g>`;
        })
        .join("");
      return `${trunk ? `<path class="pdf-edge-trunk" d="${trunk}" marker-end="none"/>` : ""}${
        branch?.visible && branch.label
          ? `<g class="pdf-bundle-label"><rect x="${branch.labelPoint.x - 20}" y="${branch.labelPoint.y - 9}" width="40" height="18" rx="9"/><text x="${branch.labelPoint.x}" y="${branch.labelPoint.y + 3}" text-anchor="middle">${escapeHtml(branch.label)}</text></g>`
          : ""
      }${arms}`;
    })
    .join("");
  const outgoingCounts = new Map<string, number>();
  for (const edge of document.edges) {
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) ?? 0) + 1);
  }
  const nodes = document.nodes
    .filter((node) => visibleNodeIds.has(node.id))
    .map((node) => {
      const layout = document.layout.nodes[node.id];
      if (!layout) return "";
      const metrics = nodeMetrics(node);
      const baseFill =
        node.type === "start"
          ? palette.colors.start
          : node.type === "end"
            ? palette.colors.end
            : node.type === "decision"
              ? palette.colors.decision
              : node.type === "fork"
                ? palette.colors.bundle
              : node.type === "note"
                ? palette.colors.note
                : palette.colors.node;
      const emphasisFill = node.important
        ? mixHex(baseFill, palette.colors.important, 0.2)
        : node.milestone
          ? mixHex(baseFill, palette.colors.milestone, 0.16)
          : baseFill;
      const outgoingCount = outgoingCounts.get(node.id) ?? 0;
      const displayTitle =
        node.type === "fork" && !node.title.trim()
          ? String(outgoingCount)
          : node.title;
      const titleLines = wrapSvgText(displayTitle, compact ? 13 : 16);
      const boundary = nodeBoundaryPath(node, layout.width, layout.height);
      const textCenterX = layout.x + layout.width / 2;
      const titleCenterX =
        node.type === "fork" && node.title.trim()
          ? textCenterX - 9
          : textCenterX;
      const textTop =
        layout.y +
        layout.height / 2 -
        ((titleLines.length - 1) * 18) / 2 +
        5;
      const centered = metrics.shape === "ellipse" || metrics.shape === "capsule";
      const forkCount =
        node.type === "fork" && node.title.trim()
          ? `<g class="pdf-fork-count"><circle cx="${layout.x + layout.width - 32}" cy="${layout.y + layout.height / 2}" r="9"/><text x="${layout.x + layout.width - 32}" y="${layout.y + layout.height / 2 + 3}" text-anchor="middle">${outgoingCount}</text></g>`
          : "";
      return `<g class="pdf-node pdf-node--${node.type} pdf-node--shape-${metrics.shape} ${
        node.important ? "is-important" : ""
      } ${node.milestone ? "is-milestone" : ""}"><path d="${boundary}" style="fill:${emphasisFill}" transform="translate(${layout.x} ${layout.y})"/>${titleLines
        .map(
          (line, index) =>
            `<text class="pdf-node-title" x="${
              centered ? titleCenterX : layout.x + metrics.textInsetX
            }" y="${textTop + index * 18}" ${
              centered ? 'text-anchor="middle"' : ""
            }>${escapeHtml(line)}</text>`,
        )
        .join("")}${
          node.milestone
            ? `<text class="pdf-node-milestone" x="${
                centered ? textCenterX : layout.x + metrics.textInsetX
              }" y="${layout.y + layout.height - 14}" ${
                centered ? 'text-anchor="middle"' : ""
              }>◆ ${escapeHtml(node.milestone.label || "里程碑")}</text>`
            : ""
        }${forkCount}</g>`;
    })
    .join("");
  return `<svg class="pdf-graph" viewBox="${scale.viewBox}" role="img" aria-label="工作流总览图">
    <defs>
      <marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="${palette.colors.edge}"/></marker>
      <marker id="arrow-branch" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="${palette.colors.branch}"/></marker>
      <marker id="arrow-important" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="${palette.colors.important}"/></marker>
    </defs>
    ${groupBoxes}${edges}${nodes}${groupLabels}
  </svg>`;
}

function renderLegend(): string {
  return `<div class="pdf-legend">
    <span><i class="legend-line"></i> 有向关系</span>
    <span><i class="legend-box legend-start"></i> 开始 / 结束</span>
    <span><i class="legend-box legend-task"></i> 节点</span>
    <span><i class="legend-box legend-decision"></i> 判断</span>
    <span><i class="legend-box legend-fork"></i> 分叉点</span>
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
  const displayType =
    node.type === "task"
      ? "节点"
      : node.type === "fork"
        ? "分叉点"
        : node.type;
  return `<article class="pdf-node-detail">
    <div class="pdf-detail-head">
      <span class="pdf-kind">${escapeHtml(displayType)}</span>
      <span>${node.origin.kind === "import" ? `导入自 ${escapeHtml(node.origin.system)} · ${escapeHtml(node.origin.version)}` : "手工节点"}</span>
    </div>
    <h3>${escapeHtml(node.title)}</h3>
    <p>${escapeHtml(node.description || "（暂无描述）")}</p>
    ${
      node.milestone || node.important
        ? `<div class="pdf-detail-flags">${
            node.milestone
              ? `<span>◆ ${escapeHtml(node.milestone.label || "里程碑")}</span>`
              : ""
          }${node.important ? "<span>★ 重要</span>" : ""}</div>`
        : ""
    }
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
      <h2>${escapeHtml(group?.title ?? "流程节点说明")}${
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
  bundleLabel: string;
  part: number;
  parts: number;
}

function branchPageSections(document: WorkflowDocument): BranchPageSection[] {
  const sections: BranchPageSection[] = [];
  const pushSection = (
    source: WorkflowNode,
    edges: WorkflowEdge[],
    bundleLabel: string,
  ) => {
    const chunks = Array.from(
      { length: Math.ceil(edges.length / 7) },
      (_, index) => edges.slice(index * 7, index * 7 + 7),
    );
    chunks.forEach((chunk, index) => {
      sections.push({
        source,
        edges: chunk,
        bundleLabel,
        part: index + 1,
        parts: chunks.length,
      });
    });
  };

  for (const source of document.nodes) {
    const outgoing = document.edges.filter((edge) => edge.source === source.id);
    if (outgoing.length < 2) continue;
    const sourceBundles = document.bundles.filter(
      (bundle) => bundle.sourceId === source.id,
    );
    const bundledIds = new Set(sourceBundles.flatMap((bundle) => bundle.edgeIds));
    for (const bundle of sourceBundles) {
      const edges = outgoing.filter((edge) => bundle.edgeIds.includes(edge.id));
      if (edges.length >= 2) pushSection(source, edges, bundle.label);
    }
    const independent = outgoing.filter((edge) => !bundledIds.has(edge.id));
    if (independent.length > 0) {
      pushSection(source, independent, "");
    }
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
      <p>${
        section.bundleLabel
          ? `分支束“${escapeHtml(section.bundleLabel)}”包含 ${section.edges.length} 条可见细枝，所有细枝从同一计算分叉点出发。`
          : `该源节点有 ${section.edges.length} 条独立出口；每条边按各自的相对位置计算触点和路由。`
      }</p>
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
  const palette = PALETTES[document.display.palette] ?? PALETTES.default;
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
  ].filter((section) => section.nodes.length > 0);

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
  html, body { margin: 0; padding: 0; background: ${palette.colors.canvas}; color: ${palette.colors.ink}; font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .print-page { width: 210mm; height: 297mm; padding: 15mm 16mm 13mm; background: ${palette.colors.surface}; margin: 0 auto 10mm; position: relative; page-break-after: always; overflow: hidden; display: flex; flex-direction: column; color: ${palette.colors.ink}; }
  .print-page:last-child { page-break-after: auto; }
  .pdf-page-header { display: flex; justify-content: space-between; align-items: center; color: ${palette.colors.muted}; font-size: 10px; letter-spacing: .08em; border-bottom: 1px solid ${palette.colors.muted}; padding-bottom: 8px; }
  .pdf-brand { font-weight: 700; color: ${palette.colors.ink}; letter-spacing: .12em; }
  .pdf-title-block { padding: 24px 0 17px; }
  .pdf-kicker { font-size: 9px; font-weight: 700; letter-spacing: .16em; color: ${palette.colors.muted}; margin-bottom: 9px; }
  .pdf-title-block h1 { font-family: "STSong", "Songti SC", "Microsoft YaHei", serif; font-size: 30px; line-height: 1.2; margin: 0 0 10px; font-weight: 650; letter-spacing: -.02em; }
  .pdf-title-block > p { margin: 0; color: ${palette.colors.muted}; font-size: 12px; line-height: 1.65; max-width: 165mm; }
  .pdf-meta { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 14px; font-size: 9px; color: ${palette.colors.muted}; }
  .pdf-meta strong { color: ${palette.colors.ink}; font-weight: 600; }
  .pdf-overview-frame { flex: 1; min-height: 0; border: 1px solid ${palette.colors.muted}; border-radius: 16px; padding: 14px; background-color: ${palette.colors.canvas}; background-image: radial-gradient(${palette.colors.muted} 0.7px, transparent 0.7px); background-size: 16px 16px; display: flex; align-items: center; justify-content: center; }
  .pdf-graph { width: 100%; height: 100%; max-height: 152mm; overflow: visible; }
  .pdf-group rect { fill: ${palette.colors.canvas}; stroke: ${palette.colors.muted}; stroke-width: 1.5; }
  .pdf-group.is-important rect { fill: ${palette.colors.canvas}; stroke: ${palette.colors.important}; stroke-width: 2.4; }
  .pdf-group.is-collapsed rect { fill: ${palette.colors.canvas}; stroke: ${palette.colors.muted}; stroke-dasharray: 6 4; }
  .pdf-group-label { font-size: 14px; font-weight: 700; fill: ${palette.colors.ink}; paint-order: stroke; stroke: ${palette.colors.canvas}; stroke-width: 5px; stroke-linejoin: round; }
  .pdf-edge-trunk { fill: none; stroke: ${palette.colors.edge}; stroke-width: 1.7; }
  .pdf-edge path { fill: none; stroke: ${palette.colors.edge}; stroke-width: 1.7; }
  .pdf-edge-trunk, .pdf-edge.is-bundle-arm path { stroke: ${palette.colors.branch}; }
  .pdf-edge text { font-size: 11px; fill: ${palette.colors.ink}; paint-order: stroke; stroke: ${palette.colors.canvas}; stroke-width: 4px; }
  .pdf-node > path { fill: ${palette.colors.node}; stroke: ${palette.colors.muted}; stroke-width: 1.3; }
  .pdf-node--start > path { fill: ${palette.colors.start}; stroke: ${palette.colors.start}; stroke-width: 2; }
  .pdf-node--end > path { fill: ${palette.colors.end}; stroke: ${palette.colors.end}; stroke-width: 2; }
  .pdf-node--decision > path { fill: ${palette.colors.decision}; stroke: ${palette.colors.muted}; }
  .pdf-node--fork > path { stroke: ${palette.colors.bundle}; stroke-width: 2; }
  .pdf-node--note > path { fill: ${palette.colors.note}; stroke: ${palette.colors.muted}; stroke-dasharray: 4 3; }
  .pdf-node.is-important > path { stroke: ${palette.colors.important}; stroke-width: 2.5; }
  .pdf-node.is-milestone:not(.is-important) > path { stroke: ${palette.colors.milestone}; stroke-width: 2.4; }
  .pdf-node-title { font-size: 14px; fill: ${palette.colors.ink}; font-weight: 650; }
  .pdf-node--start .pdf-node-title, .pdf-node--end .pdf-node-title { fill: #fffaf0; }
  .pdf-node-type { font-size: 9px; fill: #928777; letter-spacing: .08em; }
  .pdf-node-milestone { font-size: 8px; font-weight: 700; fill: ${palette.colors.ink}; }
  .pdf-fork-count circle { fill: ${palette.colors.surface}; stroke: ${palette.colors.bundle}; stroke-width: 1.2; }
  .pdf-fork-count text { font-size: 9px; font-weight: 750; fill: ${palette.colors.bundle}; }
  .pdf-bundle-label rect { fill: ${palette.colors.surface}; stroke: ${palette.colors.bundle}; stroke-width: 1; }
  .pdf-bundle-label text { font-size: 8px; font-weight: 700; fill: ${palette.colors.bundle}; }
  .pdf-edge.is-important path { stroke: ${palette.colors.important}; stroke-width: 2.3; }
  .pdf-edge.is-note-edge path { stroke: ${palette.colors.muted}; stroke-dasharray: 5 4; }
  .pdf-summary-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-top: 12px; }
  .pdf-summary-strip span { background: ${palette.colors.canvas}; border-radius: 7px; padding: 8px 10px; color: ${palette.colors.muted}; font-size: 9px; }
  .pdf-summary-strip strong { color: ${palette.colors.ink}; font-size: 14px; margin-right: 4px; }
  .pdf-group-map { width: 100%; align-self: stretch; padding-top: 20px; }
  .pdf-group-map > p { margin: 0 0 12px; color: ${palette.colors.muted}; font-size: 10px; line-height: 1.6; }
  .pdf-group-map-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .pdf-group-map-card { padding: 12px; border: 1px solid ${palette.colors.muted}; border-radius: 9px; background: ${palette.colors.surface}; }
  .pdf-group-map-card strong { display: block; margin-bottom: 5px; font-size: 12px; }
  .pdf-group-map-card span { color: ${palette.colors.muted}; font-size: 9px; }
  .pdf-legend { display: flex; flex-wrap: wrap; gap: 12px 22px; align-items: center; margin: 10px 2px 0; color: ${palette.colors.muted}; font-size: 8.5px; }
  .pdf-legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend-line { width: 20px; height: 1px; background: ${palette.colors.edge}; position: relative; }
  .legend-line::after { content: ""; position: absolute; right: -1px; top: -2px; border-left: 4px solid ${palette.colors.edge}; border-top: 2.5px solid transparent; border-bottom: 2.5px solid transparent; }
  .legend-box { width: 12px; height: 9px; border-radius: 2px; border: 1px solid ${palette.colors.muted}; background: ${palette.colors.node}; }
  .legend-start { background: ${palette.colors.start}; border-color: ${palette.colors.start}; }
  .legend-task { background: ${palette.colors.node}; }
  .legend-decision { background: ${palette.colors.decision}; border-color: ${palette.colors.muted}; }
  .legend-fork { border-radius: 999px; background: ${palette.colors.bundle}; border-color: ${palette.colors.bundle}; }
  .legend-import { border-left: 3px solid #738968; }
  .pdf-footer { margin-top: auto; padding-top: 10px; border-top: 1px solid ${palette.colors.muted}; display: flex; justify-content: space-between; font-size: 8.5px; color: ${palette.colors.muted}; }
  .pdf-detail-title { padding: 21px 0 15px; }
  .pdf-detail-title h2 { margin: 0 0 7px; font-size: 23px; }
  .pdf-detail-title p { margin: 0; color: ${palette.colors.muted}; font-size: 10px; }
  .pdf-detail-list { display: flex; flex-direction: column; gap: 9px; flex: 1; }
  .pdf-branch-table { width: 100%; border-collapse: collapse; }
  .pdf-branch-table th { padding: 7px 8px; border-bottom: 1px solid ${palette.colors.muted}; color: ${palette.colors.muted}; font-size: 8px; text-align: left; }
  .pdf-branch-table td { padding: 8px; border-bottom: 1px solid ${palette.colors.muted}; color: ${palette.colors.ink}; font-size: 9px; line-height: 1.45; }
  .pdf-node-detail { border: 1px solid ${palette.colors.muted}; border-radius: 10px; padding: 10px 13px; background: ${palette.colors.surface}; page-break-inside: avoid; }
  .pdf-detail-head { display: flex; justify-content: space-between; gap: 12px; color: ${palette.colors.muted}; font-size: 8px; }
  .pdf-kind { text-transform: uppercase; letter-spacing: .08em; font-weight: 700; color: #5e7055; }
  .pdf-node-detail h3 { margin: 5px 0; font-size: 13px; }
  .pdf-node-detail p { margin: 0; color: ${palette.colors.muted}; font-size: 9.5px; line-height: 1.55; white-space: pre-wrap; }
  .pdf-detail-flags { display: flex; gap: 6px; margin-top: 6px; color: ${palette.colors.important}; font-size: 8px; font-weight: 700; }
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

