import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type Viewport,
  useReactFlow,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  NodeKind,
  Point,
  Selection,
  WorkflowDocument,
} from "../core/types";
import {
  addNodeToEdgeEndpointGroup,
  GROUP_PADDING,
  getHiddenNodeIds,
  moveGroup,
  moveNodes,
  removeNodeFromGroup,
  splitEdge,
} from "../core/document";
import { createNode, withNode, connectNodes } from "../core/document";
import {
  buildWorkflowRouting,
  buildConnectionPreview,
  buildFreePreviewPath,
  documentWithNodePositions,
  distanceToRoute,
  projectPointOntoRoute,
  progressAlongRoute,
  type EdgeRoute,
  type RouteSide,
  type RoutingCache,
} from "../core/edgeRouting";
import { boundaryPointToward } from "../core/nodeShapes";
import { GroupNodeView, type GroupFlowNode } from "./GroupNode";
import {
  WorkflowNodeView,
  type WorkflowFlowNode,
} from "./WorkflowNode";
import {
  WorkflowEdgeView,
  type WorkflowFlowEdge,
} from "./WorkflowEdge";

const nodeTypes = {
  workflow: WorkflowNodeView,
  group: GroupNodeView,
};

const edgeTypes = {
  workflowEdge: WorkflowEdgeView,
};

const groupFlowId = (id: string) => `group:${id}`;
const semanticGroupId = (id: string) => id.replace(/^group:/, "");

function connectFromNodeBorder(
  document: WorkflowDocument,
  sourceId: string,
  targetId: string,
): WorkflowDocument {
  return connectNodes(document, sourceId, targetId, undefined, "manual");
}

function previewSideToward(start: Point, end: Point): RouteSide {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "bottom" : "top";
}

interface CanvasViewProps {
  document: WorkflowDocument;
  externalNodeIds: string[];
  externalGroupIds: string[];
  fitSignal: number;
  onApply: (
    updater: (document: WorkflowDocument) => WorkflowDocument,
    record?: boolean,
  ) => void;
  onCheckpoint: () => void;
  onSelectionChange: (
    selection: Selection,
    nodeIds: string[],
    edgeIds: string[],
    groupIds: string[],
  ) => void;
  onEditNode: (nodeId: string) => void;
  onCreateGroup: () => void;
  onEditBranches: (sourceId: string) => void;
  onToggleGroup: (groupId: string) => void;
  onViewportChange: (viewport: Viewport) => void;
}

