import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Layers,
  PanelRightClose,
  Trash2,
  X,
} from "lucide-react";
import type {
  NodeKind,
  Selection,
  WorkflowDocument,
  WorkflowNode,
} from "../core/types";

interface InspectorProps {
  document: WorkflowDocument;
  selection: Selection;
  onUpdateNode: (id: string, patch: Partial<WorkflowNode>) => void;
  onUpdateEdge: (id: string, label: string) => void;
  onUpdateGroup: (
    id: string,
    patch: { title?: string; collapsed?: boolean; nodeIds?: string[] },
  ) => void;
  onToggleGroup: (id: string) => void;
  onDelete: (selection: Selection) => void;
  onDuplicate: () => void;
  onCreateGroup: () => void;
  onCollapsePanel: () => void;
  onCloseSelection: () => void;
}

const nodeKinds: Array<{ value: NodeKind; label: string }> = [
  { value: "start", label: "开始" },
  { value: "task", label: "步骤" },
  { value: "decision", label: "判断" },
  { value: "milestone", label: "里程碑" },
  { value: "end", label: "结束" },
  { value: "note", label: "备注" },
];

function NodeInspector({
  node,
  document,
  onUpdate,
  onDelete,
  onDuplicate,
  onCreateGroup,
  onClose,
}: {
  node: WorkflowNode;
  document: WorkflowDocument;
  onUpdate: (patch: Partial<WorkflowNode>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCreateGroup: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description);
  const [tags, setTags] = useState(node.tags.join(", "));
  const [type, setType] = useState<NodeKind>(node.type);
  const [sourceOpen, setSourceOpen] = useState(false);

  useEffect(() => {
    setTitle(node.title);
    setDescription(node.description);
    setTags(node.tags.join(", "));
    setType(node.type);
  }, [node]);

  const commit = () => {
    onUpdate({
      title: title.trim() || "未命名步骤",
      description,
      tags: tags
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      type,
    });
  };
  const containingGroup = document.groups.find((group) =>
    group.nodeIds.includes(node.id),
  );

  return (
    <>
      <div className="inspector-heading">
        <div>
          <div className="eyebrow">节点详情</div>
          <h2>{node.title}</h2>
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
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
        <label>
          描述
          <textarea
            value={description}
            rows={5}
            placeholder="补充输入、规则、产出或人工确认点"
            onChange={(event) => setDescription(event.target.value)}
            onBlur={commit}
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
            onChange={(event) => setTags(event.target.value)}
            onBlur={commit}
          />
        </label>
        <div className="field-readonly">
          <span>语义 ID</span>
          <code>{node.id}</code>
        </div>
        {containingGroup ? (
          <div className="field-readonly">
            <span>所属分组</span>
            <strong>{containingGroup.title}</strong>
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
          onUpdate={(patch) => props.onUpdateNode(node.id, patch)}
          onDelete={() => props.onDelete({ kind: "node", id: node.id })}
          onDuplicate={props.onDuplicate}
          onCreateGroup={props.onCreateGroup}
          onClose={props.onCloseSelection}
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
              onChange={(event) => setEdgeLabel(event.target.value)}
              onBlur={() => props.onUpdateEdge(edge.id, edgeLabel)}
            />
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
              onChange={(event) => setGroupTitle(event.target.value)}
              onBlur={() =>
                props.onUpdateGroup(group.id, {
                  title: groupTitle.trim() || "未命名分组",
                })
              }
            />
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

