import { ChevronDown, ChevronRight, GitBranch, Layers } from "lucide-react";
import type { WorkflowDocument } from "../core/types";

interface OutlineViewProps {
  document: WorkflowDocument;
  selectedNodeIds: string[];
  selectedGroupIds: string[];
  onSelect: (kind: "node" | "group", id: string) => void;
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
          <span className="outline-type">{node.type}</span>
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

