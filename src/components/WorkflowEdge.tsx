import {
  BaseEdge,
  EdgeLabelRenderer,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import type { Point } from "../core/types";

export interface WorkflowEdgeData extends Record<string, unknown> {
  label?: string;
  onSelect: (edgeId: string) => void;
  path: string;
  labelPoint: Point;
}

export type WorkflowFlowEdge = Edge<WorkflowEdgeData, "workflowEdge">;

export function WorkflowEdgeView({
  id,
  source,
  target,
  markerEnd,
  style,
  selected,
  data,
}: EdgeProps<WorkflowFlowEdge>) {
  const path = data?.path ?? "";
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
        data-edge-source={source}
        data-edge-target={target}
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
              transform: `translate(-50%, -50%) translate(${data.labelPoint.x}px, ${data.labelPoint.y}px)`,
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
