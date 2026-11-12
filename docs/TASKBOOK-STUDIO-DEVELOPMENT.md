# Sparo 媒体工作台 · 并行开发任务书（T0 → T6）

> 执行对象：多个 Cursor 窗口。
>
> 仓库根：`d:\download\sparo上架应用商店版`
>
> 权威开发方案：`docs/STUDIO-DEVELOPMENT-PLAN.md`
>
> 产品边界：`docs/MEDIA-STUDIO-PRODUCT.md`
>
> 历史任务：`docs/TASKBOOK-MEDIA-STUDIO.md`
>
> 本文是新一轮 R1–R6 的执行编排，不回头扩大 P0a–P3 的历史验收。

---

## 0. 执行方式：五个窗口，四个真正并行

### 0.1 推荐窗口分配

| 窗口 | 任务 | 执行顺序 | 主要职责 |
|---|---|---|---|
| Cursor 1 · 集成窗口 | T0 → I1 → T5 → T6 | 串行 | 基础壳、共享契约、IPC 集成、真实发布、安装包 |
| Cursor 2 · 数据窗口 | T1 | T0 后并行 | 工作台首页、六块数据视图、数据环境贯穿 |
| Cursor 3 · 发稿窗口 | T2 | T0 后并行 | 发稿、账号、预检、本地图片、草稿 |
| Cursor 4 · 评论窗口 | T3 | T0 后并行 | 评论收件箱、回复草稿、评论环境贯穿 |
| Cursor 5 · 任务窗口 | T4 | T0 后并行 | 发布事件模型、旧台账投影、任务中心 UI |

任务数固定为 **T0–T6 共七段，加一次集成门 I1**。不要把页面再拆成更多小任务，也不要让多人同时改 `studio.html`、`browser.ts` 或 `preload.ts`。

### 0.2 依赖图

```text
T0 视觉基础、模块拆壳、共享契约、环境上下文（串行）
  │
  ├──────────────┬──────────────┬──────────────┐
  ▼              ▼              ▼              ▼
T1 首页与数据   T2 发稿与账号   T3 评论         T4 任务模型与任务中心
  └──────────────┴──────────────┴──────────────┘
                 ▼
        I1 统一 IPC 接线、页面点通、分阶段提交（串行）
                 ▼
        T5 真实发布接入与安全续跑（串行）
                 ▼
        T6 恢复、视觉清理与安装包验收（串行）
```

### 0.3 R1–R6 与任务映射

| 开发方案阶段 | 本文任务 |
|---|---|
| R1 视觉基础与导航骨架 | T0 |
| R2 工作台与数据页 | T1 + I1 |
| R3 发稿、账号与预检 | T2 + I1 |
| R4 发布批次与持久任务中心 | T4 + I1 |
| R5 真实发布接入与安全续跑 | T5 |
| R6 评论布局、恢复与安装包收尾 | T3 + T6 |

---

## 1. 所有窗口共同遵守

### 1.1 产品与安全红线

1. 不改 `docs/listings/`，不改 `package.json` 的 `version`，不推远程。
2. 不引入 React、Tailwind、ECharts、图标包或其他新 npm 依赖；不做远程 UI 或 WebSocket。
3. 保留八步：`openBlank → fillTitle → fillBody → insertImages → setCover → setOptions → publishOrSchedule → verify`，保留 `--from`。
4. 发布请求由平台页面发起；不抓 token、不伪造签名、不落盘 Cookie，不做模拟指纹或 API 分片直传。
5. 写稿不要求登录；预检只检查所选平台；一个平台失败不影响其他平台回执。
6. 评论只填平台回复框，由人发送；没有「发送」或「我已发送」按钮。
7. 数据只发 GET，并在对应 `envId` 的平台标签页上下文执行。
8. 缺失数据不写 0，结果未知不写成功或失败，测试夹具不得进入生产数据。
9. 不做定时、一键错峰、跨环境矩阵发布、富文本编辑器重构或新平台扩展。
10. 新增提前结束任务的本地判断前，先登记 `docs/DECISION-POINTS.md`；没有新增就不要改该文件。

### 1.2 环境规则

- 所有新 IPC、草稿、预检、任务、执行、核验、指标、评论都必须显式携带 `envId`。
- 缺 `envId` 或环境不存在时停止并返回人话错误，**不得回退到默认环境**。
- 旧数据只有归属明确时才迁移；否则标「未关联」，不擅自归入当前环境。
- 环境标签继续使用 `webPreferences.partition`，不得把 `session` 放到 `WebContentsView` 构造参数顶层。

### 1.3 多窗口文件纪律

