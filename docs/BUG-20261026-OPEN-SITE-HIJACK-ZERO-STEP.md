# 「只是开站」正则抢答：任务零执行即关单——病因分析与修复任务书（2026-10-26）

> 承接 [BUG-20261024-WEIBO-MISSION-ROUTING.md](./archive/2026-10/BUG-20261024-WEIBO-MISSION-ROUTING.md)（路由三修复已推送）与 [BUG-20261024-COLLECT-LOOP-WHITESCREEN.md](./archive/2026-10/BUG-20261024-COLLECT-LOOP-WHITESCREEN.md)（P1/P2/P3 已修，P4 未动工）。
> 本文档锁定 2026-10-26 晚「当前打开的博主，最近三天微博复制成文档」任务暴露的**入口侧新洞**：任务 4.4 秒零执行关单。它不在前两单覆盖范围内。
> 适用范围：本目录（`d:\download\sparo上架应用商店版`）。修复独立 commit；触及脑区（执行循环入口判定）的改动不与 UI/工具层合并。

## 评审修订（2026-10-27，本节优先于下文冲突处）

已落地：`8dcee01`（结构判据）、`1bf9aa0`（「打开」紧跟助词）。单测在 `tests/site-open-job.test.ts`。`npm test` 与 `npm run typecheck` 在 `8dcee01` 时全绿；助词那笔只重跑了开站相关测试。实机三条和安装包这轮没跑。

和正文方案的三处差别：

1. 判据是 `siteOpenEndsTheJob(goal, brainPlan, mission.plan)`。`AgentGoal.plan` 是行程，不是脑区计划。没有脑区计划时看可执行手册 `mission.plan`。两份都没有才退回 `openSiteIsTheJob`。交付物里已经有非 answer 时，无计划也不早退。
2. 纯开站要 `close(done)` 时，先 `skipLoneNavigate` 把那唯一的 `running` navigate 标成 `skipped`，再进现有的 `earlyExitMayCloseDone`。不要放宽「还有未完成步就不许 done」。
3. 底账里进循环前就有一条 turn，`findings` 为空，第 0 步创建时就是 `running`。验收要看某条 turn 的 `findings` 至少 1 条，并且侧栏出现「正在做」。

「打开百度，搜今天北京天气」里的「搜」本来就在旧词表里，这条是回归，不是这次事故的复现。正则仍然会放行、要靠计划拦住的句子是「打开微博，把前十条复制下来」。

---

## 0. 一句话病因

**理解层和计划层全部做对了，但主循环第 0 轮被一条本地正则 `openSiteIsTheJob` 抢答：「当前我打开的这个博主」里的「打开」被当成「打开站点」指令，`namedSiteIsOpen` 发现当前页就在 weibo.com 上，直接 break——4 步脑区计划一步没跑，任务以 incomplete 关单。**

---

## 1. 事故还原（底账实证）

任务：19:15:49「当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档」，单号 `m-mvp5ukto-ncuax`。

证据来源（本机只读）：

| 文件 | 内容 |
|---|---|
| `%APPDATA%\sparo-store\missions.jsonl` | 该单 3 条流水：open → turn(running) → close(incomplete) |
| `%APPDATA%\sparo-store\chat-memory.json` | 侧栏：目标卡 → 计划卡 → 「对照目标汇总…」→「还缺：直接回答、读懂当前页」 |
| `%APPDATA%\sparo-store\experience.json` | 19:15:53 落经验「这次缺了直接回答、读懂当前页」 |

时间线（Asia/Shanghai）：

| 时间 | 事件 |
|---|---|
| 19:15:49.188 | 开单。kind=page，deliverables=[直接回答, 读懂当前页]，decision=act，脑区计划 4 步（读主页确认博主 → 滚动筛选近三天 → 提取整理 → 写文档）。**理解层零错误** |
| 19:15:49.211 | journal 记 turn，state=running，p0-read_page running |
| 19:15:53.632 | **close(incomplete)**。期间零 runLoopStep 执行记录、零「正在做 N/…」侧栏消息 |
| 全程 4.4 秒 | 侧栏最后一句：「还缺：直接回答、读懂当前页 计划里这些步还没执行：读取当前微博主页并确认博主、滚动加载并筛选最近三天微博、提取并整理最近三天微博内容」 |

关键点：计划卡出了，但**第一条「正在做 1/…」从未出现**——循环在推第一步之前就退出了。

---

## 2. 根因定位（精确到代码行）

### 主根因：`openSiteIsTheJob` 正则把「我打开的」当成「打开站点」指令

