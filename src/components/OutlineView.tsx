import {
  ChevronDown,
  ChevronRight,
  Flag,
  GitBranch,
  Layers,
  Star,
} from "lucide-react";
import type { WorkflowDocument } from "../core/types";

interface OutlineViewProps {
  document: WorkflowDocument;
  selectedNodeIds: string[];
  selectedGroupIds: string[];
  onSelect: (kind: "node" | "group" | "edge", id: string) => void;
  onToggleGroup: (groupId: string) => void;
  onRenameNode: (nodeId: string, title: string) => void;
}

export function OutlineView({
  document,
  selectedNodeIds,
  selectedGroupIds,
  onSelect,
  onToggleGroup,
  onRenameNode,
}: OutlineViewProps) {
  const grouped = new Set(
    document.groups.flatMap((group) => group.nodeIds),
  );
  const roots = document.groups.filter((group) => !group.parentId);
  const looseNodes = document.nodes.filter((node) => !grouped.has(node.id));
  const importantNodes = document.nodes.filter((node) => node.important);
  const importantEdges = document.edges.filter((edge) => edge.important);
  const importantGroups = document.groups.filter((group) => group.important);
  const milestones = document.nodes.filter((node) => node.milestone);
  const nodeTitle = (id: string) =>
    document.nodes.find((node) => node.id === id)?.title ?? id;

  const renderNodes = (nodeIds: string[], depth: number) =>
    document.nodes
      .filter((node) => nodeIds.includes(node.id))
      .sort(
        (a, b) =>
          (document.layout.nodes[a.id]?.y ?? 0) -
          (document.layout.nodes[b.id]?.y ?? 0),
      )
      .map((node) => (
        <div
          key={node.id}
          className={`outline-row ${
            selectedNodeIds.includes(node.id) ? "is-selected" : ""
          }`}
          style={{ paddingLeft: 22 + depth * 24 }}
          onClick={() => onSelect("node", node.id)}
          data-testid={`outline-node-${node.id}`}
        >
          <GitBranch size={13} />
          <input
            value={node.title}
            aria-label={`大纲节点 ${node.title}`}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onRenameNode(node.id, event.target.value)}
          />
          <span className="outline-type">
            {node.type === "task"
              ? "节点"
              : node.type === "fork"
                ? "分叉点"
                : node.type}
          </span>
        </div>
      ));

  const renderGroup = (groupId: string, depth = 0) => {
    const group = document.groups.find((item) => item.id === groupId);
    if (!group) return null;
    const children = document.groups.filter(
      (item) => item.parentId === group.id,
    );
    return (
      <section key={group.id} className="outline-group">
        <button
          className={`outline-group-title ${
            selectedGroupIds.includes(group.id) ? "is-selected" : ""
          }`}
          style={{ paddingLeft: 14 + depth * 24 }}
          onClick={() => onSelect("group", group.id)}
        >
          <span
            className="outline-toggle"
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onToggleGroup(group.id);
            }}
          >
            {group.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
          <Layers size={14} />
          <strong>{group.title}</strong>
          <span>{group.nodeIds.length}</span>
        </button>
        {!group.collapsed ? (
          <>
            {renderNodes(group.nodeIds, depth + 1)}
            {children.map((child) => renderGroup(child.id, depth + 1))}
          </>
        ) : null}
      </section>
    );
  };

  return (
    <div className="outline-view" data-testid="outline-view">
      <div className="outline-intro">
        <div className="eyebrow">结构大纲</div>
        <h2>{document.metadata.title}</h2>
        <p>
          大纲与画布共享节点 ID、标题和分组。点击任一行会同步选中画布，标题修改会立即写回文档。
        </p>
      </div>
      <section className="outline-category" data-testid="important-view">
        <h3>
          <Star size={13} fill="currentColor" />
          重要的
          <span>
            {importantNodes.length +
              importantEdges.length +
              importantGroups.length}
          </span>
        </h3>
        {importantNodes.map((node) => (
          <button
            key={`important-node-${node.id}`}
            onClick={() => onSelect("node", node.id)}
          >
            <GitBranch size={12} />
            {node.title}
          </button>
        ))}
        {importantEdges.map((edge) => (
          <button
            key={`important-edge-${edge.id}`}
            onClick={() => onSelect("edge", edge.id)}
          >
            <GitBranch size={12} />
            {nodeTitle(edge.source)} → {nodeTitle(edge.target)}
          </button>
        ))}
        {importantGroups.map((group) => (
          <button
            key={`important-group-${group.id}`}
            onClick={() => onSelect("group", group.id)}
          >
            <Layers size={12} />
            {group.title}
          </button>
        ))}
        {importantNodes.length +
          importantEdges.length +
          importantGroups.length ===
        0 ? (
          <p>暂无重要标记</p>
        ) : null}
      </section>
      <section className="outline-category" data-testid="milestone-view">
        <h3>
          <Flag size={13} />
          里程碑
          <span>{milestones.length}</span>
        </h3>
        {milestones.map((node) => (
          <button
            key={`milestone-${node.id}`}
            onClick={() => onSelect("node", node.id)}
          >
            <Flag size={12} />
            {node.milestone?.label || node.title}
          </button>
        ))}
        {milestones.length === 0 ? <p>暂无里程碑</p> : null}
      </section>
      {roots.map((group) => renderGroup(group.id))}
      {looseNodes.length > 0 ? (
        <section className="outline-group">
          <div className="outline-group-title outline-group-title--plain">
            <span />
            <strong>未分组</strong>
            <span>{looseNodes.length}</span>
          </div>
          {renderNodes(
            looseNodes.map((node) => node.id),
            0,
          )}
        </section>
      ) : null}
      {document.nodes.length === 0 ? (
        <div className="outline-empty">画布中还没有节点。</div>
      ) : null}
    </div>
  );
}