默认多个 Cursor 共用当前工作目录，采用「文件锁 + 集成窗口统一提交」：

1. 每个窗口只能改自己任务中列出的文件；需要改共享文件时停下，在回报中写明，由 Cursor 1 处理。
2. `src/main/browser.ts`、`src/main/preload.ts`、`src/renderer/studio.html`、`src/renderer/studio.ts`、`src/renderer/studio.css` 永远归 Cursor 1。
3. 并行窗口不执行 `git add .`、`git add -A`、`git commit -a`、`git stash`、`git reset`、`git checkout`、`git restore`、`git clean`。
4. 并行窗口完成代码和自测后只回报，不各自提交；Cursor 1 按任务文件清单分别暂存并提交，保留 R1–R4 的独立提交。
5. 不自行创建 worktree。当前工作区可能还有未提交的多账号改动，换基线前必须先确认这些改动已包含，否则容易做成两套浏览器。
6. 任何窗口发现别的窗口正在改同一文件，不覆盖、不格式化整文件，先报告冲突。

### 1.4 每段共同交付门

```powershell
npm run typecheck
npm run test
```

- 两个命令都绿才回报；另外运行本段列出的定向测试。
- T1–T4 在 IPC 尚未由 I1 接线前，只做页面组件、服务与定向测试，不宣称完成真机验收；真实 Sparo 点击统一由 Cursor 1 在 I1 逐阶段执行。T0、T5、T6 的页面改动仍由 Cursor 1 当场点通。
- 并行窗口不要同时运行 `npm run start`、`npm run dist` 或连接同一个 `%APPDATA%\sparo-store` 做真机测试，避免 3921 端口、开发窗口和本地数据互相干扰。
- 自动化测试使用独立临时目录与临时 SQLite / JSONL，不删除、不改写真实草稿、指标快照、评论缓存或发布台账。
- T0–T4 不真实发布；T5 的真实文章发布和真实评论发送只由人执行。
- 回报格式统一为：改动文件、行为变化、测试输出、真实点击结果、未完成项、需要集成窗口处理的共享接线。

---

## 2. T0 前必须确定的共享契约

Cursor 1 在 T0 建立以下模块边界。其他窗口只使用这些接口，不自行修改桥接层。

### 2.1 渲染层文件边界

```text
src/renderer/studio.html                 仅静态骨架与入口，归 Cursor 1
src/renderer/studio.ts                   启动、路由、环境切换、页面组装，归 Cursor 1
src/renderer/studio.css                  Token、reset、布局、共享组件，归 Cursor 1
src/renderer/studio/api.ts               sparkStudio 类型化封装，归 Cursor 1
src/renderer/studio/types.ts             共享 ViewModel 与状态类型，归 Cursor 1
src/renderer/studio/dom.ts               必要的 DOM、安全文本与格式化工具，归 Cursor 1
src/renderer/studio/pages/home.ts        T1
src/renderer/studio/pages/home.css       T1
src/renderer/studio/pages/metrics.ts     T1
src/renderer/studio/pages/metrics.css    T1
src/renderer/studio/pages/compose.ts     T2
src/renderer/studio/pages/compose.css    T2
src/renderer/studio/pages/accounts.ts    T2
src/renderer/studio/pages/accounts.css   T2
src/renderer/studio/pages/comments.ts    T3
src/renderer/studio/pages/comments.css   T3
src/renderer/studio/pages/tasks.ts       T4
src/renderer/studio/pages/tasks.css      T4
```

页面模块采用统一出口，具体类型在 `types.ts` 冻结，函数名不另起一套：

```text
mount(container, viewModel, actions) → { destroy() }
```

- `container` 由路由提供；页面只更新自己的容器。
- `viewModel` 来自 IPC 或测试显式注入，必须是该页面需要的判别联合类型，不使用 `any`。
- `actions` 只调用 `api.ts` 暴露的意图，不直接访问 Node、Electron 或平台请求。
- 路由切换、环境变化和页面卸载时必须调用 `destroy()`，清理 DOM 监听、订阅与定时器。
- 测试夹具只允许出现在 `tests/` 或页面函数的测试调用中，生产入口不得加载假数据。

### 2.2 IPC 语义

保留现有 `load / create / save / precheck / confirm / refresh / reply`，最小补充下列能力。名称可微调，但 T0 必须一次性把参数与返回类型写清，后续窗口不得各改一套。

