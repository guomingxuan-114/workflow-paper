# 验证结果

验证日期：2026-11-20（Asia/Shanghai）
版本：`0.2.3`
文档 schema：`2`

## 必需检查

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| TypeScript | `pnpm typecheck` | 通过，0 个类型错误 |
| 单元/集成测试 | `pnpm test` | 通过，7 个测试文件、46 个测试 |
| 生产构建 | `pnpm build` | 通过 |
| Playwright 端到端 | `pnpm test:e2e` | 通过，11 个 Edge 场景 |

生产构建主要产物：

```text
dist/index.html                       0.89 kB
dist/assets/index-*.css              61.25 kB
dist/assets/archive-vendor-*.js      12.43 kB
dist/assets/flow-vendor-*.js        203.57 kB
dist/assets/index-*.js              352.17 kB
```

## 单元与集成覆盖

- v1 → v2 迁移：旧 `milestone` 类型转普通任务并补 `milestone` 对象。
- v1 `.wflow` 容器打开后升级为 schema 2，旧 checksum/container 读取兼容。
- 新建空白默认普通任务，不会把第一个节点强制设为开始。
- 节点 ID 稳定；布局移动不改变节点、边或分组语义。
- 分组拖动同步节点、嵌套子组和分组位置；打包重开后不回弹。
- 普通拖动节点不改变归属；显式移出分组生效。
- 节点尺寸网格吸附和形状最小尺寸。
- 整边框连接的方向由拖动起点/终点决定，禁止自连和重复边。
- 同源多出边始终各自独立；旧 `bundles` 兼容数据不再合并画布线条。
- 左键拖动任意线段会投影到原路径得到断点 C，拆为 `A → C → B`，并从 C 派生 D。
- 判断椭圆和普通方框共用边界射线与触点分布算法。
- 正向、反向、垂直和斜向路径不穿过源/目标节点主体。
- 右键线中插步与标签锚点继承规则保持独立。
- 一次拖线产生的 C、D 和三条关系合并为一个撤销 checkpoint；C 默认为分叉点，D 为普通节点。
- 原边两端位于同一分组时，新建 C、D 自动进入该分组。
- 版本差异覆盖节点里程碑/重要、边端点/标签/重要/`bundleId`、分组标题/折叠/颜色/成员/父组/重要。
- 视口变化不进入持久内容指纹，不单独制造未保存状态。
- 容器 manifest 使用 `documentSchemaVersion: 2`，主题与配色往返保存。
- PDF 包含中文字体栈、矢量路径、椭圆/胶囊/便签、独立分支线、分叉点、反向边、重要色、备注虚线、页码。
- PDF 所有分支细枝路径以 `M` 开头，不直接输出只以 `C` 开头的臂路径。
- 手动调整过尺寸的节点切换类型时保留尺寸；仍是旧默认尺寸时自动采用新形状默认尺寸。
- 实时节点位置覆盖不替换语义 `nodes`/`edges` 数组；侧向边在目标高于/低于源节点时分别向上/下弯曲。
- 单线和分叉点的每条分支均为独立连续三次贝塞尔曲线，不含 `L` 直线路径。
- 简化拖动预览仍使用平滑曲线；拖动中的节点 DOM 实例保持稳定。
- PDF 里程碑和重要节点使用 palette 派生的混合填充色，不再只改描边。
- 右键插入和边框派生的普通节点标题为“未命名节点”；拖线派生在鼠标按下路径处创建空标题分叉点，落点新节点仍为普通“未命名节点”。
- 普通节点画布边框和命中边界使用 12px 弧角矩形；拖线中的两个临时占位同样显示“未命名节点”。
- 分叉点使用 `fork` 内部类型，标题可为空，跑道形边界和 PDF 图形复用胶囊几何。
- 分叉点可从类型下拉切换为普通节点、判断、开始、结束或备注。
- 从线段拖出的起点节点默认类型为 `fork`，落点新节点仍为普通节点。
- 普通节点多条出边不会自动生成分叉点或共享主干。

## 端到端场景

1. 连接视觉：整边框普通连接、反向连接、垂直连接和深色界面截图。
2. 0.2 功能：独立分支线、线中插节点、备注无箭头虚线、里程碑/重要分类、节点成员标记与显式移出、分组弧形框、参考主题和 PDF。
3. 0.2.1 视觉修复：判断节点只显示标题、标签 chips、强调填充、尺寸输入、类型切换尺寸、无 NodeResizer、拖动元素不重挂载和 PDF 强调填充。
4. 核心编辑：新建、节点编辑、撤销重做、自动缓存、原子保存、重新打开、异常退出恢复、PDF 和 390 x 840 窄窗口。
5. 导入：结构化快照、分组折叠、节点移动、关系标签、大纲同步、版本差异和分页 PDF。
6. 0.2.1 线中交互补丁：右键插入节点、拖线投影派生、单 checkpoint 撤销重做、已有节点命中、实时 Inspector 和 PDF 导出。
7. 0.2.3 分叉点对象：右键创建、空标题出边计数、紧凑跑道形、标题与计数并列、类型切换、删除撤销和 PDF 渲染。
8. 0.2.3 独立线条：普通节点多条出边保持独立，线段拖拽断点为分叉点，旧圆形计数按钮消失。

