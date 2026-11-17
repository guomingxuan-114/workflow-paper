import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  FileJson2,
  GitCompareArrows,
  LayoutTemplate,
  Plus,
  TriangleAlert,
} from "lucide-react";
import type {
  VersionDiff,
  WorkflowDocument,
  WorkflowNode,
} from "../core/types";
import { Modal } from "./Modal";

export function ContentEditorDialog({
  node,
  onSave,
  onClose,
}: {
  node: WorkflowNode;
  onSave: (patch: Partial<WorkflowNode>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description);
  return (
    <Modal
      title="编辑节点内容"
      eyebrow="双击或按 E"
      onClose={onClose}
      footer={
        <>
          <span className="modal-hint">Esc 取消 · Ctrl/Cmd + Enter 保存</span>
          <button className="button button--quiet" onClick={onClose}>
            取消
          </button>
          <button
            className="button button--primary"
            onClick={() => {
              onSave({
                title: title.trim() || "未命名步骤",
                description,
              });
              onClose();
            }}
          >
            保存内容
          </button>
        </>
      }
    >
      <div
        className="content-editor"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            onSave({
              title: title.trim() || "未命名步骤",
              description,
            });
            onClose();
          }
        }}
      >
        <label>
          标题
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          描述
          <textarea
            rows={7}
            value={description}
            placeholder="写清输入、规则、输出和需要人工判断的地方。"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="content-editor-meta">
          <span>{title.length} 字标题</span>
          <span>{description.length} 字描述</span>
          <span>ID 保持不变</span>
        </div>
      </div>
    </Modal>
  );
}

export function TemplateDialog({
  onChoose,
  onClose,
}: {
  onChoose: (kind: "approval" | "incident") => void;
  onClose: () => void;
}) {
  return (
    <Modal title="从模板开始" eyebrow="可继续编辑" onClose={onClose} wide>
      <div className="template-grid">
        <button onClick={() => onChoose("approval")}>
          <span className="template-preview template-preview--approval">
            <i />
            <i />
            <i />
          </span>
          <strong>费用审批</strong>
          <p>提交、直属主管审批、财务复核与归档。</p>
          <span className="template-use">
            使用模板 <ArrowRight size={14} />
          </span>
        </button>
        <button onClick={() => onChoose("incident")}>
          <span className="template-preview template-preview--incident">
            <i />
            <i />
            <i />
          </span>
          <strong>线上故障响应</strong>
          <p>从告警确认到修复、回滚和复盘的标准分支。</p>
          <span className="template-use">
            使用模板 <ArrowRight size={14} />
          </span>
        </button>
      </div>
    </Modal>
  );
}