| 方法语义 | 必须参数 | 说明 |
|---|---|---|
| 加载工作台 | `envId` | 返回环境、草稿、首页、指标、评论与任务的只读 ViewModel |
| 新建 / 保存草稿 | `envId`、完整草稿、`revision` | 保存返回新 `revision` 与保存时间 |
| 预检 | `envId`、草稿、`revision` | 返回 `precheckId / envId / draftRevision / snapshotHash / platforms / rows` |
| 确认 | `envId / precheckId / confirmationId` | T0–T4 不接生产执行；T5 才启用 |
| 选择本地图片 | `envId / draftId / kind` | `kind` 为正文或封面；返回本地文件与草稿内预览信息 |
| 核验账号 | `envId / platforms` | 只核验指定平台 |
| 打开平台后台 | `envId / platform` | 使用对应环境标签 |
| 刷新数据 | `envId` | 保留 5 分钟冷却与串行采集 |
| 查询任务 | `envId` | 返回批次、平台任务、尝试与回执投影 |
| 打开任务页面 | `envId / jobId` | 只打开对应平台页 |
| 核验任务 | `envId / jobId` | 只 verify / 列表回读，不重新提交 |
| 续跑任务 | `envId / jobId / fromStep` | T5 才启用；服务端重新判断是否允许 |
| 填入评论回复 | `envId / platform / commentId / text` | 只填唯一目标回复框并读回 |
| 订阅任务变化 | `envId` | 只推送该环境事件，返回取消监听函数；`destroy()` 必须取消 |

统一错误返回至少包含：

```text
ok / code / message / envId
```

未知能力返回 `unsupported`，不得返回假成功。T0 可以先让未接线能力显示「尚未接入」，但最终 I1 后不得留无功能按钮。

### 2.3 共享状态名称

所有页面复用 `types.ts`：

- 数据完整度：`full / partial / missing / unsupported`。
- 展示状态：`stale / login_missing / error / unknown`。
- 账号状态：`checking / ok / login_missing / error / unknown`。
- 提交状态：`not_submitted / submitting / submitted_unknown / verified`。
- 用户任务状态：等待确认、排队中、打开发布页、填写内容、处理图片与封面、设置平台选项、提交中、核验结果、已发布、发布失败、需要人工、结果待核验。

### 2.4 T0 必须冻结的 TypeScript 契约

T0 不只写方法名，必须在 `types.ts` 中冻结下列结构及页面子类型；这些类型未建立前，不得通知 T1–T4 开工。

```text
AsyncView<T> =
  | { status: "loading" }
  | { status: "ready"; value: T; capturedAt: string }
  | { status: "empty"; reason: string }
  | { status: "error" | "missing" | "unsupported" | "stale" | "login_missing";
      message: string; previous?: T; capturedAt?: string }

StudioViewModel = {
  env: { envId: string; name: string; availableEnvs: Array<{ envId: string; name: string }> }
  drafts: AsyncView<DraftSummary[]>
  home: AsyncView<HomeViewModel>
  metrics: AsyncView<MetricsViewModel>
  comments: AsyncView<CommentsViewModel>
  tasks: AsyncView<TasksViewModel>
}

PrecheckResult = {
  precheckId: string
  envId: string
  draftRevision: number
  snapshotHash: string
  platforms: string[]
  rows: PrecheckRow[]
}

TaskChangedEvent = {
  eventId: string
  eventType: string
  occurredAt: string
  envId: string
  runId?: string
  jobId?: string
  attemptId?: string
}
```

`PageActions` 至少冻结：`navigate(view, filter?) / reload(envId) / saveDraft / precheck / confirm / pickImages / checkAccounts / openAccount / refreshMetrics / openTask / verifyTask / resumeTask / fillReply / onTasksChanged(envId, listener)`。每个异步动作返回统一结果或 `PrecheckResult` 等明确类型，不能由页面各自猜测字段。

`HomeViewModel / MetricsViewModel / CommentsViewModel / TasksViewModel` 按第 5 节页面线框与第 6 节对象模型展开到字段级；数字附加来源、完整度和采集时间，任务附加环境、批次、尝试与回执。T0 的验收必须包含契约类型测试。

---

## 3. T0 · 视觉基础、模块拆壳与环境上下文

**执行窗口：Cursor 1。前置：无。后续所有任务必须等 T0 完成。**

### 文件所有权

- `src/renderer/studio.html`
- `src/renderer/studio.ts`
- `src/renderer/studio.css`
- `src/renderer/studio/api.ts`
- `src/renderer/studio/types.ts`
- `src/renderer/studio/dom.ts`
- `src/main/preload.ts`
- `src/main/studio-env.ts`（新建）
- `src/main/browser.ts`
- `tests/studio-shell.test.ts`（如需要）

### 改动

