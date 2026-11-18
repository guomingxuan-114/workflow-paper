# 流程稿纸

一款本地优先、可嵌入开发工具的可视化工作流文档编辑器。初版提供宿主无关的 TypeScript 编辑器核心、轻量浏览器外壳和本地原子保存服务。

## 直接使用（不用终端）

- 桌面双击 **“流程稿纸 - 打开”**：后台启动本地服务并自动打开浏览器。
- 桌面双击 **“流程稿纸 - 关闭服务”**：停止后台服务。
- 也可以直接双击项目根目录的 `流程稿纸.exe`。

启动器使用开发源码和热更新模式，无需看到终端。修改源码后，在已打开的浏览器中刷新即可调试。

## 运行

要求 Node.js 20 或更高版本。

```powershell
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:4173`。开发模式同时启用本地宿主接口，保存的工作流进入仓库下 `documents/` 目录。

生产运行：

```powershell
pnpm build
pnpm start
```

`pnpm dev` 与 `pnpm start` 均只监听 `127.0.0.1`，无需账号或网络服务。也可以把 `dist/` 放入任意静态 WebView；此时文件保存会退化为浏览器下载，草稿恢复继续使用 IndexedDB。

## 初版能力

- 空白画布、右键建点、节点内容编辑和详情面板。
- 节点整圈边框都是连接起点；不显示固定连接圆点，拖动起点决定 source，落点节点决定 target。
- 从节点连接点拖到空白处创建后继节点，拖到已有节点建立关系。
- 点击连线编辑关系标签；节点拖动仅修改布局。
- 同一 source 且自然从同侧离开的多条边共享计算主干与分叉点，右键分叉点可统一编辑各出口条件。
- 框选、多选、复制粘贴、删除、撤销重做、缩放和平移。
- 将所选节点组成可折叠分组，拖动分组会带动已有成员的空间位置。
- 画布与结构化大纲双向选择、标题同步和大纲编辑。
- 自动缓存未保存编辑；异常退出后可恢复草稿。
- `.wflow` ZIP 单文件容器；本地外壳采用临时文件、落盘同步与原子替换。
- 导入协议 v1 的结构化程序版本 JSON，并保留源 ID、版本和提交信息。
- 两个导入快照的节点、关系与分组差异对比。
- 分页 PDF 打印文档：总览页、分组详情页、图例、版本和页码，文字及连线为矢量。
- PDF 尊重分组折叠状态，并为分支源节点生成出口条件表。
- 窄窗口抽屉式侧栏，为后续 IDE WebView 预留小尺寸布局。
- 顶栏可切换浅色/深色界面，主题随工作流保存；PDF 始终保持打印友好的浅色版式。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Tab` / `N` | 新建步骤；有选中节点时自动连接 |
| `E` / `Enter` | 编辑选中节点 |
| `Delete` | 删除选择 |
| `Ctrl/Cmd + C` / `V` | 复制与粘贴节点及内部关系 |
| `Ctrl/Cmd + Z` | 撤销 |
| `Ctrl/Cmd + Shift + Z` / `Ctrl + Y` | 重做 |
| `Ctrl/Cmd + S` | 保存 |
| `Ctrl/Cmd + F` | 查找节点 |
| `Ctrl/Cmd + Shift + O` | 切换画布与大纲 |
| `Ctrl/Cmd + 0` | 缩放至适应画布 |
| `G` | 将所选节点创建为分组 |

鼠标操作：左键拖动空白处平移画布；右键空白画布选择节点类型；拖动节点内部调整位置；从节点整圈边框按下并拖到空白创建后继，拖到另一节点任意位置建立关系；点击连线选择关系；拖动分组标题区域移动分组及成员；`Shift + 拖动`框选。第一个节点默认是普通步骤，开始/结束只表示显示语义，不限制连接。

## 示例与导入

- 内置示例：欢迎页“导入示例”，或编辑器的“导入”对话框。
- 完整工作流示例：[examples/sample-workflow.wflow](examples/sample-workflow.wflow)
- 导入 JSON 示例：[examples/import-snapshot.v1.json](examples/import-snapshot.v1.json)
- JSON Schema：[examples/workflow-import.v1.schema.json](examples/workflow-import.v1.schema.json)

重新生成示例容器：

```powershell
pnpm example:wflow
```

导入适配器只读取明确的 `workflow-import` v1 JSON，不解析任意源码。导入节点 ID 由来源 ID 与原始节点 ID 稳定派生，因此版本对比能识别同一节点的增删改。

## PDF

点击“导出 PDF”会打开打印预览。请在系统打印对话框中选择“另存为 PDF”。文档使用系统中文字体栈（微软雅黑、苹方、Noto CJK），文字保持可检索，连线是 SVG 矢量路径。大型工作流按分组和每页节点上限分页。

直接保存时请选择“另存为 PDF”；产品不会把 PDF 当作可编辑源文件。

连接交互验收截图位于 [output/screenshots](output/screenshots)：
普通连接、反向连接、垂直连接和一源多出边分支各一张。

## 架构

```text
src/core/         文档模型、校验、导入、差异、容器编解码
src/core/edgeRouting.ts  画布与 PDF 共用的方向、主干、分叉和分支臂路由
src/persistence/  IndexedDB 恢复草稿
src/host/         打开、保存、打印和宿主上下文适配边界
src/components/   React 编辑器 UI 与 React Flow 空间交互
src/pdf/          可打印的 HTML/SVG 文档生成
scripts/          本地宿主、原子文件写入和示例生成
e2e/              Playwright 浏览器验收
```

文档语义（`nodes`、`edges`、`groups`）与布局（`layout`）是分开的字段。拖动、缩放、折叠不会改写节点标题、描述、关系或来源。`.wflow` 格式详见 [docs/FILE_FORMAT.md](docs/FILE_FORMAT.md)。

产品名、扩展名、MIME、版本和草稿库名统一位于根目录 [product.config.json](product.config.json)，前端、本地宿主和示例生成器共同读取该配置。

## 技术选型

- TypeScript + React + Vite：宿主无关、启动快、可嵌入 WebView。
- `@xyflow/react`（React Flow，MIT）：成熟的节点、端口、缩放、框选和连线交互；图形层可替换，文档模型不依赖它。
- `fflate`（MIT）：体积小、同步 ZIP 编解码，容器内容仍是可校验 JSON。
- `lucide-react`（ISC）：轻量线性图标，不引入品牌资产。
- IndexedDB：浏览器本地异步草稿缓存，不需要后端。
- Node 本地宿主：提供可验证的同目录临时文件加原子替换；浏览器静态部署则回退为下载。

## 已知限制

- PDF 依赖用户系统中文字体；不存在中文字体的极简环境需要安装 Noto Sans CJK。
- 浏览器静态部署无法提供任意路径的原子覆盖，只提供下载；原子保存由本地宿主实现。
- 分组当前以节点列表归组，一个节点只进入一个直接分组；跨组语义关系仍通过边表达。
- 大纲可编辑标题、选择和分组折叠，但不提供拖放重排语义边。
- 版本对比基于同一导入来源的稳定节点 ID，不推断跨来源的节点重命名。
- 分叉条件暂存在边标签中，不引入执行语义；改变 source/target 仍需删除后重连。
- 平移和缩放会随后续保存写入视口，但视口本身不触发未保存状态、草稿或自动保存。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

最近一次验证结果保存在 [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md)。

