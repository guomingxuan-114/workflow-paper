import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

export interface WorkflowEdgeData extends Record<string, unknown> {
  label?: string;
  onSelect: (edgeId: string) => void;
}

export type WorkflowFlowEdge = Edge<WorkflowEdgeData, "workflowEdge">;

export function WorkflowEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
  data,
}: EdgeProps<WorkflowFlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        className={`workflow-edge ${selected ? "is-selected" : ""}`}
      />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        className="workflow-edge-hitarea"
        style={{ pointerEvents: "stroke", cursor: "pointer" }}
        onPointerDown={(event) => {
          event.stopPropagation();
          data?.onSelect(id);
        }}
        onClick={(event) => {
          event.stopPropagation();
          data?.onSelect(id);
        }}
      />
      {data?.label ? (
        <EdgeLabelRenderer>
          <button
            className="edge-label nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              zIndex: 20,
            }}
            onClick={(event) => {
              event.stopPropagation();
              data.onSelect(id);
            }}
          >
            {data.label}
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
