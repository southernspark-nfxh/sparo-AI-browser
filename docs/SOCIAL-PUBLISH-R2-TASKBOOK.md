# SOCIAL-PUBLISH R2 任务书 —— 修发布脚本（头条 + 百家号）

> 交付对象：1 个开发窗口（Cursor 或等价）
> 工作目录：`C:\Users\<用户名>\.trae-cn\skills\social-media-publish\`
> 提交要求：一个改动一个 commit，不碰 `D:\download\sparo上架应用商店版\src\`

---

## 0. 一句话

发布引擎已经存在，也确实被跑过。但两次真实执行都在前几步就挂了，随后降级成一次性脚本手工救火，导致 20～40 分钟只发出两篇。

这轮只修**头条**和**百家号**两个适配器，以及它们共用的 `page.mjs`。大鱼、搜狐不动。

---

## 1. 事实基线（不要重复调研，直接采信）

### 1.1 引擎文件清单

```
scripts/publish.mjs              统一入口（CLI 参数、--dry-run / --probe / --self-check）
scripts/engine.mjs               步骤序列：openBlank → fillTitle → fillBody → insertImages
                                           → setCover → setOptions → publishOrSchedule → verify
scripts/page.mjs                 共用页面动作：waitEditor / openWriteTab / uploadPicked / guard
scripts/sparo.mjs                MCP 客户端，7 个动作工具全带 tabId
scripts/adapters/toutiao.mjs     头条
scripts/adapters/baijiahao.mjs   百家号
scripts/adapters/dayu.mjs        大鱼（本轮不动）
scripts/adapters/sohu.mjs        搜狐（本轮不动）
scripts/ledger.mjs               台账（jsonl）
scripts/article.mjs              文章目录读取：title.txt + body.md + cover.jpg + images/
ledger/2026-11.jsonl             执行台账，真实现状见下
```

### 1.2 台账里的两次真实失败

`ledger/2026-11.jsonl` 最后两条：

```json
{"at":"2026-11-10T08:54:55.800Z","platform":"toutiao","step":"publishOrSchedule",
 "reason":"MISMATCH","hint":"MISMATCH:","time":"2026-11-10 19:00","images":0}

{"at":"2026-11-10T09:02:26.941Z","platform":"baijiahao","step":"openBlank",
 "reason":"EDITOR_NOT_READY","hint":"空白编辑器没有出现","time":"2026-11-10 19:30","images":0}
