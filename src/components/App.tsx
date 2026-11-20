import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenText,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  FileDown,
  FilePlus2,
  FolderOpen,
  GitCompareArrows,
  Import,
  LayoutDashboard,
  ListTree,
  Maximize,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Redo2,
  Save,
  Search,
  Star,
  Sun,
  Undo2,
} from "lucide-react";
import { PRODUCT } from "../config/product";
import {
  connectNodes,
  createDocument,
  createNode,
  duplicateNodes,
  groupNodes,
  removeByIds,
  removeNodeFromGroup,
  removeSelection,
  resizeNode,
  touchDocument,
  updateEdge,
  updateGroup,
  updateNode,
  withNode,
  workflowContentKey,
  WorkflowValidationError,
} from "../core/document";
import { compareWorkflowVersions } from "../core/diff";
import { updateBundle } from "../core/bundles";
import { PALETTES } from "../core/palettes";
import {
  importSnapshot,
  validateImportSnapshot,
} from "../core/import";
import {
  createSampleDocument,
  createTemplateDocument,
} from "../core/templates";
import type {
  NodeKind,
  Point,
  Selection,
  VersionDiff,
  WorkflowDocument,
  WorkflowNode,
  WorkflowPalette,
  WorkflowTheme,
} from "../core/types";
import { localHost } from "../host/localHost";
import { createPrintHtml } from "../pdf/printDocument";
import {
  clearRecoveryDraft,
  loadRecoveryDraft,
  saveRecoveryDraft,
  type RecoveryDraft,
} from "../persistence/draftStore";
import { CanvasView } from "./CanvasView";
import {
  BranchConditionsDialog,
  ContentEditorDialog,
  ErrorDialog,
  ImportGuideDialog,
  RecoveryDialog,
  ShortcutDialog,
  TemplateDialog,
  VersionDiffDialog,
} from "./Dialogs";
import { FindDialog } from "./FindDialog";
import { Inspector } from "./Inspector";
import { OutlineView } from "./OutlineView";
import { Welcome } from "./Welcome";

type WorkspaceView = "canvas" | "outline";

interface Toast {
  id: number;
  text: string;
  tone?: "success" | "neutral" | "error";
}

interface ErrorState {
  title: string;
  message: string;
  issues?: string[];
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.matches("input, textarea, select") ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable=true]"))
  );
}

function sameStringList(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameSelection(left: Selection, right: Selection): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "none") return true;
  return right.kind !== "none" && left.id === right.id;
}

function filenameFor(document: WorkflowDocument): string {
  return `${document.metadata.title || "未命名工作流"}.${PRODUCT.fileExtension}`;
}

function preferredTheme(): WorkflowTheme {
  try {
    return window.localStorage.getItem("workflow-theme") === "dark"
      ? "dark"
      : "paper";
  } catch {
    return "paper";
  }
}

function preferredPalette(): WorkflowPalette {
  try {
    return window.localStorage.getItem("workflow-palette") === "bauhaus"
      ? "bauhaus"
      : "default";
  } catch {
    return "default";
  }
}

