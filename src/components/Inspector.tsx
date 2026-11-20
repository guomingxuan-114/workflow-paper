import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Layers,
  PanelRightClose,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type {
  NodeKind,
  Selection,
  WorkflowDocument,
  WorkflowNode,
} from "../core/types";
import { nodeMetrics } from "../core/nodeShapes";

interface InspectorProps {
  document: WorkflowDocument;
  selection: Selection;
  onUpdateNode: (
    id: string,
    patch: Partial<WorkflowNode>,
    liveKey?: string,
  ) => void;
  onResizeNode: (
    id: string,
    width: number,
    height: number,
    liveKey?: string,
  ) => void;
  onUpdateEdge: (
    id: string,
    patch: { label?: string; important?: boolean },
    liveKey?: string,
  ) => void;
  onUpdateGroup: (
    id: string,
    patch: {
      title?: string;
      collapsed?: boolean;
      nodeIds?: string[];
      important?: boolean;
    },
    liveKey?: string,
  ) => void;
  onEndLiveEdit: () => void;
  onToggleGroup: (id: string) => void;
  onDelete: (selection: Selection) => void;
  onDuplicate: () => void;
  onCreateGroup: () => void;
  onRemoveFromGroup: (nodeId: string) => void;
  onCollapsePanel: () => void;
  onCloseSelection: () => void;
}

const nodeKinds: Array<{ value: NodeKind; label: string }> = [
  { value: "start", label: "开始" },
  { value: "fork", label: "分叉点" },
  { value: "end", label: "结束" },
  { value: "task", label: "节点" },
  { value: "decision", label: "判断" },
  { value: "note", label: "备注" },
];

