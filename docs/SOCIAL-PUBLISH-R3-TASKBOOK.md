# SOCIAL-PUBLISH R3 任务书 —— 修「后台标签渲染」前提

> 交付对象：同一开发窗口
> 工作目录：`C:\Users\60914\.trae-cn\skills\social-media-publish\`
> 前置：R2 已完成并通过 9 项，本任务只处理未通过的 3 项

---

## 0. 一句话结论

R2 改的 7 条 P0 大部分是对的。剩下没过的 3 项（定时 2 项、头条广告 1 项）**不是选择器问题，是渲染前提问题**：

> 发布用的标签在后台，`window.innerHeight === 0`。所有「在视口内 / 可点击 / 坐标」的判断从根上失效。

先修这个前提，再谈控件。

---

## 1. R2 验收结果（真机实测，2026-11-10）

### 1.1 通过（9 项）

| # | 项目 | 实测 |
|---|---|---|
| 1 | `--self-check` | `SELF_CHECK_OK` |
| 2 | 百家号 probe | `lexical:true` `ueditor:true` |
| 3 | 头条 probe | 标题/正文/配图/封面/广告入口全 `true` |
| 4 | 两进程并发探测 | 两个标签 id 不同，均成功 |
| 5 | 百家号标题 | 31 字含标点英文，全文回读相等 |
| 9 | 百家号 AI 声明 | `aiChecked: false` |
| 11 | 打开编辑器 | 15 秒内完成 |
| 12 | `--from setCover` | 只跑 setCover，标题未重写 |
| 13 | 台账 | 落盘正确，`from` 字段正确 |

### 1.2 未通过（3 项）

| # | 项目 | 实测结果 |
|---|---|---|
| 6 | 头条定时 | 失败：`BUTTON_OFFSCREEN` |
| 7 | 百家号定时 | 失败：按钮 `y=-49.7`，弹层 `widgets=0` |
| 10 | 头条广告回读 | 未完成回读 |

第 8 条（提交后查列表）依赖 6/7，本轮未测。暂不单独记为失败。

---

## 2. 实测证据（本轮新测，直接采信）

### 2.1 两个平台的编辑标签都是 `innerHeight = 0`

```
百家号编辑页   innerHeight: 0
头条编辑页     innerHeight: 0
```

这不是页面 bug，是后台标签不参与布局。后果：

- `getBoundingClientRect()` 全部基于 0 高度视口
- `scrollIntoView()` 不产生任何位移
- 「`r.y >= 0 && r.bottom <= innerHeight`」判断 100% 为假
- 依赖布局的组件（弹层、虚拟列表）拿不到可用几何

### 2.2 百家号定时按钮的定位链

```
button「定时发布」        y=-49.7  h=35.6
└ .FeEditorApp-...-operatorWrapper   position:fixed  top:-64px  height:64
  └ .editor-component-operator      overflow-y:hidden
    └ .op-list
      └ .op-list-left
