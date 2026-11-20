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
  onPointerDown: (edgeId: string, event: React.PointerEvent<SVGPathElement>) => void;
  onContextMenu: (edgeId: string, event: React.MouseEvent<SVGPathElement>) => void;
  path: string;
  labelPoint: Point;
  important?: boolean;
  noteEdge?: boolean;
  simplified?: boolean;
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
        className={`workflow-edge ${selected ? "is-selected" : ""} ${
          data?.important ? "is-important" : ""
        } ${data?.noteEdge ? "is-note-edge" : ""}`}
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
          if (event.button !== 0) return;
          event.stopPropagation();
          data?.onPointerDown(id, event);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          data?.onContextMenu(id, event);
        }}
      />
      {data?.label && !data.simplified ? (
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