1. 按开发方案第 3、4 节建立完整 Token、CSS layer、字体、按钮、表单、卡片、状态标签、焦点与响应式规范。
2. 将现有单文件工作台拆成上述模块；先保持旧功能可用，再逐步由 T1–T4 替换页面，不在本段新造业务实现。
3. 完成石墨侧栏、56px 顶栏、五个一级导航、232px / 64px 侧栏两种形态与 12 栏内容栅格。
4. 顶栏加入环境选择器；切换环境重新加载各页面 ViewModel，不在同一平台标签切换登录态。
5. `studio-env.ts` 提供唯一环境校验与解析入口；调用方拿不到有效 `envId` 就停止，不在各模块自行写默认环境兜底。
6. 按第 2 节补齐类型化 API、完整 ViewModel、`PageActions`、事件与清理契约及 preload 桥。本段不接真实发布，不创建生产发布任务。
7. 在路由中登记五个页面与发布记录的位置；并行模块未接入前只显示明确空态，不出现可点击的假功能。
8. 保留侧栏「媒体工作台」入口和现有 `sparo://studio` 打开方式，不改走 `openReport`。

### 验收

- 1440 / 1280 / 1024 / 800 四档宽度无整页横向滚动；侧栏折叠后入口仍可访问。
- 键盘焦点清晰，图标按钮有 `aria-label` 与 `title`，尊重 `prefers-reduced-motion`。
- 视觉符合浅色内容区 + 石墨侧栏，无渐变、毛玻璃、emoji 图标、调试 JSON。
- 环境切换会触发相同 `envId` 的加载；缺失环境时有明确错误，不回退默认环境。
- 契约类型测试通过：预检包含修订、平台集合和环境，任务订阅按环境过滤，页面 `destroy()` 能取消监听。
- 现有新建稿、保存、预检、确认单、数据与评论入口没有因拆壳而失效。
- 实际点击五个导航和侧栏入口，控制台无报错。
- `npm run typecheck`、`npm run test` 全绿。

### 交付

Cursor 1 自测后提交 R1 独立 commit，再通知另外四个窗口开始。不要在 T0 未完成时提前并行。

---

## 4. 第一波并行：T1 / T2 / T3 / T4

四个窗口可以同时工作。**都只能改自己的文件；共享接线统一留给 I1。**

### T1 · 工作台首页与数据页

**执行窗口：Cursor 2。前置：T0。**

#### 文件所有权

- `src/renderer/studio/pages/home.ts`
- `src/renderer/studio/pages/home.css`
- `src/renderer/studio/pages/metrics.ts`
- `src/renderer/studio/pages/metrics.css`
- `src/main/studio-data.ts`（新建）
- `strategies/skills/social-media-publish/scripts/collector.mjs`
- `strategies/skills/social-media-publish/scripts/metrics-db.mjs`
- `tests/studio-metrics.test.ts`
- `tests/studio-home.test.ts`（如需要）

不得修改 `studio.html`、`studio.ts`、`studio.css`、`api.ts`、`types.ts`、`preload.ts`、`browser.ts`。

#### 改动

1. 首页实现：需要处理、待发任务、失败任务、昨日阅读、本月收益、最近发布、最新评论。
2. 待办数字可进入对应筛选视图；动作通过 T0 的 `actions` 表达，不自建路由。
3. 数据页完整实现六块：总览卡、趋势、内容榜、平台对比、收益拆分、异常；平台对比与收益拆分可用页签组合。
4. 所有指标带平台、来源、采集时间与完整度；真实 0 显示 0，缺失显示 `—`。
5. 趋势只使用历史快照；缺失点断线，单天显示「暂无趋势」，不画假平线。
6. 聚合阅读标「相加，非去重」，收益标「账面相加，非到账」；任一平台 `partial` 不显示聚合涨跌百分比。
7. 数据服务与采集器显式传递 `envId`；GET 必须在对应环境平台标签页上下文执行，一次一个平台串行补拉。
8. 指标表继续产品书既定主键，不擅自改键。无法通过 `accountId` 明确关联环境时暂停写入，不串号。
9. 保留打开先画快照、5 分钟手动刷新冷却、失败保留旧值，不新增常驻轮询。

#### 验收

- 六块视图都有真实内容或明确空态，不能用平台明细代替平台对比与收益拆分。
- `undefined / null / unsupported / missing` 不变成 0；`stale / missing / unsupported / login_missing` 文案与动作不同。
- 内容榜不出现 `JSON.stringify`；长标题、大数字、负粉丝数不破坏布局。
- 断网或接口错误保留旧快照并显示「未获取到新数据，仍显示原时间结果」。
- 非默认环境的采集调用、账号关联与返回 ViewModel 全部带同一个 `envId`；缺失时停止。
- 页面在组件测试中用明确夹具点击刷新、筛选、页签与待办入口，验证调用参数和状态渲染；真实 Sparo 点击由 I1 执行。
- 定向测试与共同交付门通过。