真实浏览器验证同时覆盖：

- `B → A` 拖动后箭头指向 A。
- 节点内部拖动只改位置，边框拖动才建立连接。
- 画布/大纲往返切换不会重复挂载并崩溃。
- 右键线段的“插入节点”菜单可正常执行。
- 平移画布后状态仍为“已就绪”。
- 折叠分组保存重开后状态和成员位置一致。
- 判断节点没有描述和底部栏；常规节点不再显示 ID 或“未标记”。
- 拖动过程中节点 DOM 实例保持同一引用，所有相连边路径持续更新且不含 `L` 直线段。
- 标题、宽高、描述、标签、连线标签和分组名无需失焦即可反映到画布；一次撤销回退整段标题输入。

## PDF 人工检查

最终参考 PDF：[`output/pdf/version-023.pdf`](../output/pdf/version-023.pdf)。

- 3 页，A4 纵向，595.92 x 842.88 pt。
- 第 1 页为总览、版本、来源、生成时间、统计与图例，分叉点使用跑道形并显示标题与出边计数。
- 第 2 页列出分叉点的 3 条出口与关系状态。
- 第 3 页列出全部节点，分叉点的类型标签显示为“分叉点”。
- 所有页面均以 144 DPI 渲染并逐页检查，无中文乱码、黑块、文字裁切或重叠。
- 使用 `pypdf` 成功提取“发布分支”“分叉点”和“第 3 / 3 页”，文本中不存在 `NaN`。

## 验收截图

- [整边框普通连接](../output/screenshots/01-normal-connection.png)
- [反向连接](../output/screenshots/02-reverse-connection.png)
- [判断椭圆与独立分支线](../output/screenshots/06-independent-branches.png)
- [线段拖拽分叉点](../output/screenshots/06-line-fork-zoom.png)
- [普通节点独立分支](../output/screenshots/06-independent-branches.png)
- [右键线中插入节点](../output/screenshots/08-insert-step-menu.png)
- [里程碑与重要分类](../output/screenshots/09-milestone-important.png)
- [备注虚线无箭头](../output/screenshots/10-note-dashed.png)
- [分组弧形框与重要分组](../output/screenshots/11-group-emphasis.png)
- [默认配色](../output/screenshots/12-default-theme.png)
- [包豪斯灵感参考主题](../output/screenshots/13-bauhaus-theme.png)
- [PDF 总览页](../output/screenshots/14-pdf-overview.png)
- [普通节点与标签 chips](../output/screenshots/15-step-tags.png)
- [判断椭圆与内接标题](../output/screenshots/16-decision-ellipse.png)
- [里程碑淡色填充](../output/screenshots/17-milestone-fill.png)
- [重要节点淡色填充](../output/screenshots/18-important-fill.png)
- [备注节点](../output/screenshots/19-note-node.png)
- [类型切换与手动尺寸保留](../output/screenshots/20-resized-type-switch.png)
- [拖动实时渲染](../output/screenshots/21-live-drag.png)
- [PDF 强调色总览](../output/screenshots/22-pdf-emphasis.png)
- [拖动中的平滑连线](../output/screenshots/23-live-smooth-routing.png)
- [右侧栏实时映射](../output/screenshots/24-realtime-inspector.png)
- [平滑曲线 PDF](../output/screenshots/25-pdf-smooth-curves.png)
- [线段断点与派生节点](../output/screenshots/26-line-derivation.png)
- [拖线中的普通节点预览](../output/screenshots/27-box-preview.png)
- [空标题分叉点与跑道形](../output/screenshots/28-fork-point.png)
- [分叉点 PDF](../output/screenshots/29-fork-pdf.png)
- [普通节点多出边保持独立](../output/screenshots/30-independent-branches.png)

## 清理

- Playwright trace、失败截图和 HTML 报告进入已忽略目录。
- PDF 渲染中间 PNG 位于 `tmp/` 下既有验证目录，属于可删除验证产物。
- 最终示例 PDF 和版本验收 PDF 位于 `output/pdf/`。
- 示例工作流位于 `examples/sample-workflow.wflow`。

## 已知限制

- 尚未在真实 VS Code/JetBrains WebView 中完成插件宿主集成。
- 未对数千节点压力场景做长期性能测试；当前采用路由缓存和自适应简化帧。
- 大纲支持标题双向同步、选择和折叠，不支持拖放重排语义关系。
- 一个节点当前只有一个直接所属分组；跨组关系仍由边表达。
- 自动插入默认落在点击位置；标签继承按可见文字锚点与点击进度判断，无法判断时默认留在 source 段。
- PDF 依赖系统存在中文字体；当前 Windows 验证使用系统字体。