function CanvasInner({
  document,
  externalNodeIds,
  externalGroupIds,
  fitSignal,
  onApply,
  onCheckpoint,
  onSelectionChange,
  onEditNode,
  onCreateGroup,
  onEditBranches,
  onToggleGroup,
  onViewportChange,
}: CanvasViewProps) {
  const [nodes, setNodes] = useState<
    Array<WorkflowFlowNode | GroupFlowNode>
  >([]);
  const [edges, setEdges] = useState<WorkflowFlowEdge[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    flow: Point;
  } | null>(null);
  const [connectionDraft, setConnectionDraft] = useState<{
    sourceId: string;
    pointer: Point;
    targetId?: string;
    path: string;
  } | null>(null);
  const [edgeBranchDraft, setEdgeBranchDraft] = useState<{
    path: string;
    breakPoint: Point;
    pointer: Point;
    targetId?: string;
  } | null>(null);
  const [edgeContextMenu, setEdgeContextMenu] = useState<{
    edgeId: string;
    x: number;
    y: number;
    flow: Point;
  } | null>(null);
  const routingCacheRef = useRef<RoutingCache>(new Map());
  const [renderQuality, setRenderQuality] = useState<
    "full" | "simplified"
  >("full");
  const qualityStatsRef = useRef({
    slowFrames: 0,
    fastFrames: 0,
    cooldownUntil: 0,
  });
  const pendingNodePositionsRef = useRef<Record<string, Point>>({});
  const liveNodePositionsRef = useRef<Record<string, Point>>({});
  const nodeDragActiveRef = useRef(false);
  const nodeDragFrameRef = useRef<number | null>(null);
  const qualityRestoreTimerRef = useRef<number | null>(null);
  const lastEdgePointerRef = useRef<{ id: string; at: number } | null>(null);
  const selectedEdgeRef = useRef<string | null>(null);
  const reactFlow = useReactFlow();
  const selectionChangeRef = useRef(onSelectionChange);
  selectionChangeRef.current = onSelectionChange;

  const parentByNode = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of document.groups) {
      for (const nodeId of group.nodeIds) map.set(nodeId, group.id);
    }
    return map;
  }, [document.groups]);

  const hidden = useMemo(
    () => getHiddenNodeIds(document),
    [document.groups, document.nodes],
  );
  const selectedNodeKey = externalNodeIds.join("\u0000");
  const selectedGroupKey = externalGroupIds.join("\u0000");
  const graphSyncKey = useMemo(
    () =>
      JSON.stringify({
        nodes: document.nodes,
        edges: document.edges,
        groups: document.groups,
        nodeLayout: document.layout.nodes,
        groupLayout: document.layout.groups,
        display: document.display,
      }),
    [
      document.display,
      document.edges,
      document.groups,
      document.layout.groups,
      document.layout.nodes,
      document.nodes,
    ],
  );
  const visibleNodeIds = useMemo(
    () =>
      new Set(
        document.nodes
          .filter((node) => !hidden.has(node.id))
          .map((node) => node.id),
      ),
    [document.nodes, hidden],
  );
  const routing = useMemo(
    () =>
      buildWorkflowRouting(
        document,
        visibleNodeIds,
        routingCacheRef.current,
      ),
    // Viewport-only changes must not rebuild persisted edge geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graphSyncKey, hidden, visibleNodeIds],
  );

  const beginRealtime = useCallback(() => {
    qualityStatsRef.current.slowFrames = 0;
    qualityStatsRef.current.fastFrames = 0;
    if (qualityRestoreTimerRef.current !== null) {
      window.clearTimeout(qualityRestoreTimerRef.current);
      qualityRestoreTimerRef.current = null;
    }
  }, []);

  const noteFrameCost = useCallback((startedAt: number) => {
    const now = performance.now();
    const cost = now - startedAt;
    const stats = qualityStatsRef.current;
    if (cost > 18) {
      stats.slowFrames += 1;
      stats.fastFrames = 0;
    } else if (cost < 8) {
      stats.fastFrames += 1;
    }
    if (
      renderQuality === "full" &&
      stats.slowFrames >= 3 &&
      now >= stats.cooldownUntil
    ) {
      stats.cooldownUntil = now + 1500;
      setRenderQuality("simplified");
    } else if (
      renderQuality === "simplified" &&
      now >= stats.cooldownUntil &&
      stats.fastFrames >= 20
    ) {
      setRenderQuality("full");
      stats.slowFrames = 0;
      stats.fastFrames = 0;
    }
  }, [renderQuality]);

  const finishRealtime = useCallback(() => {
    if (qualityRestoreTimerRef.current !== null) {
      window.clearTimeout(qualityRestoreTimerRef.current);
    }
    qualityRestoreTimerRef.current = window.setTimeout(() => {
      setRenderQuality("full");
      qualityStatsRef.current.slowFrames = 0;
      qualityStatsRef.current.fastFrames = 0;
      qualityRestoreTimerRef.current = null;
    }, 1500);
  }, []);

  const handleEdgeSelect = useCallback((edgeId: string) => {
    selectedEdgeRef.current = edgeId;
    setEdges((current) =>
      current.map((edge) => ({ ...edge, selected: edge.id === edgeId })),
    );
    setNodes((current) =>
      current.map((node) => ({ ...node, selected: false })),
    );
    selectionChangeRef.current({ kind: "edge", id: edgeId }, [], [edgeId], []);
  }, []);

  const handleGroupDragStart = useCallback(
    (groupId: string, clientX: number, clientY: number) => {
      const initial = document.layout.groups[groupId];
      if (!initial) return;
      selectionChangeRef.current(
        { kind: "group", id: groupId },
        [],
        [],
        [groupId],
      );
      let checkpointed = false;
      let pending: Point | null = null;
      let frame: number | null = null;
      beginRealtime();
      const pointerMove = (event: PointerEvent) => {
        const deltaX = event.clientX - clientX;
        const deltaY = event.clientY - clientY;
        if (!checkpointed && Math.hypot(deltaX, deltaY) > 2) {
          checkpointed = true;
          onCheckpoint();
        }
        if (!checkpointed) return;
        const zoom = Math.max(0.2, reactFlow.getViewport().zoom);
        const position = {
          x: initial.x + deltaX / zoom,
          y: initial.y + deltaY / zoom,
        };
        pending = position;
        if (frame === null) {
          frame = window.requestAnimationFrame(() => {
            const startedAt = performance.now();
            frame = null;
            if (pending) {
              const next = pending;
              onApply((current) => moveGroup(current, groupId, next), false);
            }
            noteFrameCost(startedAt);
          });
        }
      };
      const pointerUp = () => {
        window.removeEventListener("pointermove", pointerMove);
        window.removeEventListener("pointerup", pointerUp);
        window.removeEventListener("blur", pointerUp);
        if (frame !== null) {
          window.cancelAnimationFrame(frame);
          frame = null;
        }
        if (pending) {
          onApply((current) => moveGroup(current, groupId, pending!), false);
        }
        finishRealtime();
      };
      window.addEventListener("pointermove", pointerMove);
      window.addEventListener("pointerup", pointerUp, { once: true });
      window.addEventListener("blur", pointerUp, { once: true });
    },
    [
      beginRealtime,
      document.layout.groups,
      finishRealtime,
      noteFrameCost,
      onApply,
      onCheckpoint,
      reactFlow,
    ],
  );

  const handleNodeBorderPointerDown = useCallback(
    (
      sourceId: string,
      event: React.PointerEvent<Element>,
    ) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const start = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const startPreview = buildConnectionPreview(
        document,
        sourceId,
        start,
      );
      if (!startPreview) return;
      setConnectionDraft({
        sourceId,
        pointer: start,
        path: startPreview.path,
      });

      const nodeAt = (point: Point) =>
        document.nodes.find((node) => {
          if (hidden.has(node.id)) return false;
          if (node.type === "fork") return false;
          const layout = document.layout.nodes[node.id];
          return (
            layout &&
            point.x >= layout.x &&
            point.x <= layout.x + layout.width &&
            point.y >= layout.y &&
            point.y <= layout.y + layout.height
          );
        })?.id;

      const pointerMove = (moveEvent: PointerEvent) => {
        const pointer = reactFlow.screenToFlowPosition({
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        });
        const hovered = nodeAt(pointer);
        const targetId = hovered && hovered !== sourceId ? hovered : undefined;
        const preview =
          buildConnectionPreview(document, sourceId, pointer, targetId) ??
          startPreview;
        setConnectionDraft({
          sourceId,
          pointer,
          targetId,
          path: preview.path,
        });
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", pointerMove);
        window.removeEventListener("pointerup", pointerUp);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("blur", cancel);
      };
      const cancel = () => {
        cleanup();
        setConnectionDraft(null);
      };
      const pointerUp = (upEvent: PointerEvent) => {
        cleanup();
        const pointer = reactFlow.screenToFlowPosition({
          x: upEvent.clientX,
          y: upEvent.clientY,
        });
        const distance = Math.hypot(pointer.x - start.x, pointer.y - start.y);
        const hovered = nodeAt(pointer);
        setConnectionDraft(null);
        if (distance < 8) return;
        if (hovered === sourceId) return;

        window.setTimeout(() => {
          if (hovered) {
            onApply(
              (current) =>
                connectFromNodeBorder(
                  current,
                  sourceId,
                  hovered,
                ),
              true,
            );
            return;
          }

          const node = createNode("未命名节点", pointer, "task");
          const sourceGroup = parentByNode.get(sourceId);
          onApply((current) => {
            const withNewNode = withNode(current, node, pointer);
            const withGroup = sourceGroup
              ? {
                  ...withNewNode,
                  groups: withNewNode.groups.map((group) =>
                    group.id === sourceGroup
                      ? { ...group, nodeIds: [...group.nodeIds, node.id] }
                      : group,
                  ),
                }
              : withNewNode;
            return connectFromNodeBorder(
              withGroup,
              sourceId,
              node.id,
            );
          }, true);
          selectionChangeRef.current(
            { kind: "node", id: node.id },
            [node.id],
            [],
            [],
          );
        }, 0);
      };

      window.addEventListener("pointermove", pointerMove);
      window.addEventListener("pointerup", pointerUp, { once: true });
      window.addEventListener("pointercancel", cancel, { once: true });
      window.addEventListener("blur", cancel, { once: true });
    },
    [document, hidden, onApply, parentByNode, reactFlow],
  );

  const startEdgeDerivation = useCallback(
    (
      edgeId: string,
      event: React.PointerEvent<Element>,
      onTap?: () => void,
    ) => {
      const originEdge = document.edges.find((edge) => edge.id === edgeId);
      if (!originEdge) return;
      event.preventDefault();
      event.stopPropagation();
      const start = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const route = routing.routes[edgeId];
      const projected = route
        ? projectPointOntoRoute(start, route)
        : { point: start, progress: 0.5, distance: 0 };
      const breakPoint = projected.point;
      setEdgeBranchDraft({
        path: buildFreePreviewPath(breakPoint, breakPoint),
        breakPoint,
        pointer: start,
      });
      let pendingPointer = start;
      let frame: number | null = null;
      let moved = false;

      const nodeAt = (point: Point) =>
        document.nodes.find((node) => {
          if (hidden.has(node.id)) return false;
          const layout = document.layout.nodes[node.id];
          return (
            layout &&
            point.x >= layout.x &&
            point.x <= layout.x + layout.width &&
            point.y >= layout.y &&
            point.y <= layout.y + layout.height
          );
        })?.id;

      const renderPreview = () => {
        frame = null;
        const targetId = nodeAt(pendingPointer);
        const target = targetId
          ? document.nodes.find((node) => node.id === targetId)
          : undefined;
        const targetLayout = targetId
          ? document.layout.nodes[targetId]
          : undefined;
        const endPoint =
          target && targetLayout
            ? boundaryPointToward(target, targetLayout, breakPoint)
            : pendingPointer;
        const side = previewSideToward(breakPoint, endPoint);
        setEdgeBranchDraft({
          path: buildFreePreviewPath(breakPoint, endPoint, side),
          breakPoint,
          pointer: pendingPointer,
          targetId,
        });
      };

      const pointerMove = (moveEvent: PointerEvent) => {
        pendingPointer = reactFlow.screenToFlowPosition({
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        });
        if (!moved) {
          moved =
            Math.hypot(
              pendingPointer.x - start.x,
              pendingPointer.y - start.y,
            ) > 8;
        }
        if (moved && frame === null) {
          frame = window.requestAnimationFrame(renderPreview);
        }
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", pointerMove);
        window.removeEventListener("pointerup", pointerUp);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("blur", cancel);
        if (frame !== null) window.cancelAnimationFrame(frame);
      };
      const cancel = () => {
        cleanup();
        setEdgeBranchDraft(null);
      };
      const pointerUp = (upEvent: PointerEvent) => {
        cleanup();
        setEdgeBranchDraft(null);
        if (!moved) {
          onTap?.();
          return;
        }
        pendingPointer = reactFlow.screenToFlowPosition({
          x: upEvent.clientX,
          y: upEvent.clientY,
        });
        window.setTimeout(() => {
          const targetId = nodeAt(pendingPointer);
          const split = splitEdge(
            document,
            originEdge.id,
            breakPoint,
            "source",
            { nodeTitle: "", nodeType: "fork" },
          );
          if (!split.insertedNodeId) return;
          let next = split.document;
          let selectedId = targetId;
          if (!selectedId) {
            const derived = createNode(
              "未命名节点",
              pendingPointer,
              "task",
            );
            next = withNode(next, derived, pendingPointer);
            next = addNodeToEdgeEndpointGroup(
              next,
              derived.id,
              originEdge.source,
              originEdge.target,
            );
            selectedId = derived.id;
          }
          next = connectNodes(
            next,
            split.insertedNodeId,
            selectedId,
            undefined,
            "manual",
          );
          onApply(() => next, true);
          selectionChangeRef.current(
            { kind: "node", id: selectedId },
            [selectedId],
            [],
            [],
          );
        }, 0);
      };

      window.addEventListener("pointermove", pointerMove);
      window.addEventListener("pointerup", pointerUp, { once: true });
      window.addEventListener("pointercancel", cancel, { once: true });
      window.addEventListener("blur", cancel, { once: true });
    },
    [
      document,
      hidden,
      onApply,
      reactFlow,
      routing,
    ],
  );

  const handleEdgePointerDown = useCallback(
    (edgeId: string, event: React.PointerEvent<SVGPathElement>) => {
      startEdgeDerivation(edgeId, event, () => handleEdgeSelect(edgeId));
    },
    [handleEdgeSelect, startEdgeDerivation],
  );

  const handleTrunkPointerDown = useCallback(
    (bundleId: string, event: React.PointerEvent<Element>) => {
      if (event.button !== 0) return;
      const bundle = document.bundles.find((item) => item.id === bundleId);
      const firstEdge = bundle?.edgeIds[0];
      if (firstEdge) {
        startEdgeDerivation(firstEdge, event, () =>
          onEditBranches(bundleId),
        );
      }
    },
    [document.bundles, onEditBranches, startEdgeDerivation],
  );

  const handleEdgeContextMenu = useCallback(
    (edgeId: string, event: React.MouseEvent<SVGPathElement>) => {
      const menuWidth = 180;
      const menuHeight = 54;
      setEdgeContextMenu({
        edgeId,
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
        flow: reactFlow.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        }),
      });
    },
    [reactFlow],
  );

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as Element;
      if (
        target.closest(
          ".react-flow__node-workflow, .react-flow__controls, .workflow-group, .workflow-edge-hitarea, .bundle-trunk-hit-path, .bundle-label, .context-menu",
        )
      ) {
        return;
      }
      const point = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const threshold = 15 / Math.max(0.2, reactFlow.getViewport().zoom);
      const edge = Object.values(routing.routes).find(
        (candidate) => distanceToRoute(point, candidate) <= threshold,
      );
      if (!edge) return;
      event.preventDefault();
      event.stopPropagation();
      lastEdgePointerRef.current = { id: edge.edgeId, at: Date.now() };
      handleEdgeSelect(edge.edgeId);
    };
    const click = (event: MouseEvent) => {
      const pending = lastEdgePointerRef.current;
      if (!pending || Date.now() - pending.at > 500) return;
      lastEdgePointerRef.current = null;
      event.preventDefault();
      event.stopPropagation();
      handleEdgeSelect(pending.id);
    };
    element.addEventListener("pointerdown", pointerDown, true);
    element.addEventListener("click", click, true);
    return () => {
      element.removeEventListener("pointerdown", pointerDown, true);
      element.removeEventListener("click", click, true);
    };
  }, [document, handleEdgeSelect, onEditBranches, reactFlow, routing]);

  const toFlowEdges = useCallback(
    (
      sourceDocument: WorkflowDocument,
      sourceRouting: ReturnType<typeof buildWorkflowRouting>,
      visible: Set<string>,
    ): WorkflowFlowEdge[] =>
      sourceDocument.edges
        .filter(
          (edge) => visible.has(edge.source) && visible.has(edge.target),
        )
        .flatMap<WorkflowFlowEdge>((edge) => {
          const route = sourceRouting.routes[edge.id];
          if (!route) return [];
          const sourceNode = sourceDocument.nodes.find(
            (node) => node.id === edge.source,
          );
          const targetNode = sourceDocument.nodes.find(
            (node) => node.id === edge.target,
          );
          const noteEdge =
            sourceNode?.type === "note" || targetNode?.type === "note";
          return [
            {
              id: edge.id,
              source: edge.source,
              target: edge.target,
              sourceHandle: "geometry-source",
              targetHandle: "geometry-target",
              type: "workflowEdge",
              data: {
                label: edge.label,
                onSelect: handleEdgeSelect,
                onPointerDown: handleEdgePointerDown,
                onContextMenu: handleEdgeContextMenu,
                path:
                  renderQuality === "simplified"
                    ? buildFreePreviewPath(
                        route.sourcePoint,
                        route.targetPoint,
                        route.side,
                      )
                    : route.path,
                labelPoint: route.labelPoint,
                simplified: renderQuality === "simplified",
                important: Boolean(edge.important),
                noteEdge,
              },
              markerEnd: noteEdge
                ? undefined
                : {
                    type: MarkerType.ArrowClosed,
                    width: 16,
                    height: 16,
                  },
              className: `workflow-edge ${
                route.bundleId ? "is-bundle-arm" : ""
              } ${noteEdge ? "is-note-edge" : ""}`,
              style: { strokeWidth: 1.5 },
            },
          ];
        }),
    [
      handleEdgeContextMenu,
      handleEdgePointerDown,
      handleEdgeSelect,
      renderQuality,
    ],
  );

  const updateLiveEdges = useCallback(
    (
      sourceRouting: ReturnType<typeof buildWorkflowRouting>,
      movedNodeIds: Set<string>,
    ) => {
      setEdges((current) =>
        current.map((edge) => {
          if (
            !movedNodeIds.has(edge.source) &&
            !movedNodeIds.has(edge.target)
          ) {
            return edge;
          }
          const route = sourceRouting.routes[edge.id];
          if (!route || !edge.data) return edge;
          return {
            ...edge,
            data: {
              ...edge.data,
              path:
                renderQuality === "simplified"
                  ? buildFreePreviewPath(
                      route.sourcePoint,
                      route.targetPoint,
                      route.side,
                    )
                  : route.path,
              labelPoint: route.labelPoint,
              simplified: renderQuality === "simplified",
            },
          };
        }),
      );
    },
    [renderQuality],
  );

  const updateLiveForkNodes = useCallback(
    (sourceRouting: ReturnType<typeof buildWorkflowRouting>) => {
      const positions = new Map<string, Point>();
      for (const bundle of document.bundles) {
        if (!bundle.forkNodeId || bundle.forkNodeId === bundle.sourceId) {
          continue;
        }
        const branch = sourceRouting.branches[bundle.id];
        const layout = document.layout.nodes[bundle.forkNodeId];
        if (!branch || !layout) continue;
        positions.set(bundle.forkNodeId, {
          x: branch.point.x - layout.width / 2,
          y: branch.point.y - layout.height / 2,
        });
      }
      if (positions.size === 0) return;
      setNodes((current) =>
        current.map((node) => {
          const position =
            node.type === "workflow" ? positions.get(node.id) : undefined;
          return position ? { ...node, position } : node;
        }),
      );
    },
    [document.bundles, document.layout.nodes],
  );

  useEffect(() => {
    const nodeSelection = new Set(externalNodeIds);
    const groupSelection = new Set(externalGroupIds.map(groupFlowId));
    const flowNodes: Array<WorkflowFlowNode | GroupFlowNode> = [];

    const siblingGroups = (parentId?: string) =>
      document.groups.filter((group) => group.parentId === parentId);
    const addGroup = (groupId: string) => {
      const group = document.groups.find((item) => item.id === groupId);
      if (!group) return;
      if (group.parentId) addGroup(group.parentId);
      if (flowNodes.some((node) => node.id === groupFlowId(group.id))) return;
      const layout = document.layout.groups[group.id];
      const parentLayout = group.parentId
        ? document.layout.groups[group.parentId]
        : null;
      const position = layout
        ? {
            x: layout.x - (parentLayout?.x ?? 0),
            y: layout.y - (parentLayout?.y ?? 0),
          }
        : { x: 0, y: 0 };
      flowNodes.push({
        id: groupFlowId(group.id),
        type: "group",
        position,
        data: {
          group,
          memberCount: group.nodeIds.length,
          onToggle: onToggleGroup,
          onDragStart: handleGroupDragStart,
        },
        style: {
          width: group.collapsed ? 286 : Math.max(300, layout?.width ?? 360),
          height: group.collapsed ? 82 : Math.max(170, layout?.height ?? 240),
          zIndex: -10,
        },
        selected: groupSelection.has(groupFlowId(group.id)),
        draggable: false,
        selectable: true,
        ...(group.parentId ? { parentId: groupFlowId(group.parentId) } : {}),
      });
    };
    document.groups.filter((group) => !group.parentId).forEach((group) => addGroup(group.id));
    document.groups
      .filter((group) => group.parentId)
      .forEach((group) => addGroup(group.id));

    for (const node of document.nodes) {
      if (hidden.has(node.id)) continue;
      const layout = document.layout.nodes[node.id];
      if (!layout) continue;
      const livePosition = liveNodePositionsRef.current[node.id];
      const absolutePosition = livePosition ?? layout;
      const parentId = parentByNode.get(node.id);
      const parentLayout = parentId
        ? document.layout.groups[parentId]
        : null;
      const linkedForkBundle = document.bundles.find(
        (bundle) => bundle.forkNodeId === node.id,
      );
      flowNodes.push({
        id: node.id,
        type: "workflow",
        position: {
          x: absolutePosition.x - (parentLayout?.x ?? 0),
          y: absolutePosition.y - (parentLayout?.y ?? 0),
        },
        data: {
          node,
          showDescription: document.display.showDescriptions,
          width: layout.width,
          height: layout.height,
          palette: document.display.palette,
          outgoingCount:
            linkedForkBundle?.edgeIds.length ??
            document.edges.filter((edge) => edge.source === node.id).length,
          groupTitle: parentId
            ? document.groups.find((group) => group.id === parentId)?.title
            : undefined,
          onBorderPointerDown: handleNodeBorderPointerDown,
        },
        style: { width: layout.width, height: layout.height },
        selected: nodeSelection.has(node.id),
        draggable: node.type !== "fork",
        selectable: true,
        ...(parentId ? { parentId: groupFlowId(parentId) } : {}),
      });
    }
    setNodes(flowNodes);
  }, [
    graphSyncKey,
    selectedGroupKey,
    selectedNodeKey,
    hidden,
    onToggleGroup,
  ]);

  useEffect(() => {
    if (nodeDragActiveRef.current) {
      const positions = {
        ...liveNodePositionsRef.current,
        ...pendingNodePositionsRef.current,
      };
      if (Object.keys(positions).length > 0) {
        const liveRouting = buildWorkflowRouting(
          documentWithNodePositions(document, positions),
          visibleNodeIds,
          routingCacheRef.current,
        );
        updateLiveEdges(liveRouting, new Set(Object.keys(positions)));
        updateLiveForkNodes(liveRouting);
      }
      return;
    }
    setEdges(toFlowEdges(document, routing, visibleNodeIds));
    // `routing` changes only when graph geometry or semantics change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    routing,
    toFlowEdges,
    updateLiveEdges,
    updateLiveForkNodes,
    visibleNodeIds,
  ]);

  useEffect(() => {
    if (fitSignal === 0) return;
    window.setTimeout(() => {
      void reactFlow.fitView({ padding: 0.2, duration: 300 });
    }, 30);
  }, [fitSignal, reactFlow]);

  const onNodesChange = useCallback(
    (changes: NodeChange<WorkflowFlowNode | GroupFlowNode>[]) => {
      setNodes((current) =>
        applyNodeChanges(
          changes.filter((change) => change.type !== "remove"),
          current,
        ),
      );
    },
    [],
  );

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) =>
      applyEdgeChanges(
        changes.filter((change) => change.type !== "remove"),
        current,
      ) as WorkflowFlowEdge[],
    );
  }, []);

  const handleSelectionChange = useCallback(
    ({
      nodes: selectedNodes,
      edges: selectedEdges,
    }: {
      nodes: Array<WorkflowFlowNode | GroupFlowNode>;
      edges: Edge[];
    }) => {
      const groups = selectedNodes
        .filter((node) => node.type === "group")
        .map((node) => semanticGroupId(node.id));
      const semanticNodes = selectedNodes
        .filter((node) => node.type === "workflow")
        .map((node) => node.id);
      const edgeIds = selectedEdges.map((edge) => edge.id);
      if (
        edgeIds.length === 0 &&
        semanticNodes.length === 0 &&
        groups.length === 0 &&
        selectedEdgeRef.current
      ) {
        const retainedId = selectedEdgeRef.current;
        selectionChangeRef.current(
          { kind: "edge", id: retainedId },
          [],
          [retainedId],
          [],
        );
        return;
      }
      selectedEdgeRef.current = edgeIds[0] ?? null;
      const primary: Selection =
        edgeIds.length > 0
          ? { kind: "edge", id: edgeIds[0] }
          : semanticNodes.length > 0
            ? { kind: "node", id: semanticNodes[0] }
            : groups.length > 0
              ? { kind: "group", id: groups[0] }
              : { kind: "none" };
      selectionChangeRef.current(primary, semanticNodes, edgeIds, groups);
    },
    [],
  );

  const toGlobal = (flowNode: WorkflowFlowNode | GroupFlowNode): Point => {
    const parentId = flowNode.parentId
      ? semanticGroupId(flowNode.parentId)
      : undefined;
    const parent = parentId ? document.layout.groups[parentId] : null;
    return {
      x: flowNode.position.x + (parent?.x ?? 0),
      y: flowNode.position.y + (parent?.y ?? 0),
    };
  };

  const handleNodeDragStop = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      flowNode: WorkflowFlowNode | GroupFlowNode,
    ) => {
      const position = toGlobal(flowNode);
      if (nodeDragFrameRef.current !== null) {
        window.cancelAnimationFrame(nodeDragFrameRef.current);
        nodeDragFrameRef.current = null;
      }
      pendingNodePositionsRef.current = {};
      liveNodePositionsRef.current = {};
      nodeDragActiveRef.current = false;
      if (flowNode.type === "group") {
        const id = semanticGroupId(flowNode.id);
        onApply((current) => moveGroup(current, id, position), false);
        finishRealtime();
        return;
      }
      const removeFromGroup =
        "altKey" in _event && _event.altKey;
      onApply((current) => {
        const moved = moveNodes(current, { [flowNode.id]: position });
        return removeFromGroup
          ? removeNodeFromGroup(moved, flowNode.id)
          : moved;
      }, false);
      finishRealtime();
    },
    // `toGlobal` reads the current document and flow event payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [document, finishRealtime, onApply],
  );

  const handleNodeDragStart = useCallback(() => {
    nodeDragActiveRef.current = true;
    liveNodePositionsRef.current = {};
    beginRealtime();
    onCheckpoint();
  }, [beginRealtime, onCheckpoint]);

  const handleNodeDrag = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      flowNode: WorkflowFlowNode | GroupFlowNode,
    ) => {
      if (flowNode.type === "group") return;
      pendingNodePositionsRef.current[flowNode.id] = toGlobal(flowNode);
      if (nodeDragFrameRef.current !== null) return;
      nodeDragFrameRef.current = window.requestAnimationFrame(() => {
        nodeDragFrameRef.current = null;
        const startedAt = performance.now();
        const positions = pendingNodePositionsRef.current;
        pendingNodePositionsRef.current = {};
        Object.assign(liveNodePositionsRef.current, positions);
        const liveDocument = documentWithNodePositions(document, positions);
        const liveRouting = buildWorkflowRouting(
          liveDocument,
          visibleNodeIds,
          routingCacheRef.current,
        );
        updateLiveEdges(liveRouting, new Set(Object.keys(positions)));
        updateLiveForkNodes(liveRouting);
        noteFrameCost(startedAt);
      });
    },
    // `toGlobal` follows the active document being dragged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      document,
      noteFrameCost,
      updateLiveEdges,
      updateLiveForkNodes,
      visibleNodeIds,
    ],
  );

  const openContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      const flow = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const menuWidth = 198;
      const menuHeight = 360;
      setContextMenu({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
        flow,
      });
    },
    [reactFlow],
  );

  const createNodeFromContextMenu = useCallback(
    (type: NodeKind | "milestone", title: string) => {
      if (!contextMenu) return;
      const milestone = type === "milestone";
      const node = {
        ...createNode(title, contextMenu.flow, milestone ? "task" : type),
        ...(milestone ? { milestone: { label: "里程碑" } } : {}),
      };
      onApply(
        (current) => withNode(current, node, contextMenu.flow),
        true,
      );
      onSelectionChange(
        { kind: "node", id: node.id },
        [node.id],
        [],
        [],
      );
      setContextMenu(null);
    },
    [contextMenu, onApply, onSelectionChange],
  );

  return (
    <div
      ref={canvasRef}
      className="canvas-shell"
      onContextMenu={(event) => event.preventDefault()}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onNodeDoubleClick={(_event, node) => {
          if (
            node.type === "workflow" &&
            node.data.node.type !== "fork"
          ) {
            onEditNode(node.id);
          }
        }}
        onEdgeClick={(_event, edge) => {
          onSelectionChange(
            { kind: "edge", id: edge.id },
            [],
            [edge.id],
            [],
          );
        }}
        onPaneClick={() => {
          setContextMenu(null);
          selectedEdgeRef.current = null;
          onSelectionChange({ kind: "none" }, [], [], []);
        }}
        onPaneContextMenu={openContextMenu}
        onSelectionChange={handleSelectionChange}
        onMoveEnd={(_event, viewport) => onViewportChange(viewport)}
        colorMode={document.display.theme === "dark" ? "dark" : "light"}
        minZoom={0.2}
        maxZoom={2}
        snapToGrid
        snapGrid={[10, 10]}
        selectionOnDrag={false}
        selectionKeyCode="Shift"
        panOnDrag
        deleteKeyCode={null}
        multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        proOptions={{ hideAttribution: true }}
        defaultViewport={document.layout.viewport}
        aria-label="工作流画布"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color={
            document.display.theme === "dark" ? "#4a5048" : "#d8d3c8"
          }
        />
        <Controls showInteractive={false} position="bottom-right" />
        <ViewportPortal>
          {Object.values(routing.branches).map((branch) => {
            if (!branch.visible) return null;
            return (
              <div key={branch.id} className="bundle-overlay">
                <svg className="bundle-trunk-hit-layer" aria-hidden="true">
                  <path
                    d={branch.trunkPath}
                    className="bundle-trunk-hit-path"
                    onPointerDown={(event) =>
                      handleTrunkPointerDown(branch.bundleId, event)
                    }
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onEditBranches(branch.bundleId);
                    }}
                  />
                </svg>
                {branch.label ? (
                  <button
                    className="bundle-label has-label"
                    style={{
                      transform: `translate(-50%, -50%) translate(${branch.labelPoint.x}px, ${branch.labelPoint.y}px)`,
                    }}
                    onPointerDown={(event) =>
                      handleTrunkPointerDown(branch.bundleId, event)
                    }
                    onClick={() => onEditBranches(branch.bundleId)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onEditBranches(branch.bundleId);
                    }}
                    title="编辑束标签和分支条件"
                  >
                    {branch.label}
                  </button>
                ) : null}
              </div>
            );
          })}
          {connectionDraft ? (
            <>
              <svg className="connection-preview-layer" aria-hidden="true">
                <path
                  className="connection-preview-path"
                  d={connectionDraft.path}
                />
              </svg>
              {connectionDraft.targetId
                ? (() => {
                    const target =
                      document.layout.nodes[connectionDraft.targetId];
                    return target ? (
                      <div
                        className="connection-target-outline"
                        style={{
                          transform: `translate(${target.x}px, ${target.y}px)`,
                          width: target.width,
                          height: target.height,
                        }}
                      />
                    ) : null;
                  })()
                : null}
            </>
          ) : null}
          {edgeBranchDraft ? (
            <>
              <svg className="connection-preview-layer" aria-hidden="true">
                <path
                  className="connection-preview-path edge-branch-preview"
                  d={edgeBranchDraft.path}
                />
              </svg>
              <div
                className="edge-break-preview"
                style={{
                  transform: `translate(-50%, -50%) translate(${edgeBranchDraft.breakPoint.x}px, ${edgeBranchDraft.breakPoint.y}px)`,
                }}
              >
                未命名节点
              </div>
              {edgeBranchDraft.targetId ? (() => {
                const target =
                  document.layout.nodes[edgeBranchDraft.targetId];
                return target ? (
                  <div
                    className="connection-target-outline"
                    style={{
                      transform: `translate(${target.x}px, ${target.y}px)`,
                      width: target.width,
                      height: target.height,
                    }}
                  />
                ) : null;
              })() : (
                <div
                  className="edge-insert-preview"
                  style={{
                    transform: `translate(-50%, -50%) translate(${edgeBranchDraft.pointer.x}px, ${edgeBranchDraft.pointer.y}px)`,
                  }}
                >
                  未命名节点
                </div>
              )}
            </>
          ) : null}
        </ViewportPortal>
        {document.nodes.length === 0 && document.groups.length === 0 ? (
          <div className="canvas-empty-guide">
            <div className="empty-guide-mark">+</div>
            <strong>在空白处右键创建第一个节点</strong>
            <span>
              按住空白拖动平移画布 · Shift + 拖动框选 · 滚轮缩放
            </span>
          </div>
        ) : null}
      </ReactFlow>
      <div className="canvas-navigation-hint">
        <span>左键拖动空白：平移</span>
        <span>Shift + 拖动：框选</span>
        <span>滚轮：缩放</span>
      </div>
      {contextMenu ? (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
        >
          <button role="menuitem" onClick={() => createNodeFromContextMenu("task", "未命名节点")}>
            新建节点
            <kbd>Tab</kbd>
          </button>
          <button role="menuitem" onClick={() => createNodeFromContextMenu("decision", "新判断")}>
            新建判断
          </button>
          <button role="menuitem" onClick={() => createNodeFromContextMenu("start", "开始")}>
            新建开始
          </button>
          <button role="menuitem" onClick={() => createNodeFromContextMenu("fork", "")}>
            新建分叉点
          </button>
          <button role="menuitem" onClick={() => createNodeFromContextMenu("end", "结束")}>
            新建结束
          </button>
          <button role="menuitem" onClick={() => createNodeFromContextMenu("milestone", "新里程碑")}>
            新建里程碑
          </button>
          <button role="menuitem" onClick={() => createNodeFromContextMenu("note", "备注")}>
            新建备注
          </button>
          <span className="context-menu-divider" />
          <button
            role="menuitem"
            disabled={externalNodeIds.length === 0}
            onClick={() => {
              onCreateGroup();
              setContextMenu(null);
            }}
          >
            从选择创建分组
            <kbd>G</kbd>
          </button>
        </div>
      ) : null}
      {edgeContextMenu ? (
        <div
          className="context-menu edge-context-menu"
          style={{ left: edgeContextMenu.x, top: edgeContextMenu.y }}
          role="menu"
        >
          <button
            role="menuitem"
            onClick={() => {
              const route = routing.routes[edgeContextMenu.edgeId];
              const splitProgress = route
                ? progressAlongRoute(edgeContextMenu.flow, route)
                : 0.5;
              const labelProgress = route
                ? progressAlongRoute(route.labelPoint, route)
                : 0.5;
              const result = splitEdge(
                document,
                edgeContextMenu.edgeId,
                edgeContextMenu.flow,
                labelProgress <= splitProgress ? "source" : "target",
              );
              onApply(() => result.document, true);
              setEdgeContextMenu(null);
              if (result.insertedNodeId) {
                selectionChangeRef.current(
                  { kind: "node", id: result.insertedNodeId },
                  [result.insertedNodeId],
                  [],
                  [],
                );
                onEditNode(result.insertedNodeId);
              }
            }}
          >
            插入节点
            <kbd>拆分线段</kbd>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