---

### T2 · 发稿、账号与预检

**执行窗口：Cursor 3。前置：T0。**

#### 文件所有权

- `src/renderer/studio/pages/compose.ts`
- `src/renderer/studio/pages/compose.css`
- `src/renderer/studio/pages/accounts.ts`
- `src/renderer/studio/pages/accounts.css`
- `src/main/studio-store.ts`
- `src/main/studio-accounts.ts`（新建）
- `tests/studio-precheck.test.ts`
- `tests/studio-accounts.test.ts`（如需要）

不得修改共享壳、preload、browser、发布引擎、适配器和台账。

#### 改动

1. 发稿采用「共性内容 8 栏 + 发布平台 4 栏」，小窗口单栏；底部动作栏在编辑容器内 sticky。
2. 共性内容只填一次；平台卡只展示该平台标题、封面模式、分类、原创及其他差异项，同时只展开一张。
3. 卡片头显示完整度和第一个缺项；越界只标红说明，不自动缩短。
4. 保留 Markdown、自动保存与保存失败保留输入；`revision` 防止旧预检用于新稿。
5. 本地图片通过 IPC 选择，显示缩略图、文件名、移除和排序，不再要求手填本地路径。
6. 预检弹窗宽 720px，逐平台显示内容规则、平台选项、环境与登录状态；警告平台默认跳过。
7. 未登录可新建、编辑、插图和保存；只校验本次勾选的平台，未选平台不阻断。
8. 账号页只管理当前环境的平台状态；环境创建与删除仍入口到「设置 → 账号」，不另造环境管理。
9. 「重新登录 / 打开后台」只打开当前 `envId` 的平台标签；不能读取、展示或落盘 token。
10. 本段只到现有确认单，不真实发布、不创建生产 `PublishRun`。
11. 旧草稿只有归属明确时才迁移；其余标「未关联」，不清空内容、不擅自绑定环境。

#### 验收

- 全程未登录也能写稿、插图并自动保存；刷新后恢复已保存内容。
- 只选一个平台时不检查其他平台；缺封面、标题越界等与规则表一致。
- 修改草稿、平台选择或环境后，旧预检标识失效。
- 账号状态只用 `checking / ok / login_missing / error / unknown`；无法判断写「未核验」。
- 本地图片选择、预览、移除、排序、封面选择在组件与服务测试中覆盖；真实文件选择器与 Sparo 页面点击由 I1 执行。
- 确认单不出现定时、一键错峰，不执行 stage / review / commit，不向平台写草稿。
- 非默认环境草稿、预检和账号核验不串号；缺环境时停止。
- 定向测试与共同交付门通过。

---

### T3 · 评论收件箱与回复草稿

**执行窗口：Cursor 4。前置：T0。**

#### 文件所有权

- `src/renderer/studio/pages/comments.ts`
- `src/renderer/studio/pages/comments.css`
- `src/main/studio-comments.ts`（新建）
- `strategies/skills/social-media-publish/scripts/comments.mjs`
- `tests/studio-comments.test.ts`

不得修改共享壳、发布脚本、指标脚本、preload 和 browser。

#### 改动

1. 评论页采用账号 3 栏、评论列表 5 栏、回复详情 4 栏；小于 900px 改为列表与详情逐级进入。
2. 默认未回复，支持平台、内容、时间筛选；只显示探针已通平台，未通平台不伪造空列表。
3. 头条、百家允许「填入平台回复框」；大鱼、搜狐显示「只读，回复未开」。
4. 回复读取与填框显式携带 `envId`，只操作该环境已打开且定位唯一的回复框。
5. 同一时间只操作一个平台评论页；填入并读回后切到对应平台页，由人发送。
6. 工作台没有「发送」「我已发送」；是否成功只认下一次 GET。
7. 回复框未打开、定位不唯一、遇验证码时停止；填写失败保留草稿。
8. 保持单条至少 20 秒、每平台每小时 30 条，频率判断不得仅靠前端禁用按钮。
9. 评论缓存带 `envId`；无法归属的旧记录标「未关联」，不参与非默认环境展示或操作。

#### 验收

