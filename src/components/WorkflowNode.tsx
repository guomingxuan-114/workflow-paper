import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { GitBranch, Flag, NotebookPen, Play, Square } from "lucide-react";
import type { WorkflowNode } from "../core/types";

export interface WorkflowNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  showDescription: boolean;
  onBorderPointerDown: (
    nodeId: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
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
      <Handle
        id="geometry-target"
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="node-edge-anchor"
        aria-hidden="true"
      />
      <Handle
        id="geometry-source"
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="node-edge-anchor"
        aria-hidden="true"
      />
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <div
          key={side}
          className={`node-connect-edge node-connect-edge--${side} nodrag nopan`}
          role="button"
          tabIndex={-1}
          aria-label={`从节点${side === "top" ? "上" : side === "right" ? "右" : side === "bottom" ? "下" : "左"}边缘建立连接`}
          data-connection-border={side}
          onPointerDown={(event) =>
            data.onBorderPointerDown(node.id, event)
          }
        />
      ))}
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
    </article>
  );
}

