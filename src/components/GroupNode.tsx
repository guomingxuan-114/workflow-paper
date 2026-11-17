import type { Node, NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { WorkflowGroup } from "../core/types";

export interface GroupNodeData extends Record<string, unknown> {
  group: WorkflowGroup;
  memberCount: number;
  onToggle: (groupId: string) => void;
}

export type GroupFlowNode = Node<GroupNodeData, "group">;

export function GroupNodeView({ data, selected }: NodeProps<GroupFlowNode>) {
  const { group, memberCount, onToggle } = data;
  return (
    <section
      className={`workflow-group workflow-group--${group.color ?? "sage"} ${
        selected ? "is-selected" : ""
      } ${group.collapsed ? "is-collapsed" : ""}`}
      data-testid={`group-${group.id}`}
    >
      <div className="group-titlebar">
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
        <strong>{group.title}</strong>
        <span>{memberCount} 个节点</span>
      </div>
      {group.collapsed ? (
        <div className="group-collapsed-summary">
          {memberCount} 个步骤已折叠
        </div>
      ) : null}
    </section>
  );
}