- 三栏与小窗逐级布局均无整页横向滚动，长评论不撑破容器。
- 回复定位、环境校验、填框读回与频率限制由服务测试覆盖，不真实发送评论；真实 Sparo 回复框填写由 I1 执行。大鱼、搜狐无可用回复入口。
- 切到另一平台时不能并行操作两个评论页；目标不唯一时不往其他输入框填写。
- 下一次 GET 未看到回复前不标已回复；20 秒与每小时 30 条限制不能被 UI 绕过。
- 非默认环境的评论列表、缓存、回复目标和平台页一致；缺环境时停止。
- 定向测试与共同交付门通过。

---

### T4 · 发布事件模型与持久任务中心

**执行窗口：Cursor 5。前置：T0。**

#### 文件所有权

- `src/renderer/studio/pages/tasks.ts`
- `src/renderer/studio/pages/tasks.css`
- `src/main/studio-tasks.ts`（新建）
- `strategies/skills/social-media-publish/scripts/ledger.mjs`
- `strategies/skills/social-media-publish/scripts/engine.mjs`（只改台账写入调用，不改八步行为）
- `strategies/skills/social-media-publish/scripts/batch_publish.mjs`（只改台账写入调用）
- `tests/studio-tasks.test.ts`（新建）
- 现有发布台账相关测试
- `tests/fixtures/studio/`（仅明确标注的测试夹具）

不得修改共享壳、确认按钮逻辑、`publish.mjs`、适配器、preload 和 browser。T4 必须搜索全部发布 JSONL 写调用点；除上述两个已知调用方外若还有写入者，列入本段一并收口，无法安全收口就报阻塞，不得宣称唯一写者完成。

#### 改动

1. 扩展 `ledger.mjs` 为发布事件 JSONL 唯一写入入口；其他模块不得自行 `appendFile` 写发布底账。将 `engine.mjs` 与 `batch_publish.mjs` 的现有写入全部改为调用该入口，保持旧命令行为与旧记录可读。
2. 新工作台事件统一携带 `eventId / eventType / occurredAt / envId`，按类型携带 `runId / jobId / attemptId`。旧 CLI 在 T5 前没有这些标识时只能经同一入口写兼容旧行，投影为「历史记录」；不得伪造环境，也不得借兼容路径创建新工作台批次。
3. 写入口串行追加、按 `eventId` 去重；同一事件重放返回已记录结果。
4. 建立 `PublishRun / PublishJob / PublishAttempt / Receipt` 只读投影，不另建可独立修改的第二份任务底账。
5. 旧 JSONL 只读兼容；缺字段显示「历史记录」，不回填虚假批次、环境或尝试。
6. 任务中心实现发布记录页与 420px 右侧抽屉；展示用户阶段、原始步骤、错误码、人话原因和建议动作。
7. 单平台失败不影响其他平台；重试新增 `attemptId`，成功平台没有重试按钮。
8. 提交后未知只提供「核验结果」，没有直接重试。
9. 本段真实数据只读旧台账，新模型只用测试夹具；真实确认按钮不接新任务创建，不生成无人执行的生产「排队中」任务。

#### 验收

- 测试夹具中，同一 `draftId` 两次确认形成两个 `runId`，每平台任务独立。
- 相同 `eventId` 重放不重复追加；服务重读后投影一致。
- 头条失败不改变百家成功回执；重试保留上次错误并新增尝试。
- 已成功任务无重试，未知提交只能核验。
- 切换导航与重启后任务仍可投影；旧记录可读且不伪造新字段。
- 生产确认仍只到确认单，没有新增只排队不执行的任务。
- 定向测试与共同交付门通过。

---

## 5. I1 · 分阶段接线与集成门

**执行窗口：Cursor 1。前置：T1、T2、T3、T4 全部回报完成；其他窗口暂停改代码。**

### 文件所有权

Cursor 1 本阶段可以修改共享壳、`browser.ts`、`preload.ts` 和各任务新增服务之间的接线。业务逻辑问题退回原窗口修复，不在集成时顺手重写。

### 串行接线顺序

1. **先接 T1**：注册首页与数据页，接真实本地 ViewModel，运行 R2 门禁并提交，再接下一段。
2. **再接 T2**：注册发稿与账号页，接草稿、图片、预检和账号服务，运行 R3 门禁并提交。
3. **再接 T4**：注册发布记录与任务抽屉，接旧台账和事件投影，运行 R4 门禁并提交。
4. **最后接 T3**：注册评论页，接评论读取与回复填框，运行评论门禁，作为 **R6a 评论布局**单独提交；此时不宣称 R6 全部完成。
5. 每次只接当前阶段的 IPC 与共享壳改动，发送者校验继续使用 `senderIsStudio`，不暴露通用 `executeJavaScript`。
6. 测试夹具不得进入生产加载路径；契约偏差必须修正类型或服务，不得通过放宽 `envId`、省略错误或假空数据消错。
7. 清理临时「尚未接入」状态；没有能力的平台明确 `unsupported`，不留无功能按钮。