[src/main/agent/kernel/reasoner.ts:163-178](file:///d:/download/sparo上架应用商店版/src/main/agent/kernel/reasoner.ts#L163-L178)：

```ts
export function openSiteIsTheJob(goal: { raw: string; site?: string }): boolean {
  if (!goal.site) return false;
  const raw = String(goal.raw || "").trim();
  if (!/(?:打开|前往|进入)/.test(raw) && !/(?:^|[\s，,])去/.test(raw)) return false;
  const rest = raw
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/(?:请)?(?:帮我)?(?:打开|前往|进入)/g, "")
    .replace(/(?:^|[\s，,])去/g, "")
    .replace(/[\s，,。.!！？?、]/g, "");
  if (!rest) return true;
  if (/总结|摘要|提炼|概括|归纳|对比|比价|调研|评测|搜索|搜|查|看|推荐|热搜|填|发|登录|登陆|订|买|下载|注册/.test(rest)) {
    return false;
  }
  return true;
}
```

两道门都误判通过（已用 node 对该原句实测验证）：

1. **第一道门**：只查「打开」是否出现。「当前我**打开**的这个博主」里的「打开」是**用户陈述已发生的状态**（后面紧跟「的」，是定语修饰），不是「打开站点」的祈使指令。正则分不清这两种「打开」。
2. **第二道门**：剥掉指令词后剩余「当前我的这个博主最近三天的微博帮我复制下来做成一个文档」，排除词表（总结|摘要|…|填|发|…）里**没有「复制」「整理」「文档」「导出」「保存」「截图」等采集/产出词**——而这类词恰恰是「不只是开站」的最强信号。

### 放大器：`namedSiteIsOpen` 在循环第 0 行 break

[src/main/browser.ts:5098-5103](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L5098-L5103)：

```ts
private namedSiteIsOpen(goal: AgentGoal, tabId?: string): boolean {
  if (!openSiteIsTheJob(goal) || !goal.site) return false;
  const here = pageFinger(this.getUrl(tabId), this.getTitle(tabId));
  const siteUrl = goal.siteUrl || `https://${goal.site}/`;
  return Boolean(here.url) && sameSite(here.url, siteUrl) && !isLoginWall(here) && !isCaptchaWall(here);
}
```

- `goal.site="weibo.com"`，用户当前页就是 `weibo.com/u/1497714867` → `sameSite` 命中。
- 主循环 [browser.ts:5156](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L5156) `for` 循环第一行 `if (this.namedSiteIsOpen(current.goal, tabId)) break;`——**i=0、零 findings、零「正在做」，直接跳出循环**。
- 同一函数还在两处生效：[browser.ts:5279](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L5279)（每步执行后再查）、[browser.ts:5369-5375](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L5369-L5375)（循环后早退关单）。**三处共用同一个被污染的判定。**

### 为什么最后是 incomplete 而不是假 done

跳出循环后走 [browser.ts:5369](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L5369) 早退关单，`earlyExitMayCloseDone`（[verify.ts:169-181](file:///d:/download/sparo上架应用商店版/src/main/agent/kernel/verify.ts#L169-L181)）发现 brainPlan 还有 pending/running 步 → 返回 false → **拦住假 done**（这是 10-26 白天刚修的第三条早退旁路清点，本次事故中在岗、立功）。随后落入汇总路径，evidence 为空 → 空汇总 → close(incomplete) + 侧栏缺口提示。

**所以用户看到的是：出完计划卡，4 秒后直接说「还缺这些没做」。没有假成功，但任务也确实一步没跑。**

---

## 3. 分析：为什么这是脑手分离红线的违例

- 模型已明确产出：kind=page、decision=act、deliverables=[answer, page]、brainPlan 4 步含 read_page/act/search_read。**「这不是开站单」脑区已经表决过了。**
- `openSiteIsTheJob` 是理解层之前的存量正则，凭一个「打开」字样把模型的全部判断掀翻——与项目 memory 里「所有必须由模型拍板的决策点必须显式登记，禁止本地代码通过 if/else、正则提前抢答」直接冲突。
- 同类触发面（不止这一句话）：凡「当前我打开的这个 XX 帮我复制/截图/整理/导出」句式全灭；「打开微博，帮我把热搜前 10 复制下来」这类「打开+后半句采集」如果排除词表不含对应动词，同样中弹。

---

## 4. 修复方案（两层，按优先级）

### 修复 1（主修，脑区）：「只是开站」的判定必须以模型产物为准，不许正则独立拍板

位置：`namedSiteIsOpen`（browser.ts:5098）及其三处调用点（5156 / 5279 / 5369）。

结构性判据（从模型已产出的 brainPlan/deliverables 推导，不新增任何领域词表）：

- **仅当** brainPlan 恰好是「单步 navigate」（无 brainPlan 时退回 goal.plan 判断）**且** required 交付物只有 `answer`，`namedSiteIsOpen` 才允许返回 true；
- 计划多于 1 步、或存在 `page`/`report`/`form` 等非 answer 交付物 → 一律 false，任务必须进循环执行；
- `openSiteIsTheJob` 正则降级为**无计划产物时的兜底**，并在代码注释与决策点登记册中显式登记该 fallback（含过期时间，遵守「本地 fallback 必须标注过期时间」的既有约束）。

### 修复 2（辅修）：第一道门补一条语法信号，不是词表

位置：reasoner.ts:167。

- 「打开」**紧跟 的/了/着/过**（如「我打开的」「打开过的」）时是状态陈述，不是祈使指令 → 直接 `return false`。
- 这是中文语法信号（助词），不是领域关键词清单，不违反「禁止正则词表抢答」红线；且它只是收窄误判，不扩大本地决策权。

### 明确不做

- **不往第二道门排除词表里补「复制|整理|文档」**——那是第四只地鼠的打法，词表永远追不齐中文表达，且继续扩大本地抢答面。

---

## 5. 测试用例（必须新增）

| 用例 | 输入 | 期望 |
|---|---|---|
| 本次事故回归 | raw=「当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档」，site=weibo.com，当前页在 weibo.com，brainPlan 4 步 | `namedSiteIsOpen` = false；循环推出第一步 read_page，不 break |
| 纯开站保留 | raw=「打开微博」，brainPlan 单步 navigate，deliverables 仅 answer | `namedSiteIsOpen` = true，早退路径正常 close(done) |
| 打开+后半句 | raw=「打开百度，搜今天北京天气」 | 不早退，后半句必须执行 |
| 语法信号 | raw 含「我打开的」「打开过的」 | `openSiteIsTheJob` = false |
| 无计划兜底 | 无 brainPlan、无 goal.plan 的裸 goal | 走降级 fallback，行为与现状一致 |

---

## 6. 红线（不许这么做）

- **不许**向排除词表添加「复制|整理|文档|导出」等领域关键词作为主修复手段。
- **不许**把 `namedSiteIsOpen` 三处调用点改成三套不同判定——三处必须过同一个结构判据。
- **不许**改 `package.json` 版本号；修复 1（脑区/循环入口）与修复 2 各自独立 commit，不与任何其他改动合并。
- 改完必须 `npm test` 全绿 + `npm run typecheck` 退出码 0 再提交；提交用具名 add，禁止 `git add -A`。
- 不动 `docs/listings/`；不同步到原版 `D:\download\Sparo`。

---

## 7. 验收清单（QA 用）

- [x] 单测：§5 五个用例全过（`tests/site-open-job.test.ts`）。真实步骤的定义见评审修订第 3 条，不把入口空 turn 算进去。
- [x] `npm test` 522 项全绿，`npm run typecheck` 退出码 0（两笔都在之后又跑过一遍）。
- [ ] `npm run start` 实测：微博博主页（任意 u/xxx 页）打开状态下，侧栏发「当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档」→ 必须出现「正在做 1/…」，且某条 turn 的 `findings` 至少 1 条。2026-10-27 未跑。
- [ ] 实测：「打开知乎」→ 仍走早退，侧栏回「已打开 zhihu.com。」。人已经在知乎上时，那一步 navigate 是 `skipped`。2026-10-27 未跑。
- [ ] 实测：「打开百度，搜今天北京天气」→ 不早退，执行检索。2026-10-27 未跑。
- [ ] 重打包（`npm run dist`）后安装包复测上面三条。2026-10-27 未打包。

---

## 附：与既有修复的关系

| 既有修复 | 本次事故中的表现 |
|---|---|
| 早退旁路清点（10-26 白天，第三条旁路纳入 earlyExitMayCloseDone） | **在岗立功**：拦住了假 done，让失败以 incomplete + 缺口提示暴露 |
| synthesize 三层拦截 | 未触发（模型没来得及提议 synthesize，循环已被正则 break） |
| waiting_human 短肯定恢复 | 不相关 |
| P4 白屏 | 不相关，仍开放在 BUG-20261024-COLLECT-LOOP-WHITESCREEN |
