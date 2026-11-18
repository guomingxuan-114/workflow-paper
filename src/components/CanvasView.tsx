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
  GROUP_PADDING,
  getHiddenNodeIds,
  moveGroup,
} from "../core/document";
import { createNode, withNode, connectNodes } from "../core/document";
import {
  buildWorkflowRouting,
  buildConnectionPreview,
  distanceToRoute,
} from "../core/edgeRouting";
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
    () => buildWorkflowRouting(document, visibleNodeIds),
    // Viewport-only changes must not rebuild persisted edge geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graphSyncKey, hidden, visibleNodeIds],
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
        onApply((current) => moveGroup(current, groupId, position), false);
      };
      const pointerUp = () => {
        window.removeEventListener("pointermove", pointerMove);
        window.removeEventListener("pointerup", pointerUp);
        window.removeEventListener("blur", pointerUp);
      };
      window.addEventListener("pointermove", pointerMove);
      window.addEventListener("pointerup", pointerUp, { once: true });
      window.addEventListener("blur", pointerUp, { once: true });
    },
    [document.layout.groups, onApply, onCheckpoint, reactFlow],
  );

  const handleNodeBorderPointerDown = useCallback(
    (
      sourceId: string,
      event: React.PointerEvent<HTMLDivElement>,
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
      selectionChangeRef.current(
        { kind: "node", id: sourceId },
        [sourceId],
        [],
        [],
      );
      setConnectionDraft({
        sourceId,
        pointer: start,
        path: startPreview.path,
      });

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
                connectNodes(current, sourceId, hovered, undefined, "manual"),
              true,
            );
            return;
          }

          const node = createNode("后续步骤", pointer, "task");
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
            return connectNodes(
              withGroup,
              sourceId,
              node.id,
              undefined,
              "manual",
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
  }, [document, handleEdgeSelect, reactFlow, routing]);

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
          onBorderPointerDown: handleNodeBorderPointerDown,
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
        .flatMap<WorkflowFlowEdge>((edge) => {
          const route = routing.routes[edge.id];
          if (!route) return [];
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
                path: route.path,
                labelPoint: route.labelPoint,
              },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 16,
                height: 16,
              },
              className: "workflow-edge",
              style: { strokeWidth: 1.5 },
            },
          ];
        }),
    );
  }, [
    graphSyncKey,
    selectedGroupKey,
    selectedNodeKey,
    hidden,
    handleEdgeSelect,
    handleGroupDragStart,
    handleNodeBorderPointerDown,
    onToggleGroup,
    parentByNode,
    routing,
    document.edges,
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
        onApply((current) => moveGroup(current, id, position), false);
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

  const openContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      const flow = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const menuWidth = 198;
      const menuHeight = 288;
      setContextMenu({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
        flow,
      });
    },
    [reactFlow],
  );

  const createNodeFromContextMenu = useCallback(
    (type: NodeKind, title: string) => {
      if (!contextMenu) return;
      const node = createNode(title, contextMenu.flow, type);
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
            const source = document.nodes.find(
              (node) => node.id === branch.sourceId,
            );
            return (
              <button
                key={branch.sourceId}
                className="branch-point nodrag nopan"
                style={{
                  transform: `translate(${branch.point.x}px, ${branch.point.y}px)`,
                }}
                aria-label={`编辑分支条件：${source?.title ?? branch.sourceId}`}
                title="编辑该节点的全部出口条件"
                onClick={(event) => {
                  event.stopPropagation();
                  onEditBranches(branch.sourceId);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onEditBranches(branch.sourceId);
                }}
              >
                {branch.edgeIds.length}
              </button>
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
          <button role="menuitem" onClick={() => createNodeFromContextMenu("task", "新步骤")}>
            新建步骤
            <kbd>Tab</kbd>
          </button>
          <button role="menuitem" onClick={() => createNodeFromContextMenu("decision", "新判断")}>
            新建判断
          </button>
          <button role="menuitem" onClick={() => createNodeFromContextMenu("milestone", "新里程碑")}>
            新建里程碑
          </button>
          <button role="menuitem" onClick={() => createNodeFromContextMenu("end", "结束")}>
            新建结束
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

