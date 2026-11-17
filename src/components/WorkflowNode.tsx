import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { GitBranch, Flag, NotebookPen, Play, Square } from "lucide-react";
import type { WorkflowNode } from "../core/types";

export interface WorkflowNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  showDescription: boolean;
}

export type WorkflowFlowNode = Node<WorkflowNodeData, "workflow">;

const typeIcons = {
  start: Play,
  task: Square,
  decision: GitBranch,
  milestone: Flag,
  end: Square,
  note: NotebookPen,
};

const typeLabels = {
  start: "开始",
  task: "步骤",
  decision: "判断",
  milestone: "里程碑",
  end: "结束",
  note: "备注",
};

export function WorkflowNodeView({
  data,
  selected,
}: NodeProps<WorkflowFlowNode>) {
  const node = data.node;
  const Icon = typeIcons[node.type];
  return (
    <article
      className={`workflow-node workflow-node--${node.type} ${
        selected ? "is-selected" : ""
      }`}
      data-testid={`node-${node.id}`}
      data-node-title={node.title}
    >
      {node.type !== "start" ? (
        <Handle
          type="target"
          position={Position.Left}
          className="node-handle node-handle--target"
          aria-label="连接到此节点"
        />
      ) : null}
      <div className="node-topline">
        <span className="node-kind">
          <Icon size={13} strokeWidth={1.8} />
          {typeLabels[node.type]}
        </span>
        {node.origin.kind === "import" ? (
          <span className="origin-dot" title="来自程序版本导入">
            import
          </span>
        ) : null}
      </div>
      <h3>{node.title}</h3>
      {data.showDescription && node.description ? (
        <p>{node.description}</p>
      ) : (
        <div className="node-empty">{node.description ? "" : "双击补充说明"}</div>
      )}
      <div className="node-footer">
        <span>{node.tags[0] ?? "未标记"}</span>
        <span className="node-id" title={node.id}>
          {node.id.replace(/^node-/, "").slice(0, 6)}
        </span>
      </div>
      {node.type !== "end" && node.type !== "note" ? (
        <Handle
          type="source"
          position={Position.Right}
          className="node-handle node-handle--source"
          aria-label="拖动以创建后续节点或关系"
        />
      ) : null}
    </article>
  );
}

