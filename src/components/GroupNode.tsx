import type { Node, NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, Folder, Star } from "lucide-react";
import type { WorkflowGroup } from "../core/types";

export interface GroupNodeData extends Record<string, unknown> {
  group: WorkflowGroup;
  memberCount: number;
  onToggle: (groupId: string) => void;
  onDragStart: (
    groupId: string,
    clientX: number,
    clientY: number,
  ) => void;
}

export type GroupFlowNode = Node<GroupNodeData, "group">;

export function GroupNodeView({ data, selected }: NodeProps<GroupFlowNode>) {
  const { group, memberCount, onToggle, onDragStart } = data;
  return (
    <section
      className={`workflow-group workflow-group--${group.color ?? "sage"} ${
        selected ? "is-selected" : ""
      } ${group.collapsed ? "is-collapsed" : ""} ${
        group.important ? "is-important" : ""
      }`}
      data-testid={`group-${group.id}`}
    >
      <div
        className="group-titlebar"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if ((event.target as Element).closest("button")) return;
          event.preventDefault();
          event.stopPropagation();
          onDragStart(group.id, event.clientX, event.clientY);
        }}
      >
        <button
          className="group-collapse nodrag nopan"
          aria-label={group.collapsed ? "展开分组" : "折叠分组"}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(group.id);
          }}
        >
          {group.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
        <Folder size={14} />
        {group.important ? <Star size={11} fill="currentColor" /> : null}
        <strong>{group.title}</strong>
        <span>{memberCount} 个节点</span>
      </div>
      {group.collapsed ? (
        <div className="group-collapsed-summary">
          {memberCount} 个节点已折叠
        </div>
      ) : null}
    </section>
  );
}

