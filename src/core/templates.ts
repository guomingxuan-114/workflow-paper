import { createDocument, createNode } from "./document";
import { importSnapshot } from "./import";
import { nodeMetrics } from "./nodeShapes";
import type { WorkflowDocument } from "./types";

export const sampleImport: unknown = {
  format: "workflow-import",
  schemaVersion: 1,
  version: {
    label: "v1.4.0",
    commit: "8c41ea2",
    generatedAt: "2026-11-17T08:30:00Z",
  },
  source: {
    id: "example-release-pipeline",
    name: "示例发布程序",
    kind: "pipeline-definition",
    repository: "demo/release-service",
  },
  metadata: {
    title: "发布程序 · 版本快照",
    description: "从结构化程序定义导入的发布流程示例。",
    author: "产品工程组",
  },
  groups: [
    { id: "prepare", title: "准备与验证", color: "sand" },
    { id: "release", title: "发布决策", color: "sage" },
  ],
  nodes: [
    {
      id: "commit",
      title: "提交候选版本",
      description: "冻结代码并生成可追溯的候选版本。",
      type: "start",
      tags: ["自动化"],
      group: "prepare",
      source: { file: "pipeline/release.yml", symbol: "candidate" },
    },
    {
      id: "tests",
      title: "运行质量门禁",
      description: "执行单元测试、契约测试与静态检查。",
      type: "task",
      tags: ["CI", "质量"],
      group: "prepare",
      source: { file: "pipeline/release.yml", symbol: "quality-gate" },
    },
    {
      id: "approve",
      title: "确认发布窗口",
      description: "值班负责人确认变更说明、风险与回滚方案。",
      type: "decision",
      tags: ["人工确认"],
      group: "release",
    },
    {
      id: "deploy",
      title: "灰度发布",
      description: "先向内部租户发布，观察关键指标。",
      type: "task",
      tags: ["生产"],
      group: "release",
    },
    {
      id: "observe",
      title: "观察稳定性",
      description: "确认错误率、延迟与核心业务指标处于阈值内。",
      type: "milestone",
      tags: ["监控"],
      group: "release",
    },
    {
      id: "finish",
      title: "完成全量发布",
      description: "记录版本结果并关闭发布单。",
      type: "end",
      tags: ["完成"],
    },
  ],
  edges: [
    { source: "commit", target: "tests" },
    { source: "tests", target: "approve", label: "通过" },
    { source: "approve", target: "deploy", label: "批准" },
    { source: "deploy", target: "observe" },
    { source: "observe", target: "finish", label: "指标稳定" },
  ],
};

export function createSampleDocument(): WorkflowDocument {
  return importSnapshot(sampleImport);
}

export function createTemplateDocument(kind: "approval" | "incident"): WorkflowDocument {
  if (kind === "approval") {
    let document = createDocument("费用审批流程");
    const specs: Array<[string, number, WorkflowDocument["nodes"][number]["type"]]> = [
      ["提交申请", 100, "start"],
      ["直属主管审批", 390, "decision"],
      ["财务复核", 680, "task"],
      ["归档", 970, "end"],
    ];
    const nodes = specs.map(([title, x, type]) =>
      createNode(title, { x, y: 110 }, type),
    );
    document = {
      ...document,
      nodes,
      layout: {
        ...document.layout,
        nodes: Object.fromEntries(
          nodes.map((node, index) => [
            node.id,
            {
              x: specs[index][1],
              y: 110,
              width: nodeMetrics(node).width,
              height: nodeMetrics(node).height,
            },
          ]),
        ),
      },
    };
    document = {
      ...document,
      edges: [
        { id: "edge-a", source: nodes[0].id, target: nodes[1].id, label: "金额 > 5,000", origin: "manual" },
        { id: "edge-b", source: nodes[1].id, target: nodes[2].id, label: "通过", origin: "manual" },
        { id: "edge-c", source: nodes[2].id, target: nodes[3].id, origin: "manual" },
      ],
    };
    return document;
  }
  let document = createDocument("线上故障响应");
  const specs: Array<
    [string, number, number, WorkflowDocument["nodes"][number]["type"]]
  > = [
    ["发现告警", 100, 100, "start"],
    ["确认影响范围", 360, 100, "decision"],
    ["启动应急群", 620, 100, "task"],
    ["修复与回滚", 880, 100, "task"],
    ["复盘归档", 1140, 100, "end"],
  ];
  const ids: string[] = [];
  for (const [title, x, y, type] of specs) {
    const node = createNode(title, { x, y }, type);
    ids.push(node.id);
    document = {
      ...document,
      nodes: [...document.nodes, node],
      layout: {
        ...document.layout,
        nodes: {
          ...document.layout.nodes,
          [node.id]: {
            x,
            y,
            width: nodeMetrics(node).width,
            height: nodeMetrics(node).height,
          },
        },
      },
    };
  }
  document = {
    ...document,
    edges: ids.slice(0, -1).map((id, index) => ({
      id: `incident-edge-${index}`,
      source: id,
      target: ids[index + 1],
      origin: "manual" as const,
    })),
  };
  return document;
}

