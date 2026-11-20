import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  Flag,
  GitBranch,
  GitFork,
  NotebookPen,
  Play,
  Square,
  Star,
} from "lucide-react";
import { nodeBoundaryPath, nodeMetrics } from "../core/nodeShapes";
import { hexToRgba, PALETTES } from "../core/palettes";
import type { WorkflowNode, WorkflowPalette } from "../core/types";

export interface WorkflowNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  showDescription: boolean;
  width: number;
  height: number;
  palette: WorkflowPalette;
  outgoingCount: number;
  groupTitle?: string;
  onBorderPointerDown: (
    nodeId: string,
    event: React.PointerEvent<Element>,
  ) => void;
}

export type WorkflowFlowNode = Node<WorkflowNodeData, "workflow">;

const typeIcons = {
  start: Play,
  fork: GitFork,
  task: Square,
  decision: GitBranch,
  end: Square,
  note: NotebookPen,
};

const typeLabels = {
  start: "开始",
  fork: "分叉点",
  task: "节点",
  decision: "判断",
  end: "结束",
  note: "备注",
};

export function WorkflowNodeView({
  data,
  selected,
}: NodeProps<WorkflowFlowNode>) {
  const node = data.node;
  const Icon = typeIcons[node.type];
  const metrics = nodeMetrics(node);
  const borderPath = nodeBoundaryPath(node, data.width, data.height);
  const palette = PALETTES[data.palette] ?? PALETTES.default;
  const emphasisColor = node.important
    ? palette.colors.important
    : node.milestone
      ? palette.colors.milestone
      : undefined;
  const emphasisAlpha = node.important ? 0.2 : 0.14;
  const tagColors = [
    palette.colors.decision,
    palette.colors.milestone,
    palette.colors.branch,
    palette.colors.bundle,
  ];
  const markers = (
    <span className="node-markers">
      {node.milestone ? (
        <span
          className="node-milestone-marker"
          title={node.milestone.label || "里程碑"}
        >
          <Flag size={11} />
          {node.milestone.label || "里程碑"}
        </span>
      ) : null}
      {node.important ? (
        <span className="node-important-marker" title="重要">
          <Star size={11} fill="currentColor" />
        </span>
      ) : null}
      {node.origin.kind === "import" ? (
        <span className="origin-dot" title="来自程序版本导入">
          import
        </span>
      ) : null}
    </span>
  );
  return (
    <article
      className={`workflow-node workflow-node--${node.type} workflow-node--shape-${metrics.shape} ${
        selected ? "is-selected" : ""
      } ${node.milestone ? "is-milestone" : ""} ${
        node.important ? "is-important" : ""
      }`}
      data-testid={`node-${node.id}`}
      data-node-title={node.title}
      data-node-kind={node.type}
      data-node-shape={metrics.shape}
      onDoubleClick={
        node.type === "fork"
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
            }
          : undefined
      }
      style={
        {
          "--node-emphasis-wash": emphasisColor
            ? hexToRgba(emphasisColor, emphasisAlpha)
            : "transparent",
          "--node-emphasis-accent":
            emphasisColor ?? palette.colors.muted,
          "--node-milestone-accent": palette.colors.milestone,
          "--node-important-accent": palette.colors.important,
        } as React.CSSProperties
      }
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
      <svg
        className="node-border-hit"
        viewBox={`0 0 ${data.width} ${data.height}`}
        preserveAspectRatio="none"
        aria-label="节点边框连接区"
      >
        <path
          d={borderPath}
          className="node-border-hit-path nodrag nopan"
          onPointerDown={(event) =>
            data.onBorderPointerDown(node.id, event)
          }
        />
      </svg>
      <div
        className="node-content"
        style={{
          paddingInline: metrics.textInsetX,
          paddingBlock: metrics.textInsetY,
        }}
      >
        {node.type === "decision" ? (
          <>
            <div className="node-decision-markers">{markers}</div>
            <h3 className="node-title node-title--decision">{node.title}</h3>
          </>
        ) : node.type === "fork" ? (
          <>
            <div className="node-fork-markers">{markers}</div>
            <div
              className={`node-fork-content ${
                node.title ? "has-title" : "is-count-only"
              }`}
            >
              {node.title ? (
                <h3 className="node-title node-title--fork">{node.title}</h3>
              ) : null}
              <span
                className="node-fork-count"
                aria-label={`出边数量 ${data.outgoingCount}`}
                title={`出边数量：${data.outgoingCount}`}
              >
                {data.outgoingCount}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="node-topline">
              <span className="node-kind">
                <Icon size={13} strokeWidth={1.8} />
                {typeLabels[node.type]}
              </span>
              {markers}
            </div>
            <h3 className="node-title">{node.title}</h3>
            {data.showDescription && node.description ? (
              <p>{node.description}</p>
            ) : (
              <div className="node-empty">
                {node.description ? "" : "双击补充说明"}
              </div>
            )}
            <div className="node-footer">
              {node.tags.length > 0 ? (
                <div className="node-tags">
                  {node.tags.slice(0, 3).map((tag, index) => {
                    const color = tagColors[index % tagColors.length];
                    return (
                      <span
                        key={`${tag}-${index}`}
                        className="node-tag"
                        style={{
                          background: hexToRgba(color, 0.16),
                          borderColor: hexToRgba(color, 0.42),
                        }}
                        title={tag}
                      >
                        {tag}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <span className="node-tag-empty">添加标签</span>
              )}
            </div>
          </>
        )}
      </div>
      {data.groupTitle ? (
        <span className="node-group-membership" title="显式移出前仍属于该分组">
          {data.groupTitle}
        </span>
      ) : null}
    </article>
  );
}