### 每阶段接线门禁

- 当前阶段涉及的页面与按钮在真实 Sparo 开发窗口全部点通，控制台无报错。
- 当前阶段运行定向测试、`npm run typecheck`、`npm run test`，全部通过后立即提交，再进入下一阶段。
- 提交前核对 `git status` 与 `git diff --cached`，共享接线归入当前阶段，不把后续阶段的业务文件混入。
- 后续阶段尚未接线的文件可以保持未提交，但不得被当前生产入口引用；最终 T6 再在干净工作树做完整回归。

### I1 总验收

- 五个一级页面在真实 Sparo 开发窗口全部点通，环境切换后草稿、数据、评论、任务和账号一致。
- 首页与六块数据视图完整；发稿到确认单；评论真实填框不发送；任务中心只读旧台账与测试投影。
- R4 仍没有真实生产执行，确认单不产生假队列。
- 1440 / 1280 / 1024 / 800、200% 缩放、键盘 Tab、长文本与各异步状态通过。
- 集成窗口实际点击所有新增按钮，不把这一工作转交给用户。

只有 I1 通过后才允许开始 T5。

---

## 6. T5 · 真实发布接入、防重与安全续跑

**执行窗口：仅 Cursor 1。前置：I1。其他窗口全部停止修改。**

### 文件所有权

- 共享壳与 `api.ts` 中确认、任务相关部分
- `src/main/browser.ts`
- `src/main/preload.ts`
- `src/main/studio-tasks.ts`
- `src/main/studio-store.ts`（仅不可变快照所需）
- `strategies/skills/social-media-publish/scripts/ledger.mjs`
- `strategies/skills/social-media-publish/scripts/publish.mjs`
- `strategies/skills/social-media-publish/scripts/engine.mjs`
- `strategies/skills/social-media-publish/scripts/batch_publish.mjs`
- 对应 `tests/studio-*.test.ts` 与发布测试

如确实不需要改某个现有脚本，不为「统一」而改；八步与适配器不重写。

### 改动

1. 同一阶段接入确认幂等、不可变快照、生产任务创建与八步执行，不能先交付只入队不执行的版本。
2. 预检绑定 `precheckId + draftRevision + snapshotHash + 所选平台 + envId`；任一变化都使旧预检失效。
3. 确认时将快照写入 `%APPDATA%\sparo-store\publish-snapshots\<runId>.json`，之后不可修改；执行按 `runId + snapshotHash` 读取。
4. 主进程按 `confirmationId` 幂等；双击、重复 IPC、刷新后重放同一确认只返回同一个 `runId`。
5. 再次发布生成新 `runId` 与新平台任务；单平台续跑沿用 `jobId`、新增 `attemptId`。
6. 调用 `publishOrSchedule` 前持久化 `submitState=submitting / attemptId / envId / snapshotHash`。
7. 提交中或提交后崩溃，重启一律为「结果待核验」；只执行 verify / 列表回读，不自动重发。
8. 续跑前核对标题与 `snapshotHash`，只允许现有引擎支持的 `--from` 断点。
9. 保持逐平台 review、串行 commit、同平台多篇串行、`perDay` 与 `minGapMinutes`；工作台不得绕过。
10. 后台执行不抢焦点；需要人确认或处理验证码时才切到对应 `envId` 平台页。
11. 所有发布事件只能经 `ledger.mjs` 写入；UI 状态来自真实事件，不用前端定时器假推进。

### 自动化验收

- 双击确认、重复 IPC、刷新后重发同一 `confirmationId` 只生成一个批次和一组平台任务。
- 修改稿件、平台选择或环境后，旧预检不能确认；执行内容与确认快照一致。
- 分别在提交前、提交中、提交后模拟崩溃：提交前按允许断点恢复，其余两种只能先核验。
- `envId / runId / jobId / attemptId / snapshotHash` 贯穿八步、核验与台账；缺环境即停止。
- 单平台失败独立续跑，已成功平台不重复执行；结果未知不产生重复发布。
- 唯一写者、事件去重、串行 commit、日限额、最小间隔均有测试或底账证据。
- 现有离线 `--plan`、`--from setCover` 与相关发布自测继续通过。
- `npm run typecheck`、`npm run test` 全绿。

### 真机验收

- 开发形态先核验头条、百家；未通过的平台标「未开放」，不能伪装可发。
- 非默认 `envId` 实测一个平台，标签、八步、回执、台账都属于该环境。
- 真实文章只由人确认发布；Cursor 不擅自向平台发文。
- 安装包真实发布留到 T6 统一执行并保存回执。

