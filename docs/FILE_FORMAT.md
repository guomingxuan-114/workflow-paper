# `.wflow` 工作流文件格式

当前产品版本为 `0.2.3`，工作流文档 schema 为 `2`。扩展名、MIME、产品名、应用版本和 schema 版本集中定义在根目录 `product.config.json`，前端、本地宿主和示例生成器共同读取，界面与代码不硬编码产品品牌。

## 容器

`.wflow` 是标准 ZIP，当前 `containerVersion` 为 `1`：

```text
manifest.json
document.json
assets/README.txt
preview/README.txt
```

- `manifest.json`：容器版本、文档 schema 版本、产品与应用版本、生成时间、`document.json` 校验值及文件清单。
- `document.json`：唯一权威语义、布局和展示来源，使用可迁移 JSON。
- `assets/`：预留附件目录。
- `preview/`：可重建预览缓存目录，不是权威数据。

打开时依次校验 ZIP、manifest、容器版本、文档校验值、文档 schema、ID 引用、布局和分支束成员。损坏文件会明确报错，不会覆盖原文件。

## `document.json`（schema 2）

```json
{
  "schemaVersion": 2,
  "id": "doc-...",
  "metadata": {
    "title": "工作流标题",
    "description": "",
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601",
    "author": "可选"
  },
  "provenance": {
    "system": "程序名称",
    "version": "v1.4.0",
    "commit": "8c41ea2",
    "importedAt": "ISO-8601",
    "sourceFile": "repository"
  },
  "nodes": [],
  "edges": [],
  "groups": [],
  "bundles": [],
  "layout": {
    "nodes": {},
    "groups": {},
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
  },
  "display": {
    "showDescriptions": true,
    "theme": "paper",
    "palette": "default"
  }
}
```

### 节点：形状、内容与强调分离

`nodes` 使用稳定 ID，基础形状只由 `type` 决定：

- `task`：约 12px 弧角矩形普通节点，界面显示为“节点”，内部值保持不变。
- `decision`：椭圆判断。
- `fork`：紧凑跑道形分叉点，默认宽度约 44px；标题可为空，界面按出边数量显示计数。
- `start`：胶囊形开始。
- `end`：胶囊形结束。
- `note`：便签形备注。

节点内容与来源字段包括 `title`、`description`、`tags`、`origin` 和可选 `source`。`origin.kind` 为 `manual` 或 `import`；导入节点保留 `system`、`version`、`commit`、`originalId`、`importedAt`。

强调信息不再伪装成节点类型：

```json
{
  "id": "node-stable-id",
  "type": "task",
  "important": true,
  "milestone": {
    "label": "M1 发布候选",
    "color": "可选颜色索引"
  }
}
```

- `important`：节点、关系或分组都可使用的布尔强调。画布和 PDF 从当前 palette 派生淡色背景，并保留星标/描边。
- `milestone`：与形状无关的里程碑对象，可带文字和配色索引；界面同时使用编号/徽标与颜色，保证黑白打印可辨。

### 关系

`edges` 包含稳定 `id`、语义方向 `source`/`target`、可选 `label`、`origin`、`important` 和可选 `bundleId`。方向始终由拖动起点节点指向松手落点节点，与节点形状、节点类型和触点所在侧无关。

备注节点参与的关系在画布与 PDF 中显示为中性虚线且无箭头，但它仍是有稳定 ID、可选择和可删除的关系记录。

### 分组

`groups` 包含稳定 `id`、`title`、直接成员 `nodeIds`、可选 `parentId`、`collapsed`、`color` 和 `important`。

- 普通拖动节点只修改布局，不改变 `nodeIds`。
- 节点被移到分组框外后仍显示归属标记。
- 只有 `Alt + 拖动` 或详情栏“移出”才从 `nodeIds` 删除成员。
- 拖动分组时，成员节点和嵌套子组的绝对布局坐标同步平移，并作为一次撤销记录。

### 分支束兼容数据

`bundles` 继续保留用于读取旧文件：

```json
{
  "id": "bundle-id",
  "sourceId": "node-source-id",
  "forkNodeId": "fork-node-id",
  "edgeIds": ["edge-a", "edge-b"],
  "label": "方针",
  "visible": true,
  "color": "可选颜色索引"
}
```

- `edgeIds` 成员的 `source` 必须等于 `sourceId`，成员边具有相同 `bundleId`。
- `forkNodeId` 为旧版本兼容字段，仅用于读取此前保存的关联关系。
- 从已有线段拖出新分支时，断点位置新建的节点类型为 `fork`。
- 分支条件仍写入各边的 `label`，不引入执行语义。
- 旧 `bundles` 数据不再参与画布线条归并，也不会自动生成分叉对象；每条边按独立路径绘制。
- 分叉点位置、箭头和标签位置由 `src/core/edgeRouting.ts` 计算，画布、拖动预览与 PDF 共用结果。

### 布局与展示

`layout.nodes` 和 `layout.groups` 只保存位置、尺寸和分组框尺寸；`layout.viewport` 保存画布浏览视口。节点尺寸由用户缩放，最小值、默认值和网格吸附来自 `src/core/nodeShapes.ts`。

`0.2.3` 新增 `fork` 节点类型并保留可选字段 `bundle.forkNodeId` 以读取兼容数据，未提升 `.wflow` 容器或 `document.json` schema 版本。分叉点复用现有节点标题、布局和来源结构；旧文件不含这两个字段时行为不变，v1 迁移不受影响。

`metadata.updatedAt` 在内容或布局编辑时更新。单独平移、缩放视口不触发未保存状态、草稿缓存或自动保存；后续保存时视口会随文档写入。

`display.theme` 支持 `paper` 和 `dark`。`display.palette` 支持：

- `default`：原有“安静稿纸”配色。
- `bauhaus`：构成主义蓝红黄参考主题。

配色不改变工作流语义，但会随文档保存并同时作用于画布、分组、边、标签和 PDF。主题说明见 [THEMES.md](THEMES.md)。

## v1 → v2 迁移

schema 1 文件可继续用同一入口打开。迁移逻辑位于 `src/core/migrations.ts`，在完整校验前执行：

1. `schemaVersion` 从 `1` 提升至 `2`。
2. 旧 `type: "milestone"` 节点转为 `type: "task"`，并补 `milestone: { label: "里程碑" }`。
3. 节点、边、分组缺失的 `important` 补为 `false`。
4. 缺失的文档级 `bundles` 补为 `[]`。
5. 缺失的节点宽高按当前形状默认尺寸补齐。
6. 缺失的 `display.palette` 补为 `default`；未知值先回退默认配色。
7. 清理无效束成员，并按“单成员束退化”规则把束标签回写到剩余边。

迁移后再次保存会写出 schema 2。容器格式仍为 `containerVersion: 1`，因此旧容器的 ZIP/manifest/checksum 读取流程不变，只是 `document.json` 内容升级。

导入协议 `workflow-import` 仍为 v1；它兼容旧 `milestone` 导入类型，并在生成可编辑文档时映射为上述 schema 2 节点。

## 迁移原则

1. 先增加读取迁移，再提升写出版本。
2. 不删除未知但可保留的节点内容字段。
3. 不支持的新 schema 明确拒绝，不猜测语义。
4. 布局和导出物可重建，不能成为语义权威来源。