function NodeInspector({
  node,
  document,
  onUpdate,
  onResize,
  onDelete,
  onDuplicate,
  onCreateGroup,
  onRemoveFromGroup,
  onClose,
  onEndLiveEdit,
}: {
  node: WorkflowNode;
  document: WorkflowDocument;
  onUpdate: (patch: Partial<WorkflowNode>, liveKey?: string) => void;
  onResize: (width: number, height: number, liveKey?: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCreateGroup: () => void;
  onRemoveFromGroup: () => void;
  onClose: () => void;
  onEndLiveEdit: () => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description);
  const [tags, setTags] = useState(node.tags.join(", "));
  const [type, setType] = useState<NodeKind>(node.type);
  const [milestoneLabel, setMilestoneLabel] = useState(
    node.milestone?.label ?? "",
  );
  const layout = document.layout.nodes[node.id];
  const metrics = nodeMetrics(node);
  const [width, setWidth] = useState(layout?.width ?? metrics.width);
  const [height, setHeight] = useState(layout?.height ?? metrics.height);
  const [sourceOpen, setSourceOpen] = useState(false);
  const sizeTimerRef = useRef<number | null>(null);
  const titleKey = `node:${node.id}:title`;
  const descriptionKey = `node:${node.id}:description`;
  const tagsKey = `node:${node.id}:tags`;
  const milestoneKey = `node:${node.id}:milestone-label`;
  const sizeKey = `node:${node.id}:size`;

  useEffect(() => {
    setTitle(node.title);
    setDescription(node.description);
    setTags(node.tags.join(", "));
    setType(node.type);
    setMilestoneLabel(node.milestone?.label ?? "");
    setWidth(layout?.width ?? nodeMetrics(node).width);
    setHeight(layout?.height ?? nodeMetrics(node).height);
  }, [layout?.height, layout?.width, node]);

  const parseTags = (value: string) =>
    value
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  const containingGroup = document.groups.find((group) =>
    group.nodeIds.includes(node.id),
  );
  const commitTitle = () => {
    const normalized =
      node.type === "fork"
        ? title.trim()
        : title.trim() || "未命名节点";
    setTitle(normalized);
    onUpdate({ title: normalized }, titleKey);
    onEndLiveEdit();
  };
  const commitMilestoneLabel = () => {
    if (!node.milestone) return;
    onUpdate(
      {
        milestone: {
          ...node.milestone,
          label: milestoneLabel.trim(),
        },
      },
      milestoneKey,
    );
    onEndLiveEdit();
  };
  const scheduleSize = (nextWidth: number, nextHeight: number) => {
    if (sizeTimerRef.current !== null) {
      window.clearTimeout(sizeTimerRef.current);
    }
    sizeTimerRef.current = window.setTimeout(() => {
      sizeTimerRef.current = null;
      const currentLayout = document.layout.nodes[node.id];
      onResize(
        Number.isFinite(nextWidth)
          ? nextWidth
          : currentLayout?.width ?? metrics.width,
        Number.isFinite(nextHeight)
          ? nextHeight
          : currentLayout?.height ?? metrics.height,
        sizeKey,
      );
    }, 100);
  };
  const commitSize = () => {
    if (sizeTimerRef.current !== null) {
      window.clearTimeout(sizeTimerRef.current);
      sizeTimerRef.current = null;
    }
    const currentLayout = document.layout.nodes[node.id];
    const validWidth = Number.isFinite(width)
      ? width
      : currentLayout?.width ?? metrics.width;
    const validHeight = Number.isFinite(height)
      ? height
      : currentLayout?.height ?? metrics.height;
    setWidth(validWidth);
    setHeight(validHeight);
    onResize(validWidth, validHeight, sizeKey);
    onEndLiveEdit();
  };

  if (node.type === "fork") {
    return (
      <>
        <div className="inspector-heading">
          <div>
            <div className="eyebrow">分叉点详情</div>
            <h2>{node.title || "分叉点"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="取消选择">
            <X size={17} />
          </button>
        </div>
        <div className="inspector-fields">
          <label>
            标题
            <input
              value={title}
              placeholder="填写分叉点名称"
              onChange={(event) => {
                setTitle(event.target.value);
                onUpdate({ title: event.target.value }, titleKey);
              }}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
          <label>
            类型
            <select
              value={type}
              onChange={(event) => {
                const value = event.target.value as NodeKind;
                setType(value);
                onUpdate({ type: value });
              }}
            >
              {nodeKinds.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </select>
          </label>
          <div className="field-readonly">
            <span>出边数量</span>
            <strong>{document.edges.filter((edge) => edge.source === node.id).length}</strong>
          </div>
          <p className="field-hint">
            分叉点随分支束自动生成；从跑道边框拖出即可增加分支。
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="inspector-heading">
        <div>
          <div className="eyebrow">节点详情</div>
          <h2>{node.title || "未命名节点"}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="取消选择">
          <X size={17} />
        </button>
      </div>
      <div className="inspector-fields">
        <label>
          标题
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              onUpdate({ title: event.target.value }, titleKey);
            }}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
        <div className="inspector-toggles">
          <label>
            <input
              type="checkbox"
              checked={Boolean(node.milestone)}
              onChange={(event) =>
                onUpdate({
                  milestone: event.target.checked
                    ? { label: milestoneLabel || "里程碑" }
                    : undefined,
                })
              }
            />
            里程碑
          </label>
          <label>
            <input
              type="checkbox"
              checked={Boolean(node.important)}
              onChange={(event) =>
                onUpdate({ important: event.target.checked })
              }
            />
            重要
          </label>
        </div>
        {node.milestone ? (
          <label>
            里程碑标记
            <input
              value={milestoneLabel}
              placeholder="例如：M1 或 发布完成"
              onChange={(event) => {
                setMilestoneLabel(event.target.value);
                onUpdate({
                  milestone: {
                    ...node.milestone,
                    label: event.target.value,
                  },
                }, milestoneKey);
              }}
              onBlur={commitMilestoneLabel}
            />
          </label>
        ) : null}
        <label>
          描述
          <textarea
            value={description}
            rows={5}
            placeholder="补充输入、规则、产出或人工确认点"
            onChange={(event) => {
              setDescription(event.target.value);
              onUpdate(
                { description: event.target.value },
                descriptionKey,
              );
            }}
            onBlur={onEndLiveEdit}
          />
        </label>
        <label>
          类型
          <select
            value={type}
            onChange={(event) => {
              const value = event.target.value as NodeKind;
              setType(value);
              onUpdate({ type: value });
            }}
          >
            {nodeKinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          标签
          <input
            value={tags}
            placeholder="以逗号分隔"
            onChange={(event) => {
              setTags(event.target.value);
              onUpdate(
                { tags: parseTags(event.target.value) },
                tagsKey,
              );
            }}
            onBlur={onEndLiveEdit}
          />
        </label>
        <div className="node-size-grid">
          <label>
            宽度
            <input
              aria-label="节点宽度"
              type="number"
              min={metrics.minWidth}
              step={10}
              value={width}
              onChange={(event) => {
                setWidth(event.target.valueAsNumber);
                scheduleSize(event.target.valueAsNumber, height);
              }}
              onBlur={commitSize}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <small>最小 {metrics.minWidth}px · 10px 吸附</small>
          </label>
          <label>
            高度
            <input
              aria-label="节点高度"
              type="number"
              min={metrics.minHeight}
              step={10}
              value={height}
              onChange={(event) => {
                setHeight(event.target.valueAsNumber);
                scheduleSize(width, event.target.valueAsNumber);
              }}
              onBlur={commitSize}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <small>最小 {metrics.minHeight}px · 10px 吸附</small>
          </label>
        </div>
        <div className="field-readonly">
          <span>语义 ID</span>
          <code>{node.id}</code>
        </div>
        {containingGroup ? (
          <div className="field-readonly">
            <span>所属分组</span>
            <strong>{containingGroup.title}</strong>
            <button
              className="text-button"
              onClick={onRemoveFromGroup}
            >
              移出
            </button>
          </div>
        ) : null}
        <button
          className="disclosure"
          onClick={() => setSourceOpen((value) => !value)}
        >
          {sourceOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          来源信息
        </button>
        {sourceOpen ? (
          <div className="source-block">
            <div>
              <span>来源</span>
              <strong>
                {node.origin.kind === "import"
                  ? node.origin.system
                  : "手工创建"}
              </strong>
            </div>
            {node.origin.kind === "import" ? (
              <>
                <div>
                  <span>版本</span>
                  <strong>{node.origin.version}</strong>
                </div>
                <div>
                  <span>原始 ID</span>
                  <code>{node.origin.originalId}</code>
                </div>
                {node.origin.commit ? (
                  <div>
                    <span>提交</span>
                    <code>{node.origin.commit}</code>
                  </div>
                ) : null}
              </>
            ) : null}
            {node.source?.file ? (
              <div>
                <span>文件</span>
                <code>{node.source.file}</code>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="inspector-actions">
        <button onClick={onDuplicate}>
          <Copy size={15} />
          复制
        </button>
        <button onClick={onCreateGroup} disabled={false}>
          <Layers size={15} />
          建分组
        </button>
        <button className="danger" onClick={onDelete}>
          <Trash2 size={15} />
          删除
        </button>
      </div>
    </>
  );
}

export function Inspector(props: InspectorProps) {
  const selectedId =
    props.selection.kind === "none" ? undefined : props.selection.id;
  const node = useMemo(
    () =>
      props.selection.kind === "node"
        ? props.document.nodes.find((item) => item.id === selectedId)
        : undefined,
    [props.document.nodes, props.selection.kind, selectedId],
  );
  const edge = useMemo(
    () =>
      props.selection.kind === "edge"
        ? props.document.edges.find((item) => item.id === selectedId)
        : undefined,
    [props.document.edges, props.selection.kind, selectedId],
  );
  const group = useMemo(
    () =>
      props.selection.kind === "group"
        ? props.document.groups.find((item) => item.id === selectedId)
        : undefined,
    [props.document.groups, props.selection.kind, selectedId],
  );
  const [edgeLabel, setEdgeLabel] = useState(edge?.label ?? "");
  const [groupTitle, setGroupTitle] = useState(group?.title ?? "");

  useEffect(() => setEdgeLabel(edge?.label ?? ""), [edge]);
  useEffect(() => setGroupTitle(group?.title ?? ""), [group]);

  return (
    <aside className="inspector">
      <button
        className="inspector-collapse"
        onClick={props.onCollapsePanel}
        aria-label="收起详情栏"
      >
        <PanelRightClose size={17} />
      </button>
      {node ? (
        <NodeInspector
          node={node}
          document={props.document}
          onUpdate={(patch, liveKey) =>
            props.onUpdateNode(node.id, patch, liveKey)
          }
          onResize={(width, height, liveKey) =>
            props.onResizeNode(node.id, width, height, liveKey)
          }
          onDelete={() => props.onDelete({ kind: "node", id: node.id })}
          onDuplicate={props.onDuplicate}
          onCreateGroup={props.onCreateGroup}
          onRemoveFromGroup={() => props.onRemoveFromGroup(node.id)}
          onClose={props.onCloseSelection}
          onEndLiveEdit={props.onEndLiveEdit}
        />
      ) : edge ? (
        <div className="inspector-fields">
          <div className="inspector-heading">
            <div>
              <div className="eyebrow">关系详情</div>
              <h2>编辑连线</h2>
            </div>
          </div>
          <label>
            连线标签
            <input
              value={edgeLabel}
              placeholder="例如：通过、拒绝、指标稳定"
              onChange={(event) => {
                setEdgeLabel(event.target.value);
                props.onUpdateEdge(
                  edge.id,
                  { label: event.target.value },
                  `edge:${edge.id}:label`,
                );
              }}
              onBlur={() => {
                const label = edgeLabel.trim();
                setEdgeLabel(label);
                props.onUpdateEdge(
                  edge.id,
                  { label },
                  `edge:${edge.id}:label`,
                );
                props.onEndLiveEdit();
              }}
            />
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={Boolean(edge.important)}
              onChange={(event) =>
                props.onUpdateEdge(edge.id, {
                  important: event.target.checked,
                })
              }
            />
            <Star size={13} />
            标记为重要关系
          </label>
          <div className="field-readonly">
            <span>方向</span>
            <code>
              {edge.source} → {edge.target}
            </code>
          </div>
          <p className="field-hint">
            拖动节点只改变布局，不会改变这条关系的端点。
          </p>
          <button
            className="button danger-ghost"
            onClick={() => props.onDelete({ kind: "edge", id: edge.id })}
          >
            <Trash2 size={15} />
            删除关系
          </button>
        </div>
      ) : group ? (
        <div className="inspector-fields">
          <div className="inspector-heading">
            <div>
              <div className="eyebrow">分组详情</div>
              <h2>空间组织</h2>
            </div>
          </div>
          <label>
            分组名
            <input
              value={groupTitle}
              onChange={(event) => {
                setGroupTitle(event.target.value);
                props.onUpdateGroup(group.id, {
                  title: event.target.value,
                }, `group:${group.id}:title`);
              }}
              onBlur={() => {
                const title = groupTitle.trim() || "未命名分组";
                setGroupTitle(title);
                props.onUpdateGroup(
                  group.id,
                  { title },
                  `group:${group.id}:title`,
                );
                props.onEndLiveEdit();
              }}
            />
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={Boolean(group.important)}
              onChange={(event) =>
                props.onUpdateGroup(group.id, {
                  important: event.target.checked,
                })
              }
            />
            <Star size={13} />
            标记为重要分组
          </label>
          <div className="field-readonly">
            <span>成员</span>
            <strong>{group.nodeIds.length} 个节点</strong>
          </div>
          <button
            className="button"
            onClick={() => props.onToggleGroup(group.id)}
          >
            {group.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
            {group.collapsed ? "展开分组" : "折叠分组"}
          </button>
          <button
            className="button danger-ghost"
            onClick={() => props.onDelete({ kind: "group", id: group.id })}
          >
            <Trash2 size={15} />
            删除分组及成员
          </button>
        </div>
      ) : (
        <div className="inspector-empty">
          <div className="eyebrow">详情</div>
          <h2>选择一个对象</h2>
          <p>选中节点、连线或分组后，在这里编辑内容与来源。</p>
          <div className="inspector-empty-legend">
            <span>
              <i className="legend-node" />
              节点内容
            </span>
            <span>
              <i className="legend-edge" />
              关系标签
            </span>
            <span>
              <i className="legend-group" />
              分组组织
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}