---

## 7. T6 · 恢复、视觉清理与安装包收尾

**执行窗口：仅 Cursor 1。前置：T5 自动化与开发形态验收通过。**

### 改动

1. 合并检查 T3 评论布局与全部页面，清理旧样式、旧导航、调试输出和无功能按钮。
2. 完成草稿恢复、保存失败提示、加载 / 空 / 真实 0 / 缺失 / 错误五类状态。
3. 检查所有浮层、抽屉、页签、表格与平台卡的焦点、返回路径和小窗布局。
4. 重新构建安装包，确认包含 `out/renderer/studio.html`。
5. 按 `docs/QA-GOLDEN-SCENARIOS.md` 运行受影响场景；安装包至少复测 G1、G2、G3。

### 最终验收

- 五个一级页面与发布记录二级视图在安装形态实际点通，控制台无报错。
- 四档宽度、200% 缩放、键盘操作、长标题、长评论、长错误说明通过。
- 环境切换不串草稿、账号、数据、评论、任务或回执。
- 头条、百家真实发布各一次并保存回执；单平台续跑有底账证据。
- 大鱼、搜狐未完成同等真实验收前，不宣称四平台全部可用。
- 评论只显示探针已通平台；同一时间只操作一个平台；填框读回后切平台页，由人发送。
- 回复频率与下一次 GET 判定不变；工作台没有发送或「我已发送」。
- 数据缺失不变 0，评论填框不变已回复，未知任务不变成功或失败。
- 安装包复测 G1、G2、G3，以及新建稿、预检、真实发布、续跑、数据刷新、评论填框。
- `npm run typecheck`、`npm run test` 最后再次全绿。

---

## 8. 集成窗口提交与回报顺序

共用工作区时按下面顺序执行，避免多个窗口互相把文件带入 commit：

```text
1. T0 完成 → Cursor 1 只暂存 T0 文件 → R1 commit
2. T1–T4 并行回报 → 全部停手 → Cursor 1 开始分阶段接线
3. 接 T1 → 门禁与真实点击通过 → R2 commit
4. 接 T2 → 门禁与真实点击通过 → R3 commit
5. 接 T4 → 门禁与真实点击通过 → R4 commit
6. 接 T3 → 评论门禁与真实填框通过 → R6a 评论布局 commit
7. T5 完成 → 只暂存真实发布相关文件 → R5 commit
8. T6 完成 → 只暂存恢复与收尾文件 → R6b 安装包收尾 commit
```

- T3 固定归 R6a，T6 固定归 R6b；两段合起来才构成 R6，不把评论布局误记为真实发布能力。
- 每次 `git status` 与 `git diff --cached` 核对文件清单，不使用 `git add .`。
- 不提交用户已有的无关工作区改动，不改写旧 commit，不推远程。

---

## 9. 每个 Cursor 窗口的回报模板

```text
任务：T__
状态：完成 / 阻塞

改动文件：
- ...

完成行为：
- ...

自测：
- 定向测试：命令 + 结果
- npm run typecheck：结果
- npm run test：结果

真实页面点击（T1–T4 在此处写「待 I1」，不得伪造已点通）：
- 页面 / 按钮 / 实际结果 / 控制台情况

环境验证：
- 使用的 envId：
- 是否验证非默认环境：
- 缺 envId 时的行为：

未做与边界：
- ...

需要 Cursor 1 接线：
- 共享文件 + 具体方法 + 原因

风险或冲突：
- ...
```

T1–T4 的「代码完成」必须有组件、服务与定向测试证据，真实页面点击统一记为「待 I1」；整个任务的最终「完成」仍必须有 Cursor 1 的真实页面点击证据。只有类型检查或单元测试通过，不算最终页面验收完成。

---

## 10. 最终完成定义

只有以下条件全部满足，才向用户报告本轮完成：

- R1–R5、R6a、R6b 各有独立、可核对的提交和验收证据；R6a 与 R6b 合并构成完整 R6。
- 五个页面视觉统一、简洁美观，四档宽度与键盘操作通过。
- 一篇稿多批次、平台任务独立、历史不覆盖，防重与崩溃恢复有证据。
- 头条、百家真实发布与续跑有回执；其他平台按真实验收状态表述。
- 数据六块完整，缺失不写 0；评论只填框，人工发送，下一次 GET 判定。
- 所有执行与数据路径环境一致，没有默认环境兜底串号。
- 安装包与受影响黄金场景通过，控制台无报错。
- 无新依赖、无远程 UI、无 token 落盘、无自动发送、无假任务、无未登记的新提前结束判断。
