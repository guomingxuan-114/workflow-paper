export type NodeKind =
  | "start"
  | "fork"
  | "task"
  | "decision"
  | "end"
  | "note";

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type WorkflowTheme = "paper" | "dark";
export type WorkflowPalette = "default" | "bauhaus";

export interface ImportedOrigin {
  kind: "import";
  system: string;
  version: string;
  commit?: string;
  originalId: string;
  importedAt: string;
}

export interface ManualOrigin {
  kind: "manual";
}

export type NodeOrigin = ImportedOrigin | ManualOrigin;

export interface WorkflowNode {
  id: string;
  title: string;
  description: string;
  type: NodeKind;
  tags: string[];
  origin: NodeOrigin;
  milestone?: {
    label?: string;
    color?: string;
  };
  important?: boolean;
  source?: {
    file?: string;
    language?: string;
    symbol?: string;
    url?: string;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  origin: "manual" | "import";
  important?: boolean;
  bundleId?: string;
}

export interface WorkflowGroup {
  id: string;
  title: string;
  nodeIds: string[];
  parentId?: string;
  collapsed: boolean;
  color?: string;
  important?: boolean;
}

export interface WorkflowBundle {
  id: string;
  sourceId: string;
  forkNodeId?: string;
  edgeIds: string[];
  label: string;
  visible: boolean;
  color?: string;
}

export interface NodeLayout extends Point, Size {}

export interface GroupLayout extends Point, Size {}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkflowLayout {
  nodes: Record<string, NodeLayout>;
  groups: Record<string, GroupLayout>;
  viewport: Viewport;
}

export interface DocumentProvenance {
  system?: string;
  version?: string;
  commit?: string;
  importedAt?: string;
  sourceFile?: string;
}

export interface WorkflowDocument {
  schemaVersion: 2;
  id: string;
  metadata: {
    title: string;
    description: string;
    createdAt: string;
    updatedAt: string;
    author?: string;
  };
  provenance: DocumentProvenance;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  groups: WorkflowGroup[];
  bundles: WorkflowBundle[];
  layout: WorkflowLayout;
  display: {
    showDescriptions: boolean;
    theme: WorkflowTheme;
    palette: WorkflowPalette;
  };
}

export interface WorkflowManifest {
  format: "local-workflow";
  containerVersion: 1;
  documentSchemaVersion: 2;
  product: string;
  appVersion: string;
  createdAt: string;
  checksum: string;
  files: string[];
}

export interface ImportedNodeV1 {
  id: string;
  title: string;
  description?: string;
  type?: NodeKind | "milestone";
  tags?: string[];
  group?: string;
  source?: WorkflowNode["source"];
}

export interface ImportedEdgeV1 {
  id?: string;
  source: string;
  target: string;
  label?: string;
}

export interface ImportedGroupV1 {
  id: string;
  title: string;
  parentId?: string;
  collapsed?: boolean;
  color?: string;
}

export interface ImportSnapshotV1 {
  format: "workflow-import";
  schemaVersion: 1;
  version: {
    label: string;
    commit?: string;
    generatedAt?: string;
  };
  source: {
    id: string;
    name: string;
    kind?: string;
    repository?: string;
  };
  metadata?: {
    title?: string;
    description?: string;
    author?: string;
  };
  nodes: ImportedNodeV1[];
  edges: ImportedEdgeV1[];
  groups?: ImportedGroupV1[];
}

export interface VersionDiff {
  added: WorkflowNode[];
  removed: WorkflowNode[];
  changed: Array<{
    id: string;
    before: WorkflowNode;
    after: WorkflowNode;
    fields: string[];
  }>;
  edges: {
    added: WorkflowEdge[];
    removed: WorkflowEdge[];
    changed: Array<{
      id: string;
      before: WorkflowEdge;
      after: WorkflowEdge;
      fields: string[];
    }>;
  };
  groups: {
    added: WorkflowGroup[];
    removed: WorkflowGroup[];
    changed: Array<{
      id: string;
      before: WorkflowGroup;
      after: WorkflowGroup;
      fields: string[];
    }>;
  };
}

export type Selection =
  | { kind: "none" }
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "group"; id: string };

