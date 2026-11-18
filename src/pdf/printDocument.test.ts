import { describe, expect, it } from "vitest";
import { createPrintHtml } from "./printDocument";
import { createSampleDocument } from "../core/templates";

describe("print document", () => {
  it("renders vector Chinese text, legend, provenance and page numbers", () => {
    const document = createSampleDocument();
    const html = createPrintHtml(document);
    expect(html).toContain("示例发布程序");
    expect(html).toContain("运行质量门禁");
    expect(html).toContain("执行单元测试、契约测试与静态检查。");
    expect(html).toContain("第 1 /");
    expect(html).toContain("有向关系");
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
        title: `扩展步骤 ${index}`,
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
    expect(html).toContain("扩展步骤 13");
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
    const html = createPrintHtml(document);
    const overviewSvg = html.match(/<svg[\s\S]*?<\/svg>/)?.[0] ?? "";
    expect(overviewSvg).not.toContain("提交候选版本");
    expect(overviewSvg).toContain("准备与验证");
    expect(overviewSvg).toContain("已折叠");
    expect(overviewSvg).toContain("pdf-edge-trunk");
    expect(html).toContain("准备与验证 · 已折叠");
    expect(html).toContain("提交候选版本");
    expect(html).toContain("出口条件");
    expect(html).toContain("跳过灰度");
    expect(html).toContain("重新提交");
    expect(html).toContain("同一计算分叉点");
  });
});