export function ErrorDialog({
  title,
  message,
  issues,
  onClose,
}: {
  title: string;
  message: string;
  issues?: string[];
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      eyebrow="无法继续"
      onClose={onClose}
      footer={
        <button className="button button--primary" onClick={onClose}>
          知道了
        </button>
      }
    >
      <div className="error-summary">
        <TriangleAlert size={20} />
        <p>{message}</p>
      </div>
      {issues && issues.length > 0 ? (
        <ul className="error-issues">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}

export function RecoveryDialog({
  document,
  fileName,
  savedAt,
  onRecover,
  onDiscard,
}: {
  document: WorkflowDocument;
  fileName: string | null;
  savedAt: string;
  onRecover: () => void;
  onDiscard: () => void;
}) {
  return (
    <Modal
      title="发现未保存的编辑"
      eyebrow="崩溃恢复"
      onClose={onDiscard}
      footer={
        <>
          <button className="button button--quiet" onClick={onDiscard}>
            丢弃草稿
          </button>
          <button className="button button--primary" onClick={onRecover}>
            恢复工作流
          </button>
        </>
      }
    >
      <div className="recovery-card">
        <CheckCircle2 size={22} />
        <div>
          <strong>{document.metadata.title}</strong>
          <p>
            {fileName ?? "未命名草稿"} · 最后缓存于{" "}
            {new Intl.DateTimeFormat("zh-CN", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(savedAt))}
          </p>
          <span>
            {document.nodes.length} 个节点、{document.edges.length} 条关系。
            恢复后的内容仍可正常编辑、保存与导出。
          </span>
        </div>
      </div>
    </Modal>
  );
}

export function ImportGuideDialog({
  onChooseFile,
  onUseSample,
  onClose,
}: {
  onChooseFile: () => void;
  onUseSample: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="导入程序版本快照" eyebrow="Import protocol v1" onClose={onClose}>
      <div className="import-guide">
        <div className="import-note">
          <FileJson2 size={22} />
          <div>
            <strong>只接受明确的结构化 JSON</strong>
            <p>
              初版不解析任意源码，也不执行导入内容。节点使用来源
              ID、版本和提交信息建立稳定映射。
            </p>
          </div>
        </div>
        <div className="import-actions">
          <button className="button button--primary" onClick={onChooseFile}>
            <FileJson2 size={16} />
            选择 JSON 文件
          </button>
          <button className="button button--quiet" onClick={onUseSample}>
            <LayoutTemplate size={16} />
            使用内置示例
          </button>
        </div>
        <pre>{`{
  "format": "workflow-import",
  "schemaVersion": 1,
  "version": { "label": "v1.4.0" },
  "source": { "id": "pipeline", "name": "发布程序" },
  "nodes": [{ "id": "build", "title": "构建" }],
  "edges": [],
  "groups": []
}`}</pre>
      </div>
    </Modal>
  );
}

function diffNodeTitle(node: WorkflowNode) {
  return node.title;
}

export function VersionDiffDialog({
  current,
  candidate,
  diff,
  onLoadCandidate,
  onChooseAnother,
  onClose,
}: {
  current: WorkflowDocument;
  candidate: WorkflowDocument;
  diff: VersionDiff;
  onLoadCandidate: () => void;
  onChooseAnother: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="版本对比"
      eyebrow={`${current.provenance.version ?? "当前"} → ${
        candidate.provenance.version ?? "待比较版本"
      }`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="button button--quiet" onClick={onChooseAnother}>
            选择其他快照
          </button>
          <button className="button button--primary" onClick={onLoadCandidate}>
            打开比较版本
          </button>
        </>
      }
    >
      <div className="diff-summary">
        <span className="diff-added">+{diff.added.length} 新增</span>
        <span className="diff-removed">-{diff.removed.length} 删除</span>
        <span className="diff-changed">~{diff.changed.length} 修改</span>
      </div>
      <div className="diff-columns">
        <section>
          <h3>
            <GitCompareArrows size={16} />
            新增节点
          </h3>
          {diff.added.map((node) => (
            <div className="diff-row diff-row--added" key={node.id}>
              <Plus size={13} />
              {diffNodeTitle(node)}
            </div>
          ))}
          {diff.added.length === 0 ? <p className="diff-empty">无</p> : null}
        </section>
        <section>
          <h3>删除节点</h3>
          {diff.removed.map((node) => (
            <div className="diff-row diff-row--removed" key={node.id}>
              <span>-</span>
              {diffNodeTitle(node)}
            </div>
          ))}
          {diff.removed.length === 0 ? <p className="diff-empty">无</p> : null}
        </section>
        <section>
          <h3>修改节点</h3>
          {diff.changed.map((entry) => (
            <div className="diff-row diff-row--changed" key={entry.id}>
              <span>~</span>
              <span>
                {diffNodeTitle(entry.after)}
                <small>{entry.fields.join("、")}</small>
              </span>
            </div>
          ))}
          {diff.changed.length === 0 ? <p className="diff-empty">无</p> : null}
        </section>
      </div>
    </Modal>
  );
}

export function ShortcutDialog({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    ["Tab / N", "在画布中新建步骤"],
    ["E / Enter", "编辑当前节点内容"],
    ["Delete", "删除所选节点、边或分组"],
    ["Cmd/Ctrl + Z", "撤销"],
    ["Cmd/Ctrl + Shift + Z", "重做"],
    ["Cmd/Ctrl + C / V", "复制与粘贴节点"],
    ["Cmd/Ctrl + S", "原子保存工作流"],
    ["Cmd/Ctrl + F", "查找节点"],
    ["Cmd/Ctrl + Shift + O", "切换画布与大纲"],
    ["Cmd/Ctrl + 0", "缩放至适应画布"],
  ];
  return (
    <Modal title="键盘操作" eyebrow="键鼠双通道编辑" onClose={onClose} wide>
      <div className="shortcut-grid">
        {shortcuts.map(([keys, action]) => (
          <div key={keys}>
            <kbd>{keys}</kbd>
            <span>{action}</span>
          </div>
        ))}
      </div>
      <p className="field-hint">
        鼠标拖动节点只改位置；从节点右侧圆点拖到空白创建后继，拖到已有节点建立关系；点击边线可编辑标签。
      </p>
    </Modal>
  );
}

