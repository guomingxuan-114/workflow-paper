import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type OnConnectEnd,
  type OnConnectStart,
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
  Point,
  Selection,
  WorkflowDocument,
} from "../core/types";
import {
  GROUP_PADDING,
  getHiddenNodeIds,
} from "../core/document";
import { createNode, withNode, connectNodes } from "../core/document";
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

function distanceToSegment(
  point: Point,
  start: Point,
  end: Point,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(
    point.x - (start.x + projection * dx),
    point.y - (start.y + projection * dy),
  );
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
  const connectionStart = useRef<{
    x: number;
    y: number;
    nodeId: string | null;
  } | null>(null);
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

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as Element;
      if (
        target.closest(
          ".react-flow__node-workflow, .react-flow__controls, .workflow-group",
        )
      ) {
        return;
      }
      const point = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const threshold = 15 / Math.max(0.2, reactFlow.getViewport().zoom);
      const edge = document.edges.find((candidate) => {
        const source = document.layout.nodes[candidate.source];
        const targetLayout = document.layout.nodes[candidate.target];
        if (!source || !targetLayout) return false;
        return (
          distanceToSegment(
            point,
            {
              x: source.x + source.width,
              y: source.y + source.height / 2,
            },
            {
              x: targetLayout.x,
              y: targetLayout.y + targetLayout.height / 2,
            },
          ) <= threshold
        );
      });
      if (!edge) return;
      event.preventDefault();
      event.stopPropagation();
      lastEdgePointerRef.current = { id: edge.id, at: Date.now() };
      handleEdgeSelect(edge.id);
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
  }, [document, handleEdgeSelect, reactFlow]);

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
        },
        style: {
          width: group.collapsed ? 286 : Math.max(300, layout?.width ?? 360),
          height: group.collapsed ? 82 : Math.max(170, layout?.height ?? 240),
          zIndex: -10,
        },
        selected: groupSelection.has(groupFlowId(group.id)),
        draggable: true,
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
      const parentId = parentByNode.get(node.id);
      const parentLayout = parentId
        ? document.layout.groups[parentId]
        : null;
      flowNodes.push({
        id: node.id,
        type: "workflow",
        position: {
          x: layout.x - (parentLayout?.x ?? 0),
          y: layout.y - (parentLayout?.y ?? 0),
        },
        data: {
          node,
          showDescription: document.display.showDescriptions,
        },
        selected: nodeSelection.has(node.id),
        draggable: true,
        selectable: true,
        ...(parentId ? { parentId: groupFlowId(parentId) } : {}),
      });
    }
    setNodes(flowNodes);
    setEdges(
      document.edges
        .filter((edge) => !hidden.has(edge.source) && !hidden.has(edge.target))
        .map<WorkflowFlowEdge>((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "workflowEdge",
          data: { label: edge.label, onSelect: handleEdgeSelect },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          className: "workflow-edge",
          style: { strokeWidth: 1.5 },
        })),
    );
  }, [
    graphSyncKey,
    selectedGroupKey,
    selectedNodeKey,
    hidden,
    handleEdgeSelect,
    onToggleGroup,
    parentByNode,
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
      if (flowNode.type === "group") {
        const id = semanticGroupId(flowNode.id);
        onApply((current) => ({
          ...current,
          layout: {
            ...current.layout,
            groups: {
              ...current.layout.groups,
              [id]: {
                ...current.layout.groups[id],
                ...position,
              },
            },
          },
        }), false);
        return;
      }
      onApply((current) => ({
        ...current,
        layout: {
          ...current.layout,
          nodes: {
            ...current.layout.nodes,
            [flowNode.id]: {
              ...current.layout.nodes[flowNode.id],
              ...position,
            },
          },
        },
      }), false);
    },
    // `toGlobal` reads the current document and flow event payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [document, onApply],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      onApply(
        (current) =>
          connectNodes(
            current,
            connection.source!,
            connection.target!,
            undefined,
            "manual",
          ),
        true,
      );
    },
    [onApply],
  );

  const onConnectStart: OnConnectStart = useCallback((event, params) => {
    connectionStart.current = {
      x: "clientX" in event ? event.clientX : 0,
      y: "clientY" in event ? event.clientY : 0,
      nodeId: params.nodeId,
    };
  }, []);

  const onConnectEnd: OnConnectEnd = useCallback(
    (event) => {
      const start = connectionStart.current;
      connectionStart.current = null;
      if (!start?.nodeId) return;
      const clientX = "clientX" in event ? event.clientX : start.x;
      const clientY = "clientY" in event ? event.clientY : start.y;
      if (Math.hypot(clientX - start.x, clientY - start.y) < 28) return;
      if (document.groups.some((group) => groupFlowId(group.id) === start.nodeId)) {
        return;
      }
      const flowPosition = reactFlow.screenToFlowPosition({
        x: clientX,
        y: clientY,
      });
      const parent = parentByNode.get(start.nodeId);
      const parentLayout = parent ? document.layout.groups[parent] : null;
      const position = parentLayout
        ? { x: flowPosition.x - parentLayout.x, y: flowPosition.y - parentLayout.y }
        : flowPosition;
      // React Flow reports a successful target connection through onConnect.
      // A drop at least 28px away lands here and creates a successor.
      const target = document.nodes.find((node) => {
        const layout = document.layout.nodes[node.id];
        return (
          layout &&
          flowPosition.x >= layout.x &&
          flowPosition.x <= layout.x + layout.width &&
          flowPosition.y >= layout.y &&
          flowPosition.y <= layout.y + layout.height
        );
      });
      if (target) return;
      // React Flow is still finalizing its connection store in this event
      // stack. Commit on the next task so its controlled node state can settle.
      window.setTimeout(() => {
        if (parent && parentLayout) {
          const node = createNode(
            "后续步骤",
            { x: position.x, y: position.y },
            "task",
          );
          onApply((current) => {
            const withNewNode = withNode(current, node, {
              x: flowPosition.x,
              y: flowPosition.y,
            });
            return {
              ...withNewNode,
              groups: withNewNode.groups.map((group) =>
                group.id === parent
                  ? { ...group, nodeIds: [...group.nodeIds, node.id] }
                  : group,
              ),
              edges: [
                ...withNewNode.edges,
                {
                  id: `edge-${node.id}`,
                  source: start.nodeId!,
                  target: node.id,
                  origin: "manual" as const,
                },
              ],
            };
          }, true);
        } else {
          const node = createNode(
            "后续步骤",
            { x: flowPosition.x, y: flowPosition.y },
            "task",
          );
          onApply((current) => {
            const withNewNode = withNode(current, node, {
              x: flowPosition.x,
              y: flowPosition.y,
            });
            return connectNodes(
              withNewNode,
              start.nodeId!,
              node.id,
              undefined,
              "manual",
            );
          }, true);
        }
      }, 0);
    },
    [document, onApply, parentByNode, reactFlow],
  );

  const openContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      const flow = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setContextMenu({ x: event.clientX, y: event.clientY, flow });
    },
    [reactFlow],
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
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDragStart={onCheckpoint}
        onNodeDragStop={handleNodeDragStop}
        onNodeDoubleClick={(_event, node) => {
          if (node.type === "workflow") onEditNode(node.id);
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
          color="#d8d3c8"
        />
        <Controls showInteractive={false} position="bottom-right" />
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
          <button
            role="menuitem"
            onClick={() => {
              const node = createNode(
                "新步骤",
                contextMenu.flow,
                document.nodes.length === 0 ? "start" : "task",
              );
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
            }}
          >
            新建步骤
            <kbd>Tab</kbd>
          </button>
          <button
            role="menuitem"
            disabled={externalNodeIds.length === 0}
            onClick={() => {
              setContextMenu(null);
            }}
          >
            从选择创建分组
            <kbd>G</kbd>
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