```

结论：引擎不是没跑，是**跑了就挂**。修完这两条路径，才算修到点上。

### 1.3 上一轮流传的说法，有一处是错的

有窗口声称「台账目录是空的，所以引擎根本没被用」。这与 1.2 矛盾，不要采信。
真实情况是：跑了 → 挂在前两步 → 人工降级。请按「适配层是坏的」去修，不要按「没人用」去重造。

---

## 2. 硬约束（违反即打回）

1. **不许写死 token**。token 只从 `%APPDATA%\sparo-store\mcp-auth.json` 或环境变量 `SPARO_TOKEN` 读。
2. **不许调用 `switch_tab`**。所有页面动作必须带 `tabId`。
3. **不许抢前台**。不 `bringToFront`、不 `focus()`、不把窗口拉到前面。
4. **不许为了跑通放宽平台规则**：
   - 百家号：「采用 AI 生成内容」**必须保持未勾选**，且要回读证明。
   - 头条：「投放广告赚收益」**必须勾上**并回读；「头条首发」不允许是勾选态。
   - 搜狐：找不到定时入口要停手，不许改点「立即发布」。
   - 大鱼：封面前正文必须有 3 张不同的图。
5. **失败必须早退**，写台账，返回明确 `code`。不许静默重试、不许假装成功。
6. **不许改 `D:\download\sparo上架应用商店版\src\`**，这轮只改技能目录。

---

## 3. P0 —— 必须修（不修则同问题必复发）

### P0-1 并发串稿：`openWriteTab` 不校验标签归属

**位置**：`scripts/page.mjs` `openWriteTab()`（约 L148-L174）

```js
const mine = list.filter((tab) => String(tab.url || "").includes(ctx.host));
const ready = mine.find((tab) => String(tab.url || "").includes(ctx.writeMark));
const picked = ready || mine[0];          // ← 同域名第一个，不看 owner
```

**现象**：两个 agent 同时发稿，互相抓对方标签。表现为：编辑器被清空、标题被改回上一篇、新开标签自动带出别人的残留草稿。

**证据**：`list_tabs` 返回里标签带 `owner` 字段（实际观察到 `social-media-publish` / `trae-wy2` 两个 owner 同时对同一个百家号后台操作）。

**修法**：
- `list_tabs` 结果里按 `owner` 过滤，只认本会话 owner 的标签。
- owner 缺失或为空时，不复用该标签，改为新开。
- 复用前必须回读 `location.href` 确认仍在编辑页且未被别人占用。
- 拿不到 owner 字段时，退化为「本进程新建的标签优先，其余不复用」。

**验收**：两个进程同时各跑一次 `--probe`，日志里两者 `tabId` 必须不同。

---

### P0-2 百家号标题写入方式错误

**位置**：`scripts/adapters/baijiahao.mjs` `fillTitle()`（L33-L48）

```js
editor.innerHTML = '';                                    // 直接清 DOM，Lexical 内部状态会回滚
document.execCommand('insertText', false, ctx.title);      // 后台标签页里不生效
const value = ...value.includes(ctx.title.slice(0, 12));    // 只比前 12 个字
```

**现象**：标题写入后回读为空或旧值；偶尔写进去又被 Lexical 回滚。

**修法**：
- 走 Lexical 官方入口清空：`ed.__lexicalEditor.update((root) => root.clear())`，不用 `innerHTML=''`。
- 写入用 CDP `Input.insertText`（或页面内等价手段），不用 `execCommand`。
- 回读必须**全文相等**，不允许只比前 12 字。

**验收**：标题含标点、超长（>30 字）、含英文时，回读 `value === ctx.title` 全等。

---

### P0-3 定时控件选择器是硬错（两个平台都中）

**位置**：
- `scripts/adapters/baijiahao.mjs` `fillClock()`（L257-L279）
- `scripts/adapters/toutiao.mjs` `schedule()`（L257-L272）

两处都用：

```js
document.querySelector('input[type="date"]')
document.querySelector('input[type="time"]')
```

**现象**：两个平台的定时都是组件库下拉（百家号 cheetah 下拉，头条 byte-design picker），页面上根本没有原生 `input[type=date]` / `input[type=time]`。这段必然返回 `SCHEDULE_CONTROLS_MISSING`。

这是**结构性错误，不是时序问题**，加等待也不会好。

**修法**：
- 改成点击式：点日期输入 → 弹层里选日 → 点小时下拉 → 选小时 → 点分钟下拉 → 选分钟。
- 全套动作必须放在**同一个 `execute` 调用内**完成（跨调用弹层会关）。
- 选完必须回读三个值（年-月-日 / 时 / 分）并断言等于目标。
- 分钟下拉是虚拟列表，只渲染约 10 项，需要滚动；且页面上有多个同结构下拉，必须限定在**当前可见**的那个容器内查找，过滤已离场的旧节点。

**值来源**：`ctx.schedule = { date: "YYYY-MM-DD", time: "HH:mm", text }`，来自 `publish.mjs --schedule`。

**验收**：`--schedule "2026-11-11 19:30"` 跑完后，读回是 `2026-11-11` / `19` / `30` 三项分别相等，缺一项即失败。

---

### P0-4 封面「假成功」

**位置**：
- 百家号 `setCover()`（L114-L129）
- 头条 `setCover()`（L123-L175）

**现象**：
- 百家号：上传完不点中缩略图就确认，等于没选。页面提示成功，但列表里没有这篇。
- 头条：`.article-cover-add` 点出来的是「创作助手」侧边栏，不是封面上传。且元素可能在视口外，`scrollIntoView` 对内部滚动容器无效。

**修法**：
- 点入口前先 `scrollIntoView`，并用几何判断确认元素在视口内；不在则用内部容器滚动。
- 上传必须限定到正确的 file input（百家号/头条都在图片来源抽屉内，例如 `.mp-ic-img-drawer input[type=file]`），按 `accept` 含 image 过滤。
- 上传后**必须点中缩略图**再确认，然后回读封面数量 > 0。
- 回读不到封面即失败，不许把「弹窗关闭」当成成功。

**验收**：
- 百家号：提交后到内容列表能搜到该标题。
- 头条：`.article-cover img` 数量 ≥ 1。

---

### P0-5 `waitEditor` 等待太短

**位置**：`scripts/page.mjs` `waitEditor()`（L128-L142）

```js
for (let i = 0; i < 3; i++) { ... await sleep(800); }
```

总等待 2.4 秒。后台标签页渲染更慢，直接判 `EDITOR_NOT_READY`（台账第二条就是这个）。

**修法**：改为「条件成立才继续」的轮询，默认 15 秒上限、200ms 间隔，可配置。超时才失败。

**验收**：后台（未聚焦、窗口最小化）开编辑器，能稳定通过 `openBlank`。

---

### P0-6 `gate` 读到空 URL 就中止

**位置**：`scripts/sparo.mjs` `gate()`（L123-L130）

```js
if (!href || (want && !hrefMatches(href, want))) return "MISMATCH:" + href;
```

**现象**：台账第一条 `hint: "MISMATCH:"` —— 后缀是空的，说明 `get_url` 返回空串，直接中止，且没有重试。

**修法**：
- 空串重试 2～3 次（间隔 200ms），仍空才失败，且 `code` 区分 `URL_UNREAD` 与 `MISMATCH`。
- 不要用空串拼 `MISMATCH:`，错误信息要能看出是「读不到」还是「读到了但不是目标」。

**验收**：人为让 tab 短暂不可读，应重试后恢复，而不是立刻中止。

---

### P0-7 没有断点续跑，只有线性从头再来

**位置**：`scripts/publish.mjs` `parseArgs()` / `scripts/engine.mjs` `runPublish()`

**现象**：任何一步失败都要整篇重填。重填又触发草稿保存，形成「写入 → 回滚 → 再写入」循环，这是 40 分钟的主要消耗。

**修法**：
- `engine.mjs` 的 `STEPS` 数组支持从指定步骤起跑：`--from fillBody`。
- 起跑前断言当前页仍是对应平台编辑页且已有标题，否则拒绝并提示从头跑。
- 台账记录 `from`，便于复盘。

**验收**：故意让 `setCover` 失败，用 `--from setCover` 重跑，标题和正文**不被重写**（可通过正文长度/接口调用次数证明）。

---

## 4. P1 —— 本轮能做就做，做不了登记

| 编号 | 问题 | 位置 |
|---|---|---|
| P1-1 | 固定 `sleep(700/800/1200)` 代替条件等待，节点没出来就白等 | 各 adapter 全文 |
| P1-2 | 后台标签 `visibilityState=hidden` 时 rAF 冻结，依赖 rAF 的按钮回调不执行 | 全局 |
| P1-3 | 分钟下拉虚拟列表，`scrollTop` 需精确到 ~940 才见「30 分」 | 定时下拉 |
| P1-4 | 文章目录只认 `title.txt`+`body.md`，不认带 front-matter 的 `.md` | `article.mjs` |
| P1-5 | 权益勾选不全：赞赏、微头条、作品声明、打赏未封装 | 两 adapter `setOptions` |

P1-5 明确说明：本轮**不要求**补齐所有权益项，但必须在文档里写清「哪些已断言、哪些需人工补」，避免被当成已覆盖。

---

## 5. 交付物

1. 改后的 `scripts/` 文件（只动 `page.mjs`、`sparo.mjs`、`publish.mjs`、`engine.mjs`、`adapters/toutiao.mjs`、`adapters/baijiahao.mjs`）。
2. 每个改动独立 commit，message 带 `R2-P0-N` 编号。
3. 一份改动说明，写清：改了哪几处、为什么、`--self-check` 结果。
4. 不动 `adapters/dayu.mjs`、`adapters/sohu.mjs`。

---

## 6. 验收清单（DoD，逐条可执行）

| # | 验收动作 | 通过标准 |
|---|---|---|
| 1 | `node publish.mjs --self-check` | 打印 `SELF_CHECK_OK` |
| 2 | `node publish.mjs --platform baijiahao --probe` | `lexical:true` new `ueditor:true`，且 `tabId` 是本进程自己的 |
| 3 | `node publish.mjs --platform toutiao --probe` | `title/body/cover/ad` 四项全 true |
| 4 | 两进程同时 `--probe` | 两者 `tabId` 不同，互不干扰 |
| 5 | 百家号标题含标点+英文+超 30 字 | 回读全等，无截断比对 |
| 6 | `--schedule "2026-11-11 19:30"` 头条 | 读回 `2026-11-11 / 19 / 30` 三项相等 |
| 7 | `--schedule "2026-11-11 19:30"` 百家号 | 同上 |
| 8 | 百家号提交后查列表 | 能搜到该标题，状态为定时/审核中，**不是「提交成功但列表没有」** |
| 9 | 百家号 AI 声明 | 回读为未勾选；若找不到该控件则失败，不许跳过 |
| 10 | 头条广告收益 | 回读为已勾选 |
| 11 | 后台（窗口最小化）跑 `openBlank` | 15 秒内通过，不报 `EDITOR_NOT_READY` |
| 12 | 故意让 `setCover` 失败后 `--from setCover` | 标题正文未被重写 |
| 13 | 台账落盘 | 每次执行都有记录，`from` 字段正确 |

前 12 条全过才算交付。第 8 条是上一轮「假成功」的直接回归。

---

## 7. 已知但本轮不解决

- 大鱼、搜狐适配器未验证，未纳入本轮验收。
- 头条「首发」徽章的真实语义未证实，只要保证最终是未勾选态即可。
- 平台账号侧风控、登录失效不在脚本职责内，遇到应返回 `LOGIN` 并交还人工。
