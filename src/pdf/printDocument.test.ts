import { describe, expect, it } from "vitest";
import { createPrintHtml } from "./printDocument";
import { createSampleDocument } from "../core/templates";
import { createBranchBundle } from "../core/bundles";
import { mixHex, PALETTES } from "../core/palettes";

describe("print document", () => {
  it("renders vector Chinese text, legend, provenance and page numbers", () => {
    const document = createSampleDocument();
    const html = createPrintHtml(document);
    expect(html).toContain("示例发布程序");
    expect(html).toContain("运行质量门禁");
    expect(html).toContain("执行单元测试、契约测试与静态检查。");
    expect(html).toContain("第 1 /");
    expect(html).toContain("有向关系");
    expect(html).toContain('<span class="pdf-kind">节点</span>');
    expect(html).not.toContain('<span class="pdf-kind">task</span>');
    expect(html).toContain("<svg");
    expect(html).toContain('font-family: "Microsoft YaHei"');
  });

  it("paginates large groups instead of creating one endless page", () => {
    const document = createSampleDocument();
    const first = document.nodes[0];
    for (let index = 0; index < 14; index += 1) {
      const id = `extra-${index}`;
      document.nodes.push({
        ...first,
        id,
        title: `扩展节点 ${index}`,
      });
      document.groups[0].nodeIds.push(id);
      document.layout.nodes[id] = {
        ...document.layout.nodes[first.id],
        x: 100 + index * 20,
        y: 500 + index * 20,
      };
    }
    const html = createPrintHtml(document);
    const pageCount = (html.match(/class="print-page /g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(5);
    expect(html).toContain("扩展节点 13");
    expect(html).toContain('class="pdf-group-map"');
  });

  it("respects collapsed groups and includes reverse and branching conditions", () => {
    const document = createSampleDocument();
    document.groups[0].collapsed = true;
    const approve = document.nodes[2];
    const deploy = document.nodes[3];
    const finish = document.nodes[5];
    document.edges.push(
      {
        id: "branch-skip",
        source: approve.id,
        target: finish.id,
        label: "跳过灰度",
        origin: "manual",
      },
      {
        id: "reverse-retry",
        source: finish.id,
        target: approve.id,
        label: "重新提交",
        origin: "manual",
      },
    );
    const bundled = createBranchBundle(
      document,
      approve.id,
      [document.edges[2].id, "branch-skip"],
      "方针",
    );
    const html = createPrintHtml(bundled);
    const overviewSvg = html.match(/<svg[\s\S]*?<\/svg>/)?.[0] ?? "";
    expect(overviewSvg).not.toContain("提交候选版本");
    expect(overviewSvg).toContain("准备与验证");
    expect(overviewSvg).toContain("已折叠");
    expect(overviewSvg).not.toContain("pdf-edge-trunk");
    expect(overviewSvg).not.toContain("pdf-bundle-label");
    expect(overviewSvg).toMatch(/d="M [^"]+ C /);
    const armPaths = [
      ...overviewSvg.matchAll(/<g class="pdf-edge[^"]*"[^>]*><path d="([^"]+)"/g),
    ].map((match) => match[1]);
    expect(armPaths.length).toBeGreaterThan(0);
    expect(armPaths.every((pathData) => pathData.startsWith("M "))).toBe(true);
    expect(armPaths.every((pathData) => !pathData.includes(" L "))).toBe(true);
    expect(armPaths.every((pathData) => pathData.includes(" C "))).toBe(true);
    expect(html).toContain("准备与验证 · 已折叠");
    expect(html).toContain("提交候选版本");
    expect(html).toContain("出口条件");
    expect(html).toContain("跳过灰度");
    expect(html).toContain("重新提交");
    expect(html).toContain("同一计算分叉点");
    expect(html).not.toContain("NaN");
  });

  it("uses the selected palette and renders note, milestone and important styling", () => {
    const document = createSampleDocument();
    document.display.palette = "bauhaus";
    document.nodes[2].important = true;
    document.nodes[4].important = false;
    document.nodes[4].milestone = { label: "M1 稳定" };
    const note = {
      ...document.nodes[0],
      id: "note-1",
      type: "note" as const,
      title: "现场备注",
      milestone: undefined,
    };
    document.nodes.push(note);
    document.layout.nodes[note.id] = {
      x: 1420,
      y: 520,
      width: 224,
      height: 126,
    };
    document.edges.push({
      id: "note-edge",
      source: document.nodes[3].id,
      target: note.id,
      label: "补充",
      origin: "manual",
    });
    const html = createPrintHtml(document);
    expect(html).toContain("#174d8c");
    expect(html).toContain("#e8c665");
    expect(html).toContain("pdf-node--shape-ellipse");
    expect(html).toContain("pdf-node--shape-capsule");
    expect(html).toContain("pdf-node--shape-note");
    expect(html).toContain("is-important");
    expect(html).toContain("◆ M1 稳定");
    expect(html).toMatch(/class="pdf-edge[^"]*is-note-edge/);
    expect(html).toContain("stroke-dasharray: 5 4");
    const importantFill = mixHex(
      PALETTES.bauhaus.colors.decision,
      PALETTES.bauhaus.colors.important,
      0.2,
    );
    const milestoneFill = mixHex(
      PALETTES.bauhaus.colors.node,
      PALETTES.bauhaus.colors.milestone,
      0.16,
    );
    expect(html).toContain(`style="fill:${importantFill}"`);
    expect(html).toContain(`style="fill:${milestoneFill}"`);
  });

  it("renders empty-title fork points as stadium nodes with outgoing counts", () => {
    const document = createSampleDocument();
    const fork = {
      ...document.nodes[0],
      id: "fork-snapshot",
      title: "",
      description: "",
      type: "fork" as const,
      tags: [],
      milestone: undefined,
      important: false,
    };
    document.nodes.push(fork);
    document.layout.nodes[fork.id] = {
      x: 420,
      y: 520,
      width: 268,
      height: 132,
    };
    document.edges.push({
      id: "fork-edge",
      source: fork.id,
      target: document.nodes[1].id,
      origin: "manual",
    });
    const html = createPrintHtml(document);
    expect(html).toContain(
      "pdf-node pdf-node--fork pdf-node--shape-capsule",
    );
    expect(html).toContain('<span class="pdf-kind">分叉点</span>');
    expect(html).toContain('<span><i class="legend-box legend-fork"></i> 分叉点</span>');
    expect(html).not.toContain("NaN");
  });
});