```

- 按钮在 `position:fixed; top:-64px` 的容器里，**天然在视口上方**
- 向上找不到任何 `overflow-y:auto|scroll` 的可滚动祖先（`scrollChain: []`）
- 所以 `scrollIntoView` 无效不是实现问题，是结构决定的

### 2.3 百家号定时弹层：DOM 点击唤不起

在后台标签上完整派发：

```
pointerdown → mousedown → pointerup → mouseup → click()
```

结果：

```
widgets: 0        （.cheetah-picker / .cheetah-select / .byte-picker 全部为 0）
dialogs: []       （没有任何可见弹层）
```

结论：cheetah 组件依赖真实渲染与 rAF，后台标签下事件被吞。

### 2.4 头条广告是 radio，不是 checkbox

```
input.type = "radio"
「投放广告赚收益」 value=3
「不投放广告」     value=2
```

实测：点击可把 `checked` 从 `false` 变 `true`（**能选中**）。
但 radio 点第二次仍然是 `true`，**不能通过再点一次取消**。

这条直接影响现有代码：

```js
// 现有逻辑假设「再点一次 = 取消」，对 radio 不成立
if (first && firstInput && firstInput.checked) first.click();
```

---

## 3. P0 —— 必须修

### P0-A 发布前临时激活目标标签，结束后恢复

这是解开 6/7/10 的唯一前提。

**做法**：

1. 进入发布前，记录当前活动标签：`list_tabs` 返回的 `data.activeId`
   - 服务端**已经返回** `activeId`（`src/main/browser.ts` `listTabs()`）
   - `scripts/sparo.mjs` 的 `tabs()` 目前把它丢了，只 `return parsed.data.tabs`，需要一并返回 `activeId`
2. 调 `switch_tab` 把目标编辑标签设为活动
   - 只切标签，不 `window.focus()`、不 `restore()`、不闪任务栏
3. 轮询 `innerHeight > 0`，上限 5 秒；失败则 `RENDER_NOT_READY` 并恢复原标签
4. 执行全部发布步骤
5. 无论成功失败，`finally` 里切回原活动标签
   - 原标签已关闭则跳过，不报错

**验收**：发布全程用户当前标签不变（结束后 activeId 与开始时相同），且 `innerHeight > 0`。

---

### P0-B 头条广告按 radio 语义处理

**位置**：`scripts/adapters/toutiao.mjs` `setOptions()`

**现状问题**：
- 把广告收益当 checkbox，用「点一下切换」的思路
- 「头条首发」那段用 `if (checked) click()` 想取消，对 radio 无效，反而会选中

**改法**：

1. 广告收益：只做「确保选中」，不做取消
   - 已选中 → 不动
   - 未选中 → 点同组选项，然后回读 `checked === true`
2. 「头条首发」：不允许点它来取消
   - 若已选中，**不要点**，只在结果里标记 `firstLaunch: true` 并记录，交人工判断
   - 因为 radio 点了只会选上，会违反「首发必须是未勾选态」
3. 回读必须是 radio 组状态，不是单个元素状态

**验收**：
- 广告收益回读 `checked === true`
- 首发回读如果是 `true`，流程不点它，并在结果里明确标出
- 不允许出现「点了一下以为取消、实际选中」的情况

---

### P0-C 弹层与下拉必须轮询等待

**位置**：`scripts/page.mjs` `buildScheduleScript()`、`clickRevealed()`

**现状问题**：
- 点开下拉后**同步**查询，弹层还没渲染就返回空
- `clickRevealed` 一次性判断 `inView`，不满足就停，不重试

**改法**：

1. `buildScheduleScript` 拆成「点击 → 等待 → 再操作」三段，每段之间轮询目标条件（默认 300ms × 20 次）
2. 等待条件不用固定 `sleep`，用「节点出现 + 尺寸 > 0」判定
3. `clickRevealed` 在 `innerHeight > 0` 前提下才做视口判断；`innerHeight === 0` 直接返回 `RENDER_NOT_READY`，交 P0-A 处理，不要报 `BUTTON_OFFSCREEN` 误导排查
4. 分钟下拉是虚拟列表，滚动后要重新查询可见项，不能复用滚动前的节点

**验收**：激活标签后，百家号定时弹层能读到 3 个控件，且依次选出 `2026-11-11 / 19 / 30` 并三项回读相等。

---

### P0-D `tabs()` 保留 `activeId`

**位置**：`scripts/sparo.mjs`

```js
// 现在
return parsed?.data?.tabs || [];
```

**改法**：返回 `{ tabs, activeId }`，并同步修改所有调用点（`openWriteTab`、`probe`、`publish` 里取 tabs 的地方）。

这是 P0-A 的前置，不改就拿不到「原活动标签」。

---

## 4. 不允许做的事

1. **不许用 `window.focus()` / `restore()` / 闪任务栏** 来让 `innerHeight` 变正常。只允许 `switch_tab`。
2. **不许为了发出去而勾 AI 声明**。R2 已经验证 `aiChecked: false`，这条要保持。
3. **不许把「首发」点一下当取消**。
4. 不许改 `adapters/dayu.mjs`、`adapters/sohu.mjs`。
5. 不许在技能目录里留一次性探测脚本（本轮验收已清理干净）。

---

## 5. 验收清单（DoD）

| # | 动作 | 通过标准 |
|---|---|---|
| 1 | `--self-check` | `SELF_CHECK_OK` |
| 2 | 记录开始前 activeId，跑完百家号定时 | 结束后 activeId 与开始时相同 |
| 3 | 发布过程中读 `innerHeight` | > 0 |
| 4 | 百家号 `--schedule "2026-11-11 19:30"` | 回读 `2026-11-11` / `19` / `30` 三项相等 |
| 5 | 头条 `--schedule "2026-11-11 19:30"` | 同上 |
| 6 | 头条广告收益 | 回读 `checked === true` |
| 7 | 头条首发若为选中态 | 流程未点击它，结果里明确标 `firstLaunch: true` |
| 8 | 百家号 AI 声明 | 回读 `aiChecked: false` |
| 9 | 强制 `innerHeight === 0` 场景 | 返回 `RENDER_NOT_READY`，不是 `BUTTON_OFFSCREEN` |
| 10 | 用户当前标签 | 全程未被切走（可用另一个窗口观察） |

1-9 全过才交付。第 10 条由验收窗口人工确认。

---

## 6. 交给验收窗口时请附

- 改动清单（文件 + 行号）
- 第 4、5 条的回读原始输出
- 一次完整 `publish.mjs` 的台账记录

真机最终提交（验收 8：提交后能否在列表搜到）由验收窗口在用户监督下执行。

---

## 附录 A：点击可达性 —— 先量事实，不预设类型

> 本节独立于前文。前四条 P0 照做，本节是防止同类问题换个形状再来一次。

### A.1 为什么不写成三种情况的分支

「点空」在表面上只有一种表现：点了，什么都没发生。

但背后的原因至少有三类，而且**会同时出现**：

| 事实 | 本次是否出现 |
|---|---|
| 视口高度为 0（后台标签未排版） | 是，两个平台 |
| 元素纵向越界（`fixed; top:-64px`） | 是，百家号定时按钮 |
| 元素横向越界（内容宽 1506 > 视口 1000） | 本次未遇，但代码未检查 |
| 无可滚动祖先 | 是 |
| 按钮存在但被遮挡 | 未验证 |

如果写成：

```js
if (innerHeight === 0) return RENDER_NOT_READY;
else if (left > innerWidth) { scroll(); }
else ...
```

下一次遇到「视口 0 + 纵向越界 + 无可滚容器」的组合就会漏。

**所以不要按类型分支。每次都量，量完再决定，失败再量。**

---

### A.2 动手前先取一份几何快照

统一用同一个函数产出，任何点击动作都先调它：

```js
{
  viewport: { w, h, scrollX, scrollY, dpr },
  doc:      { scrollW, scrollH },              // 页面内容总尺寸
  target:   { left, top, right, bottom, w, h },
  inside:   { x: bool, y: bool },              // 四边是否都落在视口内
  scrollers: [                                 // 沿祖先链，全部可滚容器
    { cls, scrollW, scrollH, clientW, clientH, scrollLeft, scrollTop }
  ],
  blockers: [ { cls, left, top, w, h } ]       // 覆盖在目标中心点上的可见元素
}
```

`blockers` 用 `document.elementFromPoint` 取，能发现「事件被透明遮罩吃掉」这类问题。

**不要**只返回一个 `inView: boolean`。那会把「为什么不在」这个最关键的信息丢掉。

---

### A.3 分层尝试：按代价从小到大，每步重新量

不预设哪一种一定奏效，顺序试，任何一步成功就停：

1. 已在视口内 → 直接点
2. 有可滚祖先 → 滚到居中 → **重新量** → 再判
3. 文档本身可横/纵滚（`doc.scrollW > viewport.w`）→ 滚文档 → **重新量**
4. 视口为 0 → 停止自动尝试，升级给上层（P0-A 的排版处理）
5. 上一步有结果就结束，全试完仍不行 → 交诊断

关键：**每次滚动后必须重新取坐标**。滚动前的坐标在滚动后必然失效，这是最容易写错的地方。

---

### A.4 失败时返回诊断，不返回单一结论

```js
{
  ok: false,
  code: "UNREACHABLE",
  geometry: { ...最后一次的量测... },
  tried: ["inline", "scroll-ancestor", "scroll-doc"],
  diagnosis: "视口高度 0，标签未排版",
  next: ["request-layout", "manual"]
}
```

`diagnosis` 用人话写清「量到了什么」，而不是只给 `BUTTON_OFFSCREEN`。

`next` 给上层可选项，由调用方决定走哪条，不在这一层替它拍板。

---

### A.5 这条诊断要能被 Agent 读懂

脚本不是只给人看日志的。执行中的 Agent 也要能读到并据此改策略。

所以 `diagnosis` 必须包含四个要素：

- 目标是谁（文本 / 选择器）
- 量到多少（视口尺寸、元素四边）
- 试过什么（`tried`）
- 还剩什么可能（`next`）

缺其中任何一条，Agent 就只能重试，不能换路。

---

### A.6 按钮身份：精确匹配，不碰邻居

同一屏上常有几个语义相近、后果完全不同的按钮：

- 百家号：`发布` / `定时发布` / `保存草稿`
- 头条：`发布` / `预览并发布`
- 店小秘：`保存` / `保存并认领`

规则：

1. 文字去掉空白后**全等**匹配，不做包含匹配
2. 能用类名或按钮身份限定的，一并限定
3. 命中多个时**停手**，不猜，把候选项列出来
4. 危险邻居（认领、删除、立即发布）显式写进「不点名单」

---

### A.7 成功判定：只看回读，不看提示

线上页面普遍存在三种假成功：

- 弹了成功提示，实际没提交
- 没弹提示，实际提交了
- 页面文字长度不变

所以每个写操作的收尾都是回读：

| 动作 | 回读什么 |
|---|---|
| 填标题 | 全文字符串相等，不比前缀 |
| 设定时 | 日期 / 时 / 分三项分别相等 |
| 设封面 | 封面节点数量 > 0 |
| 提交 | `reload` 后到列表页搜标题，能搜到才算成功 |

**不 reload 的回读不算回读。**

---

### A.8 验收

| # | 构造的状态 | 通过标准 |
|---|---|---|
| A1 | 视口 0（后台标签） | 返回 `RENDER_NOT_READY`，`diagnosis` 写明视口高度为 0 |
| A2 | 元素纵向越界，有可滚祖先 | 滚动后重量成功，`tried` 含 `scroll-ancestor` |
| A3 | 元素横向越界，文档可横滚 | `scrollLeft` 生效，点击命中 |
| A4 | 目标被透明遮罩覆盖 | `blockers` 非空，不盲点 |
| A5 | 命中多个同名按钮 | 停手，列出候选，不猜 |
| A6 | 任一上述情况 | **不允许返回 `ok: true` 但实际没点中** |

A6 是底线。点没点中，只能由回读证明。

---

## 附录 B：`NO_TAB` —— 编辑页明明开着，脚本却说没有

> 背景：R3 实现后真机仍报 `NO_TAB`，页面落到内容列表。已实测定位，两个独立原因叠加。

### B.1 实测事实

**事实一：每次新进程，clientId 都变。**

```
第一次进程  stamp = agent:44b283
第二次进程  stamp = agent:927982
第三次进程  owner = agent:3de545
```

来源在 `scripts/sparo.mjs`：

```js
const clientName = "social-media-publish#" + process.pid;
```

服务端 `src/main/mcp-server.ts:903`：

```ts
const clientId = headerClient || (rpcMethod === "initialize" ? issueClientId() : "");
```

脚本只有在 **clientId 已存在时** 才带 `x-sparo-client` 头。首次 `initialize` 必然不带 → 服务端发一个新 id。

结果：上一个进程开的编辑页，下一个进程永远认不出来。

**事实二：`navigate` 遇到同 URL 标签会复用，不新建。**

同一进程内连续两次 `navigate` 同一个 URL：

```
BEFORE: 6 个标签
第一次 navigate 后: 7 个（新建 a3ad05da）
第二次 navigate 后: 7 个（没有新建）
```

而 `openWriteTab` 的新建分支靠这个认领：

```js
const before = new Set(...);
await call("navigate", { url: ctx.writeUrl });
// 只认 !before.has(tab.id) 的标签
```

navigate 一复用，就没有新 id。循环 15 秒，`created` 始终为空 → `NO_TAB`。

两个原因叠在一起，正好构成这个现象：
1. 之前的进程留下一个编辑页标签
2. 本进程认不出 owner
3. 走新建分支，navigate 复用了那个旧标签
4. 没有新 id → 15 秒后 `NO_TAB`

### B.2 P0-E 固定 clientId

```js
const clientId = process.env.SPARO_CLIENT || "social-media-publish";
```

- 首次 `initialize` 就带 `x-sparo-client` 头
- 服务端 `headerClient` 优先，直接采用，不再发新 id
- 跨进程稳定，编辑页标签可以正常复用

**并发约定**：默认值不带后缀，同一技能的所有进程共用一个身份。媒体发布约定「一窗口一任务」，够用。

如果以后要两个窗口同时发，再各自设 `SPARO_CLIENT=social-media-publish:A` / `:B`。默认值不要自动加随机后缀，否则又回到今天这个问题。

### B.3 P0-F `openWriteTab` 不以「新 id」为唯一判据

navigate 前后各取一次 tabs 快照，按顺序判断：

1. 出现新标签，且 URL 含 `writeMark` → 用它
2. 没有新标签，但有标签的 URL 变成了 `writeMark`，且 owner 是自己 → 用它
3. 没有新标签，但当前活动标签的 URL 变成了 `writeMark`，且 owner 是自己 → 用它
4. 三条都不满足 → 返回 `NO_EDITOR_TAB`，附完整 tabs 快照、`tried`、以及实际落到的 URL

**`NO_EDITOR_TAB` 必须带上实际落点。** 「页面落到了内容列表」这个信息要让调用方看见，不能只报一个 `NO_TAB`。

### B.4 绝对不能做的事

**不许为了找到标签，去接管 owner 不是自己的标签。**

之前两个窗口同时发文，编辑器和草稿互相覆盖，根因就是抢同一个后台。owner 对不上就是别人的，宁可报错，不要接管。

### B.5 验收

| # | 动作 | 通过标准 |
|---|---|---|
| B1 | 进程 A 打开百家号编辑页，退出 | 标签存在，owner 为 `agent:social-media-publish` |
| B2 | 新起进程 B，跑同一平台 | 能复用 A 留下的编辑页，不报 `NO_TAB` |
| B3 | navigate 遇到同 URL 复用 | `openWriteTab` 仍能拿到该标签 |
| B4 | 页面上只有别的 owner 的编辑页 | 报 `NO_EDITOR_TAB`，**不接管** |
| B5 | 三次独立进程连跑 | 三次拿到的 owner 完全一致 |

B5 是判定根因是否真修掉的关键。owner 还在变，说明 `SPARO_CLIENT` 没生效。

---

## 附录 C：`RENDER_NOT_READY` 的第三种成因 —— 窗口整体最小化

> 背景：P0-A 落地后真机验收，`activateEditor` 仍返回 `RENDER_NOT_READY`。实测定位，这次是环境成因，不是脚本缺陷。

### C.1 实测事实

验收时对全部标签逐一读 `innerHeight` / `visibilityState`：

```
ea76b1bc（用户当前活动标签）  ih=0 iw=0 vs=hidden
32679284（用户，店小秘）      ih=0 iw=0 vs=hidden
4f7c1083（用户，店小秘）      ih=0 iw=0 vs=hidden
d14f0325（本技能编辑页）      ih=0 iw=0 vs=hidden
```

**连用户正在看的活动标签都是 0×0。** 这只有一种解释：Sparo 主窗口此时处于最小化状态，整个窗口不参与排版。

`activateEditor` 里 `switch_tab` 已生效（activeId 确实变了），但窗口最小化时切换活动标签不触发排版，5 秒内 `innerHeight` 一直是 0 → 按 R3 口径正确返回 `RENDER_NOT_READY`。

### C.2 与另两种成因的区别

| 成因 | 范围 | switch_tab 有没有用 |
|---|---|---|
| 后台标签未排版 | 只有非活动标签是 0 | 有用，切过去就排版 |
| 标签被 discarded | 单标签 | 有用，切换会唤醒 |
| **窗口整体最小化** | **全部标签都是 0，含活动标签** | **没用** |

检测口径：目标标签是 0 不说明问题；**活动标签也是 0** 才说明窗口最小化。`activateEditor` 失败时应回读 `list_tabs` + 活动标签的 `innerHeight`，区分这两种情况，错误码分开：

- 目标 0、活动标签正常 → `RENDER_NOT_READY`（原有）
- 目标 0、活动标签也是 0 → `WINDOW_MINIMIZED`（新增），diagnosis 写明「窗口最小化，全部标签未排版」

### C.3 修法

项目已有先例：主进程 `browser.ts` 的后台渲染通道（`restore()` + `showInactive()`，不夺焦、不弹窗，任务结束归还窗口状态）。

**首选**：MCP 增加一个 `ensure_render` 工具，语义 =「带 clientId 申请后台渲染：若窗口最小化则 restore+showInactive，并 switch_tab 到指定标签；返回是否成功」。工具实现走现有后台渲染通道，不新增焦点行为。技能侧 `activateEditor` 改为：

1. `switch_tab` → 量到 innerHeight > 0 → 完成（窗口正常时不变）
2. 仍 0 → 调 `ensure_render` → 再量，> 0 则完成
3. 仍 0 → 返回 `WINDOW_MINIMIZED`，`next: ["ensure-render", "manual"]`

**次选**（MCP 暂不加工具）：技能检测到活动标签也是 0 时直接返回 `WINDOW_MINIMIZED`，由上层提示用户把窗口还原一次再跑。可以上线，但每次窗口最小化都会卡住，不推荐当长期方案。

### C.4 约束

- `ensure_render` **不许**调 `win.focus()`、`win.show()`，只许 `showInactive()` 级别的恢复渲染
- 任务结束必须归还：用户窗口原来是最小化的，跑完还要回到最小化
- 用户手动把窗口拉回前台时，不得强压回最小化（沿用 T82 之前 `releaseBackgroundRender` 的既有校验）
- 申请与归还要按 clientId 计数，多个任务并发时最后一个结束才归还

### C.5 验收

| # | 环境 | 动作 | 通过标准 |
|---|---|---|---|
| C1 | 窗口正常 | 跑发布到定时步 | 不触发 `ensure_render`，行为与现状一致 |
| C2 | 窗口最小化 | 跑发布到定时步 | `ensure_render` 生效，定时三项回读通过 |
| C3 | 窗口最小化 | 任务结束 | 窗口回到最小化，活动标签恢复 |
| C4 | 任务跑一半用户拉回前台 | 任务结束 | 不强压回最小化 |
| C5 | 窗口最小化 | 定时步 | 错误码是 `WINDOW_MINIMIZED` 而不是 `RENDER_NOT_READY`（当 ensure_render 未实现时） |

定时三项回读与头条广告回读两项真机验收，**在本节落地后重跑**。
