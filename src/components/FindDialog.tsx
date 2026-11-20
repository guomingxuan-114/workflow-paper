import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { WorkflowDocument } from "../core/types";
import { Modal } from "./Modal";

interface FindDialogProps {
  document: WorkflowDocument;
  onSelect: (nodeId: string) => void;
  onClose: () => void;
}

export function FindDialog({ document, onSelect, onClose }: FindDialogProps) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return document.nodes.slice(0, 12);
    return document.nodes.filter((node) =>
      [node.title, node.description, node.tags.join(" "), node.id]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [document.nodes, query]);

  return (
    <Modal title="查找节点" eyebrow="Cmd/Ctrl + F" onClose={onClose}>
      <div className="find-input">
        <Search size={17} />
        <input
          autoFocus
          value={query}
          placeholder="标题、描述、标签或 ID"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) {
              onSelect(matches[0].id);
              onClose();
            }
          }}
        />
      </div>
      <div className="find-results">
        {matches.map((node) => (
          <button
            key={node.id}
            onClick={() => {
              onSelect(node.id);
              onClose();
            }}
          >
            <span>
              <strong>{node.title}</strong>
              <small>
                {node.description ||
                  (node.type === "task"
                    ? "节点"
                    : node.type === "fork"
                      ? "分叉点"
                      : node.type)}
              </small>
            </span>
            <kbd>
              {node.type === "task"
                ? "节点"
                : node.type === "fork"
                  ? "分叉点"
                  : node.type}
            </kbd>
          </button>
        ))}
        {matches.length === 0 ? <p className="find-empty">没有匹配节点。</p> : null}
      </div>
    </Modal>
  );
}

