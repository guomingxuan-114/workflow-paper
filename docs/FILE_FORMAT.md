# `.wflow` 工作流文件格式

扩展名、MIME 类型、产品名和 schema 版本集中定义在 `src/config/product.ts`，以后改名不需要搜索散落在 UI 中的文件后缀。

## 容器

`.wflow` 是标准 ZIP，当前 `containerVersion` 为 `1`：

```text
manifest.json
document.json
assets/README.txt
preview/README.txt
```

- `manifest.json`：容器格式、版本、产品、生成时间、`document.json` 校验值及文件清单。
- `document.json`：唯一权威语义与布局来源。
- `assets/`：预留附件目录，初版只保存说明占位。
- `preview/`：可重建预览缓存目录，初版只保存说明占位；它不是权威数据。

打开文件时先校验 ZIP 可解压、manifest 格式、容器版本和文档校验值，再校验节点、关系、分组及布局引用。损坏文件会给出明确错误，不会静默覆盖原文件。

## `document.json`

```json
{
  "schemaVersion": 1,
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
  "layout": {
    "nodes": {},
    "groups": {},
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
  },
  "display": {
    "showDescriptions": true,
    "theme": "paper"
  }
}
```

### 语义字段

`nodes` 使用稳定 ID，包含：

- `title`、`description`、`type`、`tags`
- `origin.kind`: `manual` 或 `import`
- 导入节点额外包含 `system`、`version`、`commit`、`originalId`、`importedAt`
- 可选 `source.file/language/symbol/url`

`edges` 包含稳定 ID、方向端点 `source`/`target`、可选 `label` 和来源。端点必须引用存在的节点。

`groups` 包含稳定 ID、标题、直接成员 `nodeIds`、可选嵌套父组 `parentId`、折叠状态和颜色提示。

### 布局字段

`layout.nodes` 和 `layout.groups` 只保存位置及尺寸。`layout.viewport` 保存画布视口。拖动节点、移动分组或缩放不会修改 `nodes`、`edges` 或 `groups` 的语义内容。

`metadata.updatedAt` 在编辑时更新；导入来源和手工内容不会因重新排版被删除。

## 迁移原则

1. 先增加新 schema 的读取迁移函数，再提升写出版本。
2. 不删除未知但可保留的节点内容字段；迁移层负责显式映射。
3. schema 不兼容时拒绝打开并提示版本，不尝试猜测。
4. 预览和导出物可重建，不能成为语义权威来源。

