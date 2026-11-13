# 多平台新闻发布 R1 任务书（social-media-publish 可复用化）

> 对象目录：`C:\Users\<用户名>\.trae-cn\skills\social-media-publish`（**工具层，不在本仓库，不受发版约束**）。
> 与 0.4.1 打包并行，互不影响。本任务书**只动 skill 目录**，禁碰仓库 `src/`。

---

## 0. 现状核查结论（2026-11-09 夜，只读核查）

**已经写好了，也能跑通单篇单平台，但不可复用。**

| 项 | 现状 |
|---|---|
| `SKILL.md` | 6.1 KB（11-09 14:04），四平台流程 + 7 条铁律 + 定时发布表，写得清楚 |
| `references/platforms.md` | 6.3 KB（11-09 11:09），四平台 DOM 锚点，标了「MCP 实测」 |
| `scripts/` | **77 个 `.mjs`**，多为一次性探针与逐版修补 |
| 平台覆盖 | 头条、百家、大鱼、搜狐；网易号已剔除（11-09 拍板） |

**判断：文档层可用，执行层不可复用。** 换一篇稿、换一个标签就得重写脚本。

---

## 1. 问题清单（按严重度）

### P0

1. **客户端不传 tabId**：`scripts/sparo.mjs` 的 `exec` / `click` / `press` / `upload` 全都不带 tabId；而仓库 0.4.0（commit `094444d`）已让 `execute` / `select` / `upload` / `click_text` / `menu_click` 支持 tabId。skill 只能靠 `switch_tab` + 首行 URL 校验，**会切走用户标签、抢焦点**，和「后台发布」定位冲突。
2. **token 硬编码**：`sparo.mjs` 写死 `94fb09d7...`。`%APPDATA%\sparo-store\mcp-auth.json` 换 token 后全线失效。
3. **一次性脚本 77 个**：硬编码 tabId（如 `dayu-fill.mjs` 的 `TAB = "340ec140"`）、硬编码标题、硬编码本地 md 绝对路径；`fill/fill2/fill3`、`publish/publish2..5`、`cover-*` 十几个版本并存，改一处不知道哪版生效。

### P1

4. **无回执自动核验**：成功判定靠人眼或临时脚本，未实现「列表状态 / 公开链接 / 图片数」自动采集。
5. **铁律无断言**：头条「投放广告赚收益」必勾、百家「AI 生成」必不勾，只写在文档，没有发布前后 `checked` 回读断言。
6. **定时发布缺口**：搜狐未验证；头条锚点未固化（靠扫按钮文本）。

### P2

7. **台账写死跨项目路径**：`AI异世界_传播资产总库\04_发布与效果台账`，未参数化。
8. **「不许切 tab」纪律已过时**：那是 upload 无 tabId 时代的补丁，tabId 落地后需重验再放宽。

---

## 2. 本轮目标

把「一份定稿 + 一张封面 + 平台清单」变成**一条可重复命令**：后台完成填稿、插图、封面、选项、发布或定时、回读核验；任一步失败**停在原地交人**，不硬点。

---

## 3. 任务分解

### Part A 客户端瘦身（不碰仓库）

- A1 `sparo.mjs` token 改为读 `%APPDATA%\sparo-store\mcp-auth.json`，允许 `SPARO_TOKEN` 覆盖。
- A2 `exec` / `click` / `press` / `upload` / `select` / `click_text` / `menu_click` 全部透传 tabId。
- A3 删除 `switch_tab` 依赖；每个动作执行前校验 `location.href`，不匹配直接返回 `MISMATCH`，不发下一步。
- A4 `upload` 带 tabId 真机验证一次（头条正文插图）。

### Part B 统一入口

- B1 新建 `scripts/publish.mjs`：
  ```text
  node publish.mjs --platform toutiao --article <文章目录> [--schedule "YYYY-MM-DD HH:mm"] [--dry-run]
  ```
- B2 平台适配器统一接口：`openBlank → fillTitle → fillBody → insertImages → setCover → setOptions → publishOrSchedule → verify`。
- B3 文章目录约定：`title.txt` / `body.md` / `cover.jpg` / `images/`。**不再接受脚本内硬编码标题与路径。**
- B4 每步回读断言；失败输出：平台、步骤、原因、目标 tabId、页面提示原文。

### Part C 四平台迁移（每平台只留一套）

- C1 头条：合并 `toutiao-fill*` / `toutiao-cover-*` / `toutiao-publish*` 的有效路径为一套 adapter；保留「必勾广告收益」断言。
- C2 百家：合并 `baijiahao-fill*` / `baijiahao-cover-*`；标题 Lexical、正文 UEditor（`setContent` 只传 1 个参数）。
- C3 大鱼：合并 `dayu-*`；封面前置正文先有 3 张不同图。
- C4 搜狐：合并后补**定时发布探测**，找不到入口就停下报告，不硬点发布。
- C5 删除被取代的一次性脚本；每平台最多保留 1 个 `-probe` 巡检脚本。

### Part D 回执与铁律

- D1 发布后自动读列表页：标题、时间、状态、图片数、公开链接（审核中写「待回访」）。
- D2 铁律断言（发布前后各读一次 `checked`）：
  - 头条：广告收益 = 勾上；非首发时「头条首发」= 不勾。
  - 百家：AI 生成声明 = 不勾。
  - 大鱼：无 AI 图选「无需标注」，有 AI 图选「AI生成」。
  - 搜狐：创作声明 = 无需声明。
- D3 台账改为本地 JSONL，默认 `./ledger/YYYY-MM.jsonl`，路径可参数化。

### Part E 真机验收

- E1 四平台各发一篇（可设 10 分钟后定时，核验完撤回或删除）。
- E2 全程**不切标签、不抢焦点**，用户当前页不动。
- E3 每平台回执四件套齐全：列表状态、公开链接、图片数、选项回读。
- E4 三类故障各演练一次：验证码/滑块、登录失效、封面校验失败 —— 必须停手交人。

---

## 4. 验收

| # | 硬条件 |
|---|---|
| 1 | 一条命令跑完一个平台；四平台可顺序跑同一篇稿 |
| 2 | 全部页面动作带 tabId，代码里搜不到 `switch_tab` |
| 3 | 无硬编码 token / tabId / 标题 / 绝对路径 |
| 4 | 每平台回执四件套齐全 |
| 5 | 脚本数从 77 降到 **≤ 20**（入口 1 + 四平台 adapter + 探针 ≤ 4 + 共享工具） |
| 6 | 三类故障演练均停手交人，无硬点 |

---

## 5. 纪律

- 只动 skill 目录；**仓库 `src/` 一行不改**。
- 不代发用户未授权的稿件；定时稿必须由用户给时间。
- 验证码 / 滑块 / 短信验证 → 立即停手，交用户。
- 发布成功只认回执（列表状态 / 公开链接 / 图片数），不认点击成功。
- 与 0.4.1 修红并行时，互不引用对方文件。