export function App() {
  const [document, setDocumentState] = useState<WorkflowDocument>(() =>
    createDocument(
      "未命名工作流",
      preferredTheme(),
      preferredPalette(),
    ),
  );
  const documentRef = useRef(document);
  const [past, setPast] = useState<WorkflowDocument[]>([]);
  const [future, setFuture] = useState<WorkflowDocument[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [view, setView] = useState<WorkspaceView>("canvas");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [narrowDrawer, setNarrowDrawer] = useState<"left" | "right" | null>(
    null,
  );
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [fitSignal, setFitSignal] = useState(0);
  const [editorNodeId, setEditorNodeId] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [importGuideOpen, setImportGuideOpen] = useState(false);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [branchBundleId, setBranchBundleId] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryDraft | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [diffState, setDiffState] = useState<{
    candidate: WorkflowDocument;
    diff: VersionDiff;
  } | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "autosaved" | "error"
  >("idle");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const clipboardRef = useRef<{
    documentId: string;
    nodeIds: string[];
    groupIds: string[];
  } | null>(null);
  const liveEditKeyRef = useRef<string | null>(null);
  const lastAutosaveRef = useRef(0);
  const importInputRef = useRef<HTMLInputElement>(null);
  const compareInputRef = useRef<HTMLInputElement>(null);

  const dirty = useMemo(
    () => savedSnapshot !== workflowContentKey(document),
    [document, savedSnapshot],
  );

  const toast = useCallback((text: string, tone: Toast["tone"] = "neutral") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, text, tone }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      3300,
    );
  }, []);

  const setDocument = useCallback((next: WorkflowDocument) => {
    documentRef.current = next;
    setDocumentState(next);
  }, []);

  const apply = useCallback(
    (
      updater: (current: WorkflowDocument) => WorkflowDocument,
      record = true,
    ) => {
      const previous = documentRef.current;
      const updated = updater(previous);
      if (updated === previous) return;
      const next = touchDocument(updated);
      if (record) {
        setPast((items) => [...items, previous].slice(-80));
        setFuture([]);
      }
      setDocument(next);
    },
    [setDocument],
  );

  const checkpoint = useCallback(() => {
    setPast((items) => [...items, documentRef.current].slice(-80));
    setFuture([]);
  }, []);

  const endLiveEdit = useCallback(() => {
    liveEditKeyRef.current = null;
  }, []);

  const applyEditorChange = useCallback(
    (
      liveKey: string | undefined,
      updater: (current: WorkflowDocument) => WorkflowDocument,
    ) => {
      if (liveKey) {
        if (liveEditKeyRef.current !== liveKey) {
          checkpoint();
          liveEditKeyRef.current = liveKey;
        }
        apply(updater, false);
        return;
      }
      liveEditKeyRef.current = null;
      apply(updater, true);
    },
    [apply, checkpoint],
  );

  const undo = useCallback(() => {
    const previous = past.at(-1);
    if (!previous) return;
    liveEditKeyRef.current = null;
    setFuture((items) => [documentRef.current, ...items].slice(0, 80));
    setPast((items) => items.slice(0, -1));
    setDocument(previous);
  }, [past, setDocument]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    liveEditKeyRef.current = null;
    setPast((items) => [...items, documentRef.current].slice(-80));
    setFuture((items) => items.slice(1));
    setDocument(next);
  }, [future, setDocument]);

  const clearSelection = useCallback(() => {
    setSelection({ kind: "none" });
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setSelectedGroupIds([]);
  }, []);

  const selectNode = useCallback((nodeId: string) => {
    setSelection({ kind: "node", id: nodeId });
    setSelectedNodeIds([nodeId]);
    setSelectedEdgeIds([]);
    setSelectedGroupIds([]);
    setInspectorOpen(true);
  }, []);

  const selectGroup = useCallback((groupId: string) => {
    setSelection({ kind: "group", id: groupId });
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setSelectedGroupIds([groupId]);
    setInspectorOpen(true);
  }, []);

  const selectEdge = useCallback((edgeId: string) => {
    setSelection({ kind: "edge", id: edgeId });
    setSelectedNodeIds([]);
    setSelectedEdgeIds([edgeId]);
    setSelectedGroupIds([]);
    setInspectorOpen(true);
  }, []);

  const openDocument = useCallback(
    (next: WorkflowDocument, nextName: string | null, baseline = false) => {
      setDocument(next);
      setFileName(nextName);
      setSavedSnapshot(baseline ? workflowContentKey(next) : null);
      setPast([]);
      setFuture([]);
      setHasWorkspace(true);
      setView("canvas");
      clearSelection();
      setFitSignal((value) => value + 1);
    },
    [clearSelection, setDocument],
  );

  const updateViewport = useCallback(
    (viewport: WorkflowDocument["layout"]["viewport"]) => {
      const current = documentRef.current;
      if (
        Math.abs(current.layout.viewport.x - viewport.x) < 0.5 &&
        Math.abs(current.layout.viewport.y - viewport.y) < 0.5 &&
        Math.abs(current.layout.viewport.zoom - viewport.zoom) < 0.001
      ) {
        return;
      }
      const next = {
        ...current,
        layout: { ...current.layout, viewport },
      };
      documentRef.current = next;
      setDocumentState(next);
    },
    [],
  );

  const confirmDiscard = useCallback(() => {
    if (!dirty || !hasWorkspace) return true;
    return window.confirm("当前工作流有未保存修改。继续并丢弃这些修改吗？");
  }, [dirty, hasWorkspace]);

  const newBlank = useCallback(() => {
    if (!confirmDiscard()) return;
    const next = createDocument(
      "未命名工作流",
      preferredTheme(),
      preferredPalette(),
    );
    openDocument(next, null, true);
    setSaveState("idle");
  }, [confirmDiscard, openDocument]);

  const toggleTheme = useCallback(() => {
    apply(
      (current) => ({
        ...current,
        display: {
          ...current.display,
          theme: current.display.theme === "dark" ? "paper" : "dark",
        },
      }),
      true,
    );
  }, [apply]);

  useEffect(() => {
    try {
      window.localStorage.setItem("workflow-theme", document.display.theme);
    } catch {
      // Theme persistence is optional when local storage is unavailable.
    }
  }, [document.display.theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem("workflow-palette", document.display.palette);
    } catch {
      // Palette persistence is optional when local storage is unavailable.
    }
  }, [document.display.palette]);

  const save = useCallback(
    async (saveAs = false, quiet = false) => {
      if (!hasWorkspace) return;
      if (!quiet) setSaveState("saving");
      try {
        const snapshot = documentRef.current;
        const result = await localHost.saveWorkflow(
          snapshot,
          fileName,
          saveAs,
        );
        setFileName(result.fileName);
        setSavedSnapshot(workflowContentKey(snapshot));
        setSaveState("saved");
        await clearRecoveryDraft();
        if (!quiet) {
          toast(
            result.mode === "local-atomic"
              ? "已原子保存到本地文档目录"
              : "已下载工作流文件",
            "success",
          );
        }
      } catch (caught) {
        setSaveState("error");
        if (!quiet && (caught as Error).message !== "已取消保存") {
          setError({
            title: "保存失败",
            message: caught instanceof Error ? caught.message : "未知保存错误",
          });
        }
      }
    },
    [fileName, hasWorkspace, toast],
  );

  const open = useCallback(async () => {
    if (!confirmDiscard()) return;
    try {
      const opened = await localHost.openWorkflow();
      if (!opened) return;
      openDocument(opened.document, opened.fileName, true);
      await clearRecoveryDraft();
      toast(`已打开 ${opened.fileName}`, "success");
    } catch (caught) {
      const validation =
        caught instanceof WorkflowValidationError ? caught : null;
      setError({
        title: "打开工作流失败",
        message:
          caught instanceof Error ? caught.message : "文件无法读取或格式不兼容",
        issues: validation?.issues,
      });
    }
  }, [confirmDiscard, openDocument, toast]);

  const createNodeAt = useCallback(
    (position?: Point) => {
      const current = documentRef.current;
      const anchor =
        selectedNodeIds[0] && current.layout.nodes[selectedNodeIds[0]];
      const computed =
        position ??
        (anchor
          ? { x: anchor.x + 290, y: anchor.y }
          : { x: 150 + current.nodes.length * 24, y: 150 });
      const node = createNode(
        "未命名节点",
        computed,
        "task",
      );
      apply((doc) => withNode(doc, node, computed), true);
      if (selectedNodeIds[0] && current.nodes.some((item) => item.id === selectedNodeIds[0])) {
        apply(
          (doc) =>
            connectNodes(doc, selectedNodeIds[0], node.id, undefined, "manual"),
          true,
        );
      }
      selectNode(node.id);
      setEditorNodeId(node.id);
    },
    [apply, selectNode, selectedNodeIds],
  );

  const deleteCurrent = useCallback(() => {
    const current = documentRef.current;
    if (selectedNodeIds.length + selectedEdgeIds.length + selectedGroupIds.length > 0) {
      apply(
        (doc) =>
          removeByIds(doc, {
            nodeIds: selectedNodeIds,
            edgeIds: selectedEdgeIds,
            groupIds: selectedGroupIds,
          }),
        true,
      );
      clearSelection();
      return;
    }
    if (selection.kind !== "none") {
      apply(
        (doc) =>
          removeSelection(doc, selection),
        true,
      );
      clearSelection();
    }
    if (current.nodes.length === 0) return;
  }, [
    apply,
    clearSelection,
    selectedEdgeIds,
    selectedGroupIds,
    selectedNodeIds,
    selection,
  ]);

  const duplicateSelection = useCallback(() => {
    if (selectedNodeIds.length === 0 && selectedGroupIds.length === 0) return;
    const result = duplicateNodes(
      documentRef.current,
      selectedNodeIds,
      selectedGroupIds,
    );
    apply(() => result.document, true);
    setSelection({ kind: "node", id: result.nodeIds[0] });
    setSelectedNodeIds(result.nodeIds);
    setSelectedEdgeIds(result.edgeIds);
    setSelectedGroupIds([]);
    toast("已复制所选节点", "success");
  }, [apply, selectedGroupIds, selectedNodeIds, toast]);

  const createGroup = useCallback(() => {
    if (selectedNodeIds.length === 0) {
      toast("先选择至少一个节点");
      return;
    }
    const groupIdBefore = new Set(
      documentRef.current.groups.map((group) => group.id),
    );
    apply(
      (doc) =>
        groupNodes(
          doc,
          selectedNodeIds,
          `分组 ${doc.groups.length + 1}`,
        ),
      true,
    );
    const created = documentRef.current.groups.find(
      (group) => !groupIdBefore.has(group.id),
    );
    if (created) selectGroup(created.id);
    toast("已创建分组，可折叠或拖动整体位置", "success");
  }, [apply, selectGroup, selectedNodeIds, toast]);

  const markSelectionImportant = useCallback(() => {
    if (
      selectedNodeIds.length === 0 &&
      selectedEdgeIds.length === 0 &&
      selectedGroupIds.length === 0
    ) {
      toast("先选择节点、关系或分组");
      return;
    }
    apply((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        selectedNodeIds.includes(node.id) ? { ...node, important: true } : node,
      ),
      edges: current.edges.map((edge) =>
        selectedEdgeIds.includes(edge.id)
          ? { ...edge, important: true }
          : edge,
      ),
      groups: current.groups.map((group) =>
        selectedGroupIds.includes(group.id)
          ? { ...group, important: true }
          : group,
      ),
    }), true);
    toast("所选对象已标记为重要", "success");
  }, [apply, selectedEdgeIds, selectedGroupIds, selectedNodeIds, toast]);

  const selectAllElements = useCallback(() => {
    const current = documentRef.current;
    if (current.nodes.length === 0) return;
    setSelection({ kind: "node", id: current.nodes[0].id });
    setSelectedNodeIds(current.nodes.map((node) => node.id));
    setSelectedEdgeIds(current.edges.map((edge) => edge.id));
    setSelectedGroupIds(current.groups.map((group) => group.id));
  }, []);

  const toggleGroup = useCallback(
    (groupId: string) => {
      apply(
        (doc) => {
          const group = doc.groups.find((item) => item.id === groupId);
          return group
            ? updateGroup(doc, groupId, { collapsed: !group.collapsed })
            : doc;
        },
        true,
      );
    },
    [apply],
  );

  const loadImport = useCallback(
    (raw: unknown, replace = true) => {
      if (replace && !confirmDiscard()) return null;
      const imported = importSnapshot(raw);
      if (replace) openDocument(imported, null);
      return imported;
    },
    [confirmDiscard, openDocument],
  );

  const readJsonFile = useCallback(
    async (file: File): Promise<unknown> => {
      const text = await file.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new WorkflowValidationError("文件不是有效 JSON");
      }
    },
    [],
  );

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const raw = await readJsonFile(file);
        const imported = loadImport(raw);
        if (imported) {
          setImportGuideOpen(false);
          toast(`已导入 ${imported.nodes.length} 个节点`, "success");
        }
      } catch (caught) {
        const validation =
          caught instanceof WorkflowValidationError ? caught : null;
        setError({
          title: "导入快照失败",
          message:
            caught instanceof Error ? caught.message : "文件不兼容导入协议 v1",
          issues: validation?.issues,
        });
      }
    },
    [loadImport, readJsonFile, toast],
  );

  const importSampleNow = useCallback(() => {
    if (!confirmDiscard()) return;
    openDocument(createSampleDocument(), null);
    setImportGuideOpen(false);
    toast("已导入结构化示例，可直接编辑", "success");
  }, [confirmDiscard, openDocument, toast]);

  const compareFile = useCallback(
    async (file: File) => {
      try {
        const raw = await readJsonFile(file);
        validateImportSnapshot(raw);
        const candidate = importSnapshot(raw);
        const diff = compareWorkflowVersions(documentRef.current, candidate);
        setDiffState({ candidate, diff });
      } catch (caught) {
        const validation =
          caught instanceof WorkflowValidationError ? caught : null;
        setError({
          title: "版本比较失败",
          message: caught instanceof Error ? caught.message : "快照不兼容",
          issues: validation?.issues,
        });
      }
    },
    [readJsonFile],
  );

  const exportPdf = useCallback(async () => {
    try {
      const html = createPrintHtml(documentRef.current);
      const result = await localHost.exportHtml(
        html,
        documentRef.current.metadata.title,
      );
      toast(
        result === "print"
          ? "已打开打印预览，请选择“另存为 PDF”"
          : "打印窗口被拦截，已下载可打印 HTML",
      );
    } catch (caught) {
      setError({
        title: "PDF 导出失败",
        message: caught instanceof Error ? caught.message : "无法生成打印页面",
      });
    }
  }, [toast]);

  const copySelection = useCallback(() => {
    if (selectedNodeIds.length === 0 && selectedGroupIds.length === 0) return;
    clipboardRef.current = {
      documentId: documentRef.current.id,
      nodeIds: selectedNodeIds,
      groupIds: selectedGroupIds,
    };
    toast("已复制所选内容，可粘贴为新节点", "success");
  }, [selectedGroupIds, selectedNodeIds, toast]);

  const pasteSelection = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard || clipboard.nodeIds.length + clipboard.groupIds.length === 0) {
      toast("编辑器剪贴板中没有节点");
      return;
    }
    const result = duplicateNodes(
      documentRef.current,
      clipboard.nodeIds,
      clipboard.groupIds,
    );
    if (result.nodeIds.length === 0) return;
    apply(() => result.document, true);
    setSelection({ kind: "node", id: result.nodeIds[0] });
    setSelectedNodeIds(result.nodeIds);
    setSelectedEdgeIds(result.edgeIds);
    setSelectedGroupIds([]);
    toast("已粘贴节点和内部关系", "success");
  }, [apply, toast]);

  const restoreDraft = useCallback(() => {
    if (!recovery) return;
    openDocument(recovery.document, recovery.fileName);
    setRecovery(null);
    toast("已恢复未保存的编辑", "success");
  }, [openDocument, recovery, toast]);

  const discardDraft = useCallback(async () => {
    await clearRecoveryDraft();
    setRecovery(null);
  }, []);

  useEffect(() => {
    loadRecoveryDraft()
      .then((draft) => {
        if (draft) setRecovery(draft);
      })
      .catch(() => {
        // Recovery is best-effort when storage is unavailable.
      });
  }, []);

  useEffect(() => {
    if (!hasWorkspace || !dirty) return;
    const timer = window.setTimeout(() => {
      void saveRecoveryDraft(document, fileName).catch(() => {
        // A storage failure must not interrupt editing.
      });
    }, 550);
    return () => window.clearTimeout(timer);
  }, [dirty, document, fileName, hasWorkspace]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (
        !hasWorkspace ||
        !dirty ||
        !fileName ||
        !(await localHost.supportsAtomicAutoSave())
      ) {
        return;
      }
      if (Date.now() - lastAutosaveRef.current < 1200) return;
      lastAutosaveRef.current = Date.now();
      const snapshot = document;
      try {
        const result = await localHost.saveWorkflow(
          snapshot,
          fileName,
          false,
          true,
        );
        if (cancelled) return;
        setSavedSnapshot(workflowContentKey(snapshot));
        setSaveState("autosaved");
        await clearRecoveryDraft();
      } catch {
        if (!cancelled) setSaveState("error");
      }
    };
    const timer = window.setTimeout(() => void run(), 1900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dirty, document, fileName, hasWorkspace]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || !hasWorkspace) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, hasWorkspace]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save(event.shiftKey);
        return;
      }
      if (!hasWorkspace || isEditableTarget(event.target)) return;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelection();
        return;
      }
      if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAllElements();
        return;
      }
      if (mod && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteSelection();
        return;
      }
      if (mod && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setView((current) => (current === "canvas" ? "outline" : "canvas"));
        return;
      }
      if (mod && event.key === "0") {
        event.preventDefault();
        setView("canvas");
        setFitSignal((value) => value + 1);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        createNodeAt();
        return;
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        createNodeAt();
        return;
      }
      if (
        (event.key.toLowerCase() === "e" || event.key === "Enter") &&
        selection.kind === "node" &&
        documentRef.current.nodes.find((node) => node.id === selection.id)
          ?.type !== "fork"
      ) {
        event.preventDefault();
        setEditorNodeId(selection.id);
        return;
      }
      if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        createGroup();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteCurrent();
        return;
      }
      if (event.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [
    clearSelection,
    copySelection,
    createGroup,
    createNodeAt,
    deleteCurrent,
    hasWorkspace,
    pasteSelection,
    redo,
    save,
    selectAllElements,
    selection,
    undo,
  ]);

  const editorNode = document.nodes.find((node) => node.id === editorNodeId);
  const updatedTime = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(document.metadata.updatedAt)),
    [document.metadata.updatedAt],
  );

  if (!hasWorkspace) {
    return (
      <>
        <Welcome
          onNew={newBlank}
          onImportSample={importSampleNow}
          onTemplates={() => setTemplateOpen(true)}
          onOpen={() => void open()}
          theme={document.display.theme}
          palette={document.display.palette}
        />
        <input
          ref={importInputRef}
          hidden
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImportFile(file);
            event.target.value = "";
          }}
        />
        {templateOpen ? (
          <TemplateDialog
            onChoose={(kind) => {
              if (!confirmDiscard()) return;
              openDocument(createTemplateDocument(kind), null);
              setTemplateOpen(false);
            }}
            onClose={() => setTemplateOpen(false)}
          />
        ) : null}
        {recovery ? (
          <RecoveryDialog
            document={recovery.document}
            fileName={recovery.fileName}
            savedAt={recovery.savedAt}
            onRecover={restoreDraft}
            onDiscard={() => void discardDraft()}
          />
        ) : null}
        {error ? (
          <ErrorDialog
            title={error.title}
            message={error.message}
            issues={error.issues}
            onClose={() => setError(null)}
          />
        ) : null}
      </>
    );
  }

  return (
    <div
      className={`app-shell ${dirty ? "is-dirty" : ""}`}
      data-theme={document.display.theme}
      data-palette={document.display.palette}
    >
      <header className="topbar">
        <div className="topbar-left">
          <button
            className="icon-button mobile-menu"
            onClick={() => setNarrowDrawer(narrowDrawer === "left" ? null : "left")}
            aria-label="打开大纲"
          >
            <Menu size={18} />
          </button>
          <div className="brand brand--compact">
            <span className="brand-mark">流</span>
          </div>
          <div className="document-identity">
            <button
              className="doc-title"
              title="点击修改文档标题"
              onClick={() => {
                const next = window.prompt(
                  "文档标题",
                  documentRef.current.metadata.title,
                );
                if (next?.trim()) {
                  apply(
                    (doc) => ({
                      ...doc,
                      metadata: { ...doc.metadata, title: next.trim() },
                    }),
                    true,
                  );
                }
              }}
            >
              {document.metadata.title}
              <ChevronDown size={13} />
            </button>
            <span className="doc-state">
              {saveState === "saving"
                ? "正在保存..."
                : saveState === "saved"
                  ? "已保存"
                  : saveState === "autosaved"
                    ? "已自动保存"
                    : dirty
                      ? "有未保存修改"
                      : "已就绪"}
              <i />
              {fileName ?? `未命名 .${PRODUCT.fileExtension}`} · {updatedTime}
            </span>
          </div>
        </div>
        <div className="topbar-center" role="tablist" aria-label="工作区视图">
          <button
            className={view === "canvas" ? "is-active" : ""}
            onClick={() => setView("canvas")}
            role="tab"
          >
            <LayoutDashboard size={15} />
            画布
          </button>
          <button
            className={view === "outline" ? "is-active" : ""}
            onClick={() => setView("outline")}
            role="tab"
          >
            <ListTree size={15} />
            大纲
          </button>
        </div>
        <div className="topbar-actions">
          <select
            className="palette-select"
            aria-label="配色方案"
            value={document.display.palette}
            onChange={(event) =>
              apply(
                (current) => ({
                  ...current,
                  display: {
                    ...current.display,
                    palette: event.target.value as WorkflowPalette,
                  },
                }),
                true,
              )
            }
            title={`当前配色：${PALETTES[document.display.palette].name}。灵感：${PALETTES[document.display.palette].inspiration}`}
          >
            {Object.values(PALETTES).map((palette) => (
              <option key={palette.id} value={palette.id}>
                {palette.id === "bauhaus"
                  ? `${palette.name}（包豪斯灵感）`
                  : palette.name}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            onClick={toggleTheme}
            aria-label={
              document.display.theme === "dark"
                ? "切换浅色模式"
                : "切换深色模式"
            }
            title={
              document.display.theme === "dark"
                ? "切换浅色模式"
                : "切换深色模式"
            }
          >
            {document.display.theme === "dark" ? (
              <Sun size={17} />
            ) : (
              <Moon size={17} />
            )}
          </button>
          <button className="icon-button" onClick={() => void save()} aria-label="保存">
            <Save size={17} />
          </button>
          <button
            className="button button--primary button--compact"
            onClick={exportPdf}
          >
            <FileDown size={16} />
            导出 PDF
          </button>
          <button
            className="icon-button topbar-more"
            onClick={() => setShortcutOpen(true)}
            aria-label="操作帮助"
          >
            <CircleHelp size={17} />
          </button>
        </div>
      </header>

      <section className="commandbar">
        <div className="command-group">
          <button onClick={newBlank} title="新建空白">
            <FilePlus2 size={16} />
            <span>新建</span>
          </button>
          <button onClick={() => void open()} title="打开">
            <FolderOpen size={16} />
            <span>打开</span>
          </button>
          <button onClick={() => setImportGuideOpen(true)} title="导入">
            <Import size={16} />
            <span>导入</span>
          </button>
          <span className="command-divider" />
          <button onClick={undo} disabled={past.length === 0} title="撤销">
            <Undo2 size={16} />
          </button>
          <button onClick={redo} disabled={future.length === 0} title="重做">
            <Redo2 size={16} />
          </button>
          <span className="command-divider" />
          <button onClick={() => setFindOpen(true)} title="查找节点">
            <Search size={16} />
            <span>查找</span>
          </button>
          <button
            onClick={() => {
              setView("canvas");
              setFitSignal((value) => value + 1);
            }}
            title="适应画布"
          >
            <Maximize size={16} />
          </button>
          <span className="command-divider" />
          <button onClick={createGroup} title="将所选节点创建为分组">
            <BookOpenText size={16} />
            <span>建分组</span>
          </button>
          <button onClick={markSelectionImportant} title="标记所选对象为重要">
            <Star size={16} />
            <span>标记重要</span>
          </button>
          <button
            onClick={() => compareInputRef.current?.click()}
            title="与另一个导入快照对比"
          >
            <GitCompareArrows size={16} />
            <span>版本对比</span>
          </button>
        </div>
        <div className="command-status">
          {dirty ? <span className="dirty-dot" /> : <Check size={14} />}
          <span>{dirty ? "自动缓存已开启" : "所有更改均已保存"}</span>
          <button
            className="sidebar-toggle"
            onClick={() => {
              setSidebarOpen((value) => !value);
              setInspectorOpen(false);
            }}
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          {!inspectorOpen ? (
            <button
              className="sidebar-toggle"
              onClick={() => {
                setInspectorOpen(true);
                setNarrowDrawer("right");
              }}
            >
              <PanelRightOpen size={16} />
            </button>
          ) : null}
        </div>
      </section>

      <div
        className={`workspace ${
          sidebarOpen ? "has-sidebar" : ""
        } ${inspectorOpen ? "has-inspector" : ""} ${
          narrowDrawer ? `drawer-${narrowDrawer}` : ""
        }`}
      >
        {sidebarOpen ? (
          <aside className="sidebar">
            <div className="sidebar-head">
              <div>
                <div className="eyebrow">文档结构</div>
                <strong>{document.nodes.length} 个节点</strong>
              </div>
              <button
                className="icon-button"
                onClick={() => setSidebarOpen(false)}
                aria-label="收起侧栏"
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
            <div className="sidebar-tabs">
              <button
                className={view === "canvas" ? "is-active" : ""}
                onClick={() => setView("canvas")}
              >
                画布导航
              </button>
              <button
                className={view === "outline" ? "is-active" : ""}
                onClick={() => setView("outline")}
              >
                大纲
              </button>
            </div>
            <OutlineView
              document={document}
              selectedNodeIds={selectedNodeIds}
              selectedGroupIds={selectedGroupIds}
              onSelect={(kind, id) => {
                if (kind === "node") selectNode(id);
                else if (kind === "group") selectGroup(id);
                else selectEdge(id);
                setNarrowDrawer(null);
              }}
              onToggleGroup={toggleGroup}
              onRenameNode={(nodeId, title) =>
                apply(
                  (doc) => updateNode(doc, nodeId, { title }),
                  false,
                )
              }
            />
            <div className="sidebar-footer">
              <span>离线草稿自动缓存</span>
              <span>{document.edges.length} 条关系</span>
            </div>
          </aside>
        ) : null}

        <main className="main-stage">
          <div
            className="canvas-view-host"
            hidden={view !== "canvas"}
          >
            <CanvasView
              document={document}
              externalNodeIds={selectedNodeIds}
              externalGroupIds={selectedGroupIds}
              fitSignal={fitSignal}
              onApply={apply}
              onCheckpoint={checkpoint}
              onSelectionChange={(primary, nodeIds, edgeIds, groupIds) => {
                setSelection((current) =>
                  sameSelection(current, primary) ? current : primary,
                );
                setSelectedNodeIds((current) =>
                  sameStringList(current, nodeIds) ? current : nodeIds,
                );
                setSelectedEdgeIds((current) =>
                  sameStringList(current, edgeIds) ? current : edgeIds,
                );
                setSelectedGroupIds((current) =>
                  sameStringList(current, groupIds) ? current : groupIds,
                );
                if (primary.kind !== "none") setInspectorOpen(true);
              }}
              onEditNode={setEditorNodeId}
              onCreateGroup={createGroup}
              onEditBranches={setBranchBundleId}
              onToggleGroup={toggleGroup}
              onViewportChange={updateViewport}
            />
          </div>
          {view === "outline" ? (
            <OutlineView
              document={document}
              selectedNodeIds={selectedNodeIds}
              selectedGroupIds={selectedGroupIds}
              onSelect={(kind, id) => {
                if (kind === "node") selectNode(id);
                else if (kind === "group") selectGroup(id);
                else selectEdge(id);
              }}
              onToggleGroup={toggleGroup}
              onRenameNode={(nodeId, title) =>
                apply((doc) => updateNode(doc, nodeId, { title }), false)
              }
            />
          ) : null}
        </main>

        {inspectorOpen ? (
          <Inspector
            document={document}
            selection={selection}
            onUpdateNode={(id, patch: Partial<WorkflowNode>, liveKey) =>
              applyEditorChange(liveKey, (doc) =>
                updateNode(doc, id, patch),
              )
            }
            onResizeNode={(id, width, height, liveKey) =>
              applyEditorChange(liveKey, (doc) =>
                resizeNode(doc, id, width, height),
              )
            }
            onUpdateEdge={(id, patch, liveKey) =>
              applyEditorChange(liveKey, (doc) =>
                updateEdge(doc, id, patch),
              )
            }
            onUpdateGroup={(id, patch, liveKey) =>
              applyEditorChange(liveKey, (doc) =>
                updateGroup(doc, id, patch),
              )
            }
            onEndLiveEdit={endLiveEdit}
            onToggleGroup={toggleGroup}
            onDelete={(target) => {
              apply((doc) => removeSelection(doc, target), true);
              clearSelection();
            }}
            onDuplicate={duplicateSelection}
            onCreateGroup={createGroup}
            onRemoveFromGroup={(nodeId) =>
              apply((doc) => removeNodeFromGroup(doc, nodeId), true)
            }
            onCollapsePanel={() => setInspectorOpen(false)}
            onCloseSelection={clearSelection}
          />
        ) : null}
      </div>

      <input
        ref={importInputRef}
        data-testid="import-input"
        hidden
        type="file"
        accept=".json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleImportFile(file);
          event.target.value = "";
        }}
      />
      <input
        ref={compareInputRef}
        data-testid="compare-input"
        hidden
        type="file"
        accept=".json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void compareFile(file);
          event.target.value = "";
        }}
      />

      {editorNode ? (
        <ContentEditorDialog
          node={editorNode}
          onSave={(patch) =>
            apply((doc) => updateNode(doc, editorNode.id, patch), true)
          }
          onClose={() => setEditorNodeId(null)}
        />
      ) : null}
      {findOpen ? (
        <FindDialog
          document={document}
          onSelect={selectNode}
          onClose={() => setFindOpen(false)}
        />
      ) : null}
      {templateOpen ? (
        <TemplateDialog
          onChoose={(kind) => {
            openDocument(createTemplateDocument(kind), null);
            setTemplateOpen(false);
          }}
          onClose={() => setTemplateOpen(false)}
        />
      ) : null}
      {shortcutOpen ? (
        <ShortcutDialog onClose={() => setShortcutOpen(false)} />
      ) : null}
      {branchBundleId
        ? (() => {
            const bundle = document.bundles.find(
              (item) => item.id === branchBundleId,
            );
            if (!bundle) return null;
            const source = document.nodes.find(
              (node) => node.id === bundle.sourceId,
            );
            if (!source) return null;
            const bundleEdges = document.edges.filter((edge) =>
              bundle.edgeIds.includes(edge.id),
            );
            return (
              <BranchConditionsDialog
                source={source}
                edges={bundleEdges}
                bundleLabel={bundle.label}
                bundleVisible={bundle.visible}
                targetTitle={(nodeId) =>
                  document.nodes.find((node) => node.id === nodeId)?.title ??
                  nodeId
                }
                onSave={(labels, label, visible) =>
                  apply((current) => {
                    const withEdges = {
                      ...current,
                      edges: current.edges.map((edge) =>
                        bundle.edgeIds.includes(edge.id)
                          ? {
                              ...edge,
                              label: labels[edge.id]?.trim() ?? "",
                            }
                          : edge,
                      ),
                    };
                    return updateBundle(withEdges, bundle.id, {
                      label: label.trim(),
                      visible,
                    });
                  }, true)
                }
                onClose={() => setBranchBundleId(null)}
              />
            );
          })()
        : null}
      {importGuideOpen ? (
        <ImportGuideDialog
          onChooseFile={() => importInputRef.current?.click()}
          onUseSample={importSampleNow}
          onClose={() => setImportGuideOpen(false)}
        />
      ) : null}
      {diffState ? (
        <VersionDiffDialog
          current={document}
          candidate={diffState.candidate}
          diff={diffState.diff}
          onLoadCandidate={() => {
            if (!confirmDiscard()) return;
            openDocument(diffState.candidate, null);
            setDiffState(null);
            toast("已打开比较版本", "success");
          }}
          onChooseAnother={() => {
            setDiffState(null);
            compareInputRef.current?.click();
          }}
          onClose={() => setDiffState(null)}
        />
      ) : null}
      {error ? (
        <ErrorDialog
          title={error.title}
          message={error.message}
          issues={error.issues}
          onClose={() => setError(null)}
        />
      ) : null}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((item) => (
          <div
            className={`toast toast--${item.tone ?? "neutral"}`}
            key={item.id}
          >
            {item.tone === "success" ? <Check size={15} /> : <Download size={15} />}
            {item.text}
          </div>
        ))}
      </div>
    </div>
  );
}

