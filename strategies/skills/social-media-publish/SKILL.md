---
name: social-media-publish
description: 一稿多发到今日头条、百家号、大鱼号、搜狐号（网易号已于 2026-11-09 剔除），并支持百家号视频发布。通过本机 Sparo 浏览器 MCP 通道后台填稿、插图、设封面、发布并核验，不抢焦点。Use when the user asks to publish / 发布 / 分发 / 一稿多发 to any of these platforms, or mentions sparo 发头条/发百家号/发大鱼号/发搜狐号/发百家号视频. Do not use for content writing, analytics, or 微头条.
---

# 四平台发布（Sparo MCP）

统一入口是 `scripts/publish.mjs`。平台级 DOM 锚点与坑见 `references/platforms.md`；客户端见 `scripts/sparo.mjs`。网易号已剔除。

## 0. 铁律（每次发布前过一遍）

1. 今日头条：**必勾「投放广告赚收益」**。
2. 百家号：**绝不勾「采用 AI 生成内容」**。
3. 全平台：**不勾任何 AI 生成声明**。**例外（大鱼）**：正文/封面含 AI 生成图时，大鱼必须勾「信息来源—AI生成」（2026-11 扣分教训）。
4. 多平台分发同一篇：头条**不勾「头条首发」**。
5. 大鱼号：无 AI 图时信息来源选「无需标注」；有 AI 图时选「AI生成」。
6. 填表只认回执：以列表页状态、公开链接、图片实测数为准，不以点击成功为准。
7. 验证码 / 滑块 / 短信验证 → 立即停手，交用户完成。
8. **网易号已剔除默认清单**（2026-11-09 拍板：每次掉登录，自动化收益为负），不主动发；用户明确要求时按手动处理。

## 0.5 一条命令

```powershell
cd c:\Users\60914\.trae-cn\skills\social-media-publish\scripts
node publish.mjs --platform toutiao --article <目录>
node publish.mjs --platform baijiahao --article <目录> --schedule "2026-11-11 12:00"
node publish.mjs --platform dayu --article <目录> --dry-run
node publish.mjs --platform sohu --article <目录> --probe
node publish.mjs --platform weixin --article <目录>
node publish.mjs --platform weixin --article <目录> --no-docx
node publish.mjs --platform weixin --article <目录> --theme green
```

平台只认 `toutiao`、`baijiahao`、`dayu`、`sohu`、`weixin`。文章目录固定是 `title.txt`、`body.md`、`cover.jpg`、`images/`。微信公众号只存草稿，群发由人点（细节见 `weixin-publish` 技能）。

步骤固定为：`openBlank → fillTitle → fillBody → insertImages → setCover → setOptions → publishOrSchedule → verify`。任一步失败就停，输出平台、步骤、原因、tabId、页面提示。`--dry-run` 填到选项回读为止，不点发布。定时必须写成 `--schedule "YYYY-MM-DD HH:mm"`，不带时间不会开跑。

**配图与 Word 导入（2026-11-16 拍板，当晚更新）：**

- **微信默认全走 `docx` 导入**：0 图 / 1 图 / 多图都一样，导入后由 `formatBody` 统一排版；只有 `--no-docx` 才改回直填正文。
- 其它平台要 `--docx-import` 才走导入：正文插图 **≥ 3 张** → 走平台「文档导入」，`scripts/docx.mjs` 零依赖生成 .docx（ZIP + 最小 OOXML + 内嵌图片），一次把图文送进编辑器；图片全带上。
- 直填路径的配图默认：正文 **≤ 2000 字 1 张**，**> 2000 字 2 张**；`--images N` 覆盖张数（docx 模式同样生效）。
- docx 模式下步骤改为 `openBlank → importDocx → formatBody → fillTitle → setCover → ...`（importDocx 顶掉 fillBody + insertImages；导入会覆盖全文，所以不要混用）。
- 排版主题 `--theme editorial|ink|green`，默认 `editorial`；字号/行高/主色/圆角都集中在 `scripts/format.mjs`，改一处全文生效。

搜狐号探测不到定时入口就停手，不改点「发布」。大鱼号 `images/` 里不足 3 张不同图时，封面和发表都不会开始。正文或封面是 AI 图时加大鱼参数 `--ai-images`，信息来源才会选「AI生成」；否则选「无需标注」。

台账追加到技能目录 `ledger/YYYY-MM.jsonl`，可用 `--ledger <文件>` 换地方。

## 0.6 账号环境

点名账号时，图文和视频都要带 `--env`。先 `list_envs`，id 精确匹配；名字把「百家号二 / 百家号2」「百家号三 / 百家号3」归一成同一个全名再精确比对。对不上或有两个同名，直接失败，不要去掉 `--env` 改走默认登录态，也不要新建环境。

没点名账号、也没写 `--env` 时，仍走原来的默认登录态。

```powershell
node publish.mjs --platform baijiahao --article <目录> --env ad0fe9db --dry-run
node video.mjs --platform baijiahao --video <mp4> --title "标题" --env ad0fe9db --dry-run
```

环境名「百家号2」不等于页面昵称。提交前核对标签的 envId，以及打开编辑页时读到的页面账号名。对不上就不点发布、不定时发布。

同步这份技能时按文件合并。源仓库和安装目录各有对方没有的文件，禁止整目录覆盖。

## 1. 连接

MCP 地址与 token 读 `%APPDATA%\sparo-store\mcp-auth.json`。需要临时换 token 时设环境变量 `SPARO_TOKEN`，不要写进文件。先确认活着：

```powershell
Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 3921
```

没有监听说明 Sparo 已退出，启动并等 10 秒：

```powershell
Start-Process "D:\Program Files\Sparo\Sparo.exe"
```

```powershell
cd c:\Users\60914\.trae-cn\skills\social-media-publish\scripts
node sparo.mjs tabs
```

## 2. 操作纪律（MCP 的坑）

- `exec` / `click` / `press` / `upload` / `select` / `click_text` / `menu_click` 都带 `tabId`。发布前临时 `switch_tab` 到编辑标签。高度已经大于 0 就不再申请渲染。目标标签和活动标签都是 0 时调用 `ensure_render`（主进程 `restore` + `showInactive`，不夺焦），任务结束归还。活动标签正常而目标仍是 0 为 `RENDER_NOT_READY`；两边都是 0 为 `WINDOW_MINIMIZED`。技能脚本不调用 `window.focus()`、`win.show()`、`restore()`，不闪任务栏。
- 每个动作发出去之前先读目标标签的 `location.href`。地址不匹配就返回 `MISMATCH`，这一步不再发。
- 当前 Sparo 的工具参数里如果没有 `tabId`，客户端返回 `MISMATCH:SERVER_NO_TABID`，不把动作打到活动标签。
- `page_text` / `get_url` / `navigate` 同样带 `tabId`。
- **只操作目标平台那一个标签页**。店小秘、其他业务窗口、用户手动开着的 tab 一律不碰；拿不准就在返回结果里核对 URL。
- 填完一个字段就回读校验（标题 input.value、正文 innerText 长度、图片数），不做"点完就算"。

## 3. 平台路由

| 平台 | 后台入口 | 备注 |
|---|---|---|
| 今日头条 | `https://mp.toutiao.com/profile_v4/graphic/publish` | 封面硬校验；发布需两次确认 |
| 百家号 | `https://baijiahao.baidu.com/builder/rc/edit?type=news` | 标题是 Lexical；正文 UEditor |
| ~~网易号~~ | ~~`https://mp.163.com/`~~ | **已剔除默认清单**（2026-11-09）：每次掉登录需扫码，不再自动发 |
| 大鱼号 | `https://mp.dayu.com/` | 正文是 iframe；封面只能从正文选 |
| 搜狐号 | `https://mp.sohu.com/mpfe/v4/contentManagement/first/page` | 旧路由白屏；创作声明选「无需声明」 |

账号：搜狐/网易/大鱼当前为「东望」；头条、百家按后台实际显示登记，不臆测。

## 4. 标准流程（单平台）

上面的命令按这个顺序做。不要再跑 `scripts/` 里旧的一次性脚本。

1. **定位**：`tabs` 找目标平台 tab；没有就 `navigate` 打开（已登录会直接进后台）。
2. **新建**：进「发布内容 / 写文章」，确认拿到空白编辑器（旧草稿会残留，宁可新开）。
3. **标题**：受控输入一律 native setter + `input`/`change`，回读 `value`。
4. **正文**：整篇 paste（text/plain 或 text/html），粘贴前确保编辑器为空，避免翻倍。
5. **正文图**：走平台图片入口上传本地封面同名图；上传与确认之间不切 tab；回读 `img` 数量。
6. **封面**：单图优先；大鱼要三图就先往正文塞 3 张不同图。
7. **选项**：按第 0 节铁律勾/不勾；勾选后回读 `checked`。
8. **发布**：点主按钮 → 处理二次确认弹层 → 以 URL 跳转 + 列表新条目为成功。
9. **核验**：列表页读出「标题 / 时间 / 状态 / 图片数」，与台账一致。

## 5. 多平台分发

- 顺序：先发头条、百家，再发大鱼、搜狐。网易号不在这条链路里。
- 各平台共用同一份定稿与同一张封面；标题按平台习惯微调，正文不改事实。
- 每发完一个平台立刻核验并登记，不要攒到最后一起验。
- 头条作为非首发平台时，**取消「头条首发」**，但仍勾「投放广告赚收益」。

## 5.5 定时发布（2026-11-09 起支持）

稿件带 `publish_mode: schedule` + `schedule_time` 时走定时，不点「发布」：

| 平台 | 定时入口 |
|---|---|
| 头条 | 编辑页「定时发布」→ 弹层 `.common-timing-picker` 选日/时/分 →「预览并定时发布」**只进预览** → 预览页底栏「定时发布」才真提交；核验去作品管理 |
| 百家 | 点「定时发布」→ 选未来日期时间 → 确认（已验证路径） |
| 大鱼 | 发布页「其他设置」区定时发布 → 设时间后点「发表」 |
| 搜狐 | 未验证，先探测；找不到入口就停下来报告，不硬点发布 |

纪律：时间约束以平台校验提示为准；铁律与立即稿相同；设完回读日期、小时、分钟再离开；核验状态应为「定时/待发布」；同日多篇用定时错峰（百家新号每天最多 1 条）。台账登记「定时 YYYY-MM-DD HH:mm」。找不到定时入口就停，不改点立即发布。百家号不勾「采用AI生成内容」。

**百家号定时五条硬经验（2026-11-11 实测，别再踩）：**

1. 小时/分钟下拉是 `rc-virtual-list`，只渲染可见十几项，07点常常不在 DOM —— 必须"先扫当前渲染项，找不到再滚一屏，边滑边找"，禁止按行高估算 scrollTop 后立刻读（React 未重渲染，读到旧值）。
2. 打开下拉用真实鼠标点击（CDP 坐标），不要用 JS 合成事件：弹层刚出现或上一个下拉还在淡出时合成事件会被吞，表现为点了没反应。
3. 判断"下拉开了没"必须带 `aria-hidden !== 'true'`；否则淡出中的浮层会被当成已打开，于是不重试。
4. 回读只在 `.timepublish-wrap` 里取三个 `.cheetah-select`（按"含定时的弹窗"找会抓到页脚按钮条，误判成没填）；确认按钮点名 `.cheetah-modal-confirm-btns button.cheetah-btn-primary`，因为它和页面上开弹层的按钮同名。续跑时弹层若还开着，先用「取消」关掉再重填。
5. **点了页脚「定时发布」之后的收尾报错（`AI_CONTROL_MISSING`、`TITLE_UNREAD` 之类）不等于没发出去**。2026-11-11 有两篇报错之后，内容列表里其实是「定时发布 预计 … 发布」。规矩：定时提交后任何失败，先只读列表那一行，确认没提交再重试；已提交就只补台账，绝不重发。

**头条发布八条硬经验（2026-11-11 起，2026-11-12 修订立即发布与质量门）：**

1. **定时是两步**：弹层「预览并定时发布」只把你带到预览页，**没有提交**；必须再点预览页底栏的「定时发布」（`button.publish-btn`）才真提交。只点第一步就去查列表，会以为失败然后重发，重复发稿。
2. 弹层是 `.common-timing-picker`，三个 byte 下拉 `.day-select` / `.hour-select` / `.minute-select`，选项在 `.byte-select-popup` 里全量渲染，按文本精确点即可；时间窗口是**当前 +2 小时 ～ 7 天**，超出范围选项里根本没有。
3. **定时稿不在 `/graphic/articles`**（那里只有已发布）。核验去作品管理 `/profile_v4/manage/content/all`：刚提交显示「审核中」+「将于 MM-DD HH:mm 发布」，审核过变「定时发布中」。两种都算成功，时间必须对上。
4. 图片抽屉 `.mp-ic-img-drawer` 默认没有 `input[type=file]`，要先点「上传图片」页签；上传后要等「已上传 N 张图片」、缩略图加载完成、确定按钮可用再点。按钮仍 disabled 时，真实点击最后一张新上传缩略图；不要只看「确定」文案就 click。
5. 插图前先关闭 `.ai-assistant-drawer` 创作助手，它的 `.byte-drawer-mask` 会盖住正文、抢走点击。随后真实点击目标段落（`caret:true`）并回读 selection，再真实点击工具栏图片按钮。自定义段落标记后不要等待（ProseMirror 会清掉）；2026-11-11 实测 `Ctrl+P` 不再打开图片抽屉，不要拿它当唯一入口。
6. 确认后必须同时回读「抽屉关闭 + `.pgc-img` 增加」，不要数 `.ProseMirror img`（一张正文图会有内部重复 img）。多图从后往前按段落均分；续跑保留已回读的图，只补缺失张数。
7. **立即发布必须用 Sparo CDP 真实点击**（2026-11-12 实测）。`page.mjs clickLabeled` 用 `el.click()` + 合成 MouseEvent，头条「预览并发布」和「确认发布」按钮不响应合成事件——预览层根本不会弹。必须先给按钮打 `data-sparo-publish="预览并发布"` 标记，再用 `sparo.mjs click("[data-sparo-publish=预览并发布]")`。封面没回读到 1 张之前不点（头条预览以封面为前提）；点完看 `.preview-article-mask` 是否出现，不要盲目重试。空回执不代表没点上，看页面结果（层出现 or 已离开编辑页）再决定。**定时发布不走这条，定时弹层里的 b.click() 对头条仍有效。**
8. **发布前质量门在点按钮之前执行**（2026-11-12 固化）。`assertPublishReady` 检查：`MARKERS_LEFT`（正文还有 @@IMG 标记）、`IMAGE_COUNT_MISMATCH`（正文图数 ≠ 文件数）、`COVER_REQUIRED`（封面不是单图）、`OPTIONS_MISMATCH`（广告未勾或首发被勾）。任何一项不过就不点按钮，直接返回错误码。

正文图位置：单图放中段，多图按段落均分，禁止全部堆在文末（`withImageSlots`）。

**百家号续跑两条硬经验（2026-11-12 实测五图稿）：**

1. 续跑时**只补编辑器里还在的 @@IMGn@@ 标记**。先用 `readLiveBody` 读 UEditor 当前 innerHTML 里剩余的 @@IMG 标记集合，不在集合里的（上次已经写回的）`continue` 跳过，不要重传同 URL。
2. 每张图确认成功后**立刻 `setUeContent(ctx, html)` 整篇写回**，不要等全部传完才写。同一张图再传一次时图床会返回已存在的 URL，按 `srcs.length > beforeSrcs.length` 算成功（不只认新 src）。

**百家号发布前质量门**（2026-11-12 固化）：`assertPublishReady` 在 `publishOrSchedule` 入口执行，检查 `MARKERS_LEFT` / `IMAGE_COUNT_MISMATCH` / `COVER_REQUIRED`（封面不是单图或 radio 没选）/ `OPTIONS_MISMATCH`（AI 被勾上）。不过就不点按钮。

上面这套写法已经写进 `node publish.mjs --self-check` 的断言。当前（2026-11-12）会锁：
- **头条立即发布不能用 clickLabeled / clickExact**（合成 click 不触发头条按钮）——搜 `clickLabeled(ctx, ["']预览并发布["'])` 或 `clickLabeled(ctx, ["']确认发布["'])` 即报 SELF_CHECK_FAIL
- **百家号续跑必须用 pending Set 过滤**（遍历全部图会重传同 URL）
- **两个平台 publishOrSchedule 入口都有 assertPublishReady**（质量门）
- 空包兜底（头条关助手、插图确定）
- 百家号 waitUploaded 必须 ≥ 1 张且按钮非 disabled
- 台账只在 report.ok 时写定时时间

改完任何一项，跑 `node publish.mjs --self-check` 看能否过。不过就去改代码或改断言，不要两边改。

## 同步（代码改动进技能后必须做）

改完脚本、SKILL.md、references/ 后，**先双向逐文件合并，再把确认过的文件逐个同步到安装副本**。源仓库和安装目录各自都有对方没有的能力（安装副本有视频入口与扩展适配器，源仓库有更新的环境感知采集、评论和指标），禁止整目录覆盖，也不要删除台账和探针：

```powershell
# 只同步本轮确认过的文件，逐个 Copy-Item
$src = "D:\download\sparo上架应用商店版\strategies\skills\social-media-publish"
$dst = "C:\Users\60914\.trae-cn\skills\social-media-publish"
Copy-Item "$src\scripts\video.mjs" "$dst\scripts\video.mjs" -Force
# 两边都跑 self-check（图文和视频）
node publish.mjs --self-check
node video.mjs --self-check
```

台账 `ledger/*.jsonl`、安装副本独有的 `_probe_*.mjs` 不参与同步。主进程不热更，安装包不会自动更新。

工作区结构：
```
strategies/skills/social-media-publish/
├── scripts/            ← 所有 .mjs
├── platforms/          ← 4 个平台 JSON
└── ledger/             ← 运行时台账
```

安装副本结构（多了两份文档）：
```
C:\Users\60914\.trae-cn\skills\social-media-publish/
├── SKILL.md            ← 技能说明（工作区没有！）
├── references/
│   └── platforms.md    ← 平台级 DOM 锚点
├── scripts/
├── platforms/
└── ledger/
```

**SKILL.md 和 references/ 也纳入双向合并**：安装副本是运行时入口，源仓库是版本基座，改哪边都要逐文件同步，不要整目录覆盖。

续跑：`--from setCover` 这类参数从指定步骤接着做。开跑前编辑页里必须已经是这篇标题，否则停下来让人从头跑，不重写标题和正文。

已断言：百家号「采用AI生成内容」保持未勾。头条「投放广告赚收益」必须勾上，「头条首发」保持未勾。赞赏、微头条、作品声明、打赏没有封装，要人工看。

## 6. 失败处理

- **同一步失败两次就停手，换"读现场"，不要再换第三种写法重跑整条链路。** 导出可见弹窗数量、每个按钮的文案与 disabled、选中态、缩略图列表，看清哪一条假设错了再改一次。31 秒一次的完跑，比四轮猜测便宜得多。
- 编辑器白屏 / 正文丢失：先确认路由正确（搜狐是典型）；再刷新重进。标题还在就用 `--from` 从失败的那一步续跑，不要整篇重填。
- 图片没进正文：先读 `.ai-assistant-drawer` 和遮罩，再读光标落点；不要直接重跑整条链路。上传后确认按钮常是 disabled，要等它变可用再点，不认文案全等（按钮会写成「确定 (1)」）。抽屉重渲染导致某一拍读不到缩略图时，下一拍重读，绝不上传第二次。
- 封面：缩略图要点**刚上传的那张**（一般是最后一张），选完必须断言主按钮已可用、点完必须断言弹窗已关闭且 `.article-cover img` 已出现。上传预览可能是 `.img-span` 背景图而不是 `img`，等待与确认必须两种都认；2026-11-11 罗大佑稿实测只找 `img` 会误报 `NO_THUMB`，不能因此重复上传。原图像素达标但上传区一直为空时，由 Agent 把原图重编码为 1500×1000 JPEG 后只重试一次；2026-11-11 显卡稿实测此法通过，禁止 40 秒空等后循环上传。
- 发布无反应：先找页面校验提示（封面、信息来源、三图、声明），不要重复点。
- 登录态失效：只把该平台 tab 交给用户，其他 tab 不动。

## 7. 收尾

在 `AI异世界_传播资产总库\04_发布与效果台账\发布台账_2026-11.md` 追加一行/一段：平台、提交时间、状态、图片数、公开链接（审核中则写待回访）。

## 8. 视频发布（百家号 videoV2，2026-11-14 起）

视频走 `scripts/video.mjs`，与图文共用 `sparo.mjs` / `page.mjs` 的纪律，但适配器是 `scripts/adapters/baijiahao-video.mjs`。

**账号默认只发「图一乐研究所」（2026-11-16 定）**：不写 `--account` 就是这个号。开跑传视频前、上传后、发布前各核对一次页面昵称；不是这个号就不发；上传后才发现上错号，会先把刚传的视频删掉再停。要发别的号必须显式 `--account <昵称>`，不要靠换登录态碰运气。

**环境对应（2026-11-16 实测）**：`百家号2` = `ad0fe9db` = 图一乐研究所；Sparo 默认登录态是「东望」，所以视频必须带 `--env 百家号2`，裸跑会被账号硬门直接拦下。视频编辑页头部只有头像、没有昵称，`readBaijiahaoAccount` 现在优先读 `/builder/app/appinfo` 的 `data.user.name`（`via=appinfo`）。这版 Sparo 的 `list_tabs` 不返回 `envId`，视频流程允许退回「昵称对得上」兜底（`ctx.envFallback="account"`），环境 id 缺失不再直接卡死。

### 8.0 先分工：哪些交给脚本，哪些必须大脑判断

发布视频不是纯脚本任务，也不是纯人工任务。每次动手前先划两栏：

| 潜意识模式（脚本，可无人值守） | 意识模式（必须大脑判断） |
|---|---|
| 开自己的标签页、测渲染、还原用户标签 | 这条视频配什么标题、描述、话题 |
| 传视频、轮询进度、填标题、填描述 | **封面到底要不要换**：`probeCover` 报「已有自动封面且无不合格提示」就保留；报空槽/不合格才补传 |
| 点选封面「本地上传」、点确定 | 抽哪一帧当封面（要有画面、有角色、有冲突，不能乱截空镜）、构图是否被裁到关键部位 |
| 打 `#` 触发联想、点选话题 | 联想列表里选哪一条（看流量、看是否蹭错热点），凑够 5–10 个 |
| 发布前质量门、点发布/定时发布、回列表核验 | 页面出现「封面不佳/清晰度低」时，判断是改还是接受 |

脚本只负责“已经知道该怎么做”的事；凡是“看完才知道该怎么选”的，必须留给大脑，不要硬编码进脚本假装自动化。
**`probeCover` 就是给大脑看的探针**：它只报状态不点任何东西，大脑读完再决定 `--cover auto|always|never`。

### 8.1 为什么之前慢、还会被别的窗口抢走

| 慢/抢窗口的原因 | 视频工作流的做法 |
|---|---|
| 每一步新开一个 `node sparo.mjs ...` 进程：重新 initialize、重新 `tools/list`、每次动作前读三次 `location.href` | 一个进程跑完整链路，`sparo.mjs` 当库 import，全程一条 MCP 会话 |
| 直接按 `tabId` 操作任意标签，别的 agent 一导航就把编辑页冲掉（实测 2026-11-14 13:xx：`type=videoV2` 被顶成头条登录页） | `openWriteTab()` + `sessionStamp()`，只复用 owner 是自己的编辑页；不是自己的 tab 一律不写 |
| 后台标签 `innerHeight=0` 时按坐标点，点不中发布 | 先 `activateEditor()` 切到编辑标签量高度，必要时 `ensure_render`，结束 `restoreActive()` 还原用户标签 |
| 点完就当成功 | 发布前过质量门，点完轮询跳转/提示，再回列表页读回标题 |

### 8.2 一条命令

```powershell
cd c:\Users\60914\.trae-cn\skills\social-media-publish\scripts
node video.mjs --platform baijiahao --video <mp4> --title "<标题>" --topics "搞笑,沙雕,名场面,夫妻日常,生活" --auto-cover --at 118
node video.mjs --platform baijiahao --video <mp4> --title "<标题>" --topics "..." --cover auto --cover-land <jpg> --cover-portrait <jpg> --schedule "2026-11-15 05:00"
node video.mjs --platform baijiahao --from setCover --video <mp4> --title "<标题>" --cover-land <jpg> --cover-portrait <jpg>
node video.mjs --platform baijiahao --until setDeclaration --tab <tabId> --video <mp4> --title "<标题>" --topics "..."  # 分段跑，人工看一眼再续
node video.mjs --probe          # 只读标签现场，不开页、不填、不发
```

步骤固定：`openWrite → uploadVideo → accountAfterUpload → probeCover → fillTitle → appendTopic → setCover → setCoverPortrait → setDeclaration → schedule → publish → verify`，其中传视频前和发布前各有一次账号昵称核对。任一步失败即停，输出 step / code / tabId / 页面提示；改了封面或话题用 `--from` 续跑，不重传视频。

- `--account <昵称>` 不写默认「图一乐研究所」；写了就发那个号，但页面昵称对不上仍然停。

- `--cover auto`（默认）保留平台自动封面；`always` 强制重传；`never` 完全不碰封面。
- `--schedule "YYYY-MM-DD HH:mm"` 走定时发布；**「定时发布」弹窗的「确定」= 直接提交定时任务**，提交后页面会离开编辑器，`publish` 会自动跳过，不要再去点「发布」。
- `--tab <tabId>` 复用用户已打开的那个标签（`location.replace` 到编辑页）。**绝不 `new_tab`**：另一套登录态会把作品发到别的号。

### 8.3 视频页的铁律

1. **封面先判断再动手（2026-11-15 改）**：视频传完平台常会自动挑一张封面并给「智能推荐封面」。**已有自动封面且没有「不合格/请上传」提示 → 保留，不覆盖**；槽位是空的、或提示封面不合格 → 才上传自己的图。页面只给一个横版槽位时不要再找竖版（`setCoverPortrait` 会自动跳过）。
2. **封面不能有边框**。百家号的检测会把「模糊边条 / 台标 / 字幕条」判成边框，提示「图片存在边框，建议修改或删除」，属于必须改的项。`video-cover.mjs` 默认先切右侧台标区（`--trim-right 0.25`）和底部字幕区（`--trim-bottom 0.16`），再取 16:9 与 3:4，不留边条。
3. **取景按主体调**：`--land-y 1` 贴底（主体在画面下半部时用），`--port-x 0.35` 向左取。生成后必须肉眼过一遍再上传。
4. **标题是 Lexical**：只能 `__lexicalEditor.setEditorState(parseEditorState(json))` 整段替换；`execCommand` / `innerText` 追加会让标题重复多份。视频页**没有独立标题框，也没有 textarea**，「作品描述」那个唯一的 contentEditable 就是标题+描述+话题的宿主。
5. **横竖版都走弹窗**：点槽位 → 弹窗左下「+ 本地上传」塞本地图 → 等「确定」从 disabled 变可点 → 点「确定」→ 等弹窗关闭。两个槽位按**从左到右排序**取：第 0 个横版（`横版封面预览 (16:9)`），第 1 个竖版（`竖版封面预览 (3:4)`）。
   - 槽位已有封面时，「编辑封面」遮罩只在 hover 时出现（静止态是 0×0）。合成 `mouseover` 不会真的触发 CSS hover，所以**兜底直接点容器**，不要死等那个叶子出现。
   - **弹窗里的按钮不要跨 exec 用 id 找**：`.cheetah-modal` 关闭后 DOM 节点仍在页面里（只是不可见），`getElementById('sparo-cover-ok')` 会命中上一轮残留的隐藏副本，点了等于没点，白等几十秒——这是 2026-11-15「上传封面卡很久」的根因。正确姿势：**一次 exec 内**筛出 `width>0` 且文案含「横版/竖版封面预览」的最后一个弹窗，再在里面按文本找「确定」直接 `.click()`；要用 CDP 兜底前先 `removeAttribute('id')` 清掉旧的 `sparo-*` id。
   - 合成 `el.click()` 即可，不必强求 CDP 真实点击；CDP 只在 JS 点击无效时兜底。
   - 实测「确定」有时不关弹窗，但封面其实已经生效。等 3 秒仍开着就点右上角 `.cheetah-modal-close` 兜底，并记 `forcedClose: true`，不要判失败。
6. **话题 5–10 个，一个都不能少，但字数是硬上限**：输入框旁 `# 话题 n/10`，右下角还有 `n/50` 的**作品描述字数计数**。
   - **50 字硬顶（2026-11-15 加，2026-11-16 扩到立即发布）**：`作品描述` = 标题 + 话题，按「`#话题#`」计字（每个话题 = 词长 + 2）。**总数必须 ≤ 50**，超了计数变红，点「定时发布」/「发布」都发不出去（之前连挂就是标题 18 字 + 7 个话题 = 58/50）。`assertTextBudget` 在 `schedule` 和 `publish` 提交前都会读页面计数，> 50 直接 `TEXT_TOO_LONG` 拦下。
   - 所以**排话题要按预算来**：先扣标题字数，剩下的额度按流量优先级塞短词，塞不下就少塞，但**少于 5 个直接 `TOPICS_TOO_FEW` 停下**。宁可把话题从 7 个降到 5 个，也不能超 50 字。
   - 挑流量大的词，优先：搞笑 / 沙雕 / 名场面 / 生活 / 日常 / 搞笑视频 / 美食 / 吃货 / 宠物 / 妙招。**每个话题都要点联想列表，不能塞纯文字**：联想项文案是**带空格的 `# 搞笑 #`**（class 含 `topicName`），按去空格后的文本匹配；点选后编辑器里会出现 `span.video-title-tag[data-tag-type=topic][data-tag-text="#搞笑#"]`，这才是真话题实体。
   - **打 `#` 和打话题词必须分两步**（中间停 ~800ms）：一次性 `insertText('#宠物')` 时 Lexical 把两次改动并成一批，联想列表根本不弹。分两步实测 100% 出联想。
   - 只补纯文字 `#搞笑#` 会在点发布时被拦截：「作品描述中存在未匹配的话题/@内容 → 不处理 / 自动匹配」。脚本优先点 **自动匹配**（让它把话题词转成真话题），兜底才点「不处理」。
   - 判断话题是否生效，认 `[data-tag-type="topic"]` 的**数量 +1**，不要认 `[class*=topicName]`（那是联想列表项，不是正文实体）。
   - 第 2 个话题开始**绝不能整段重写编辑器**（会抹掉已有话题实体）；只有实体数为 0 时才允许清纯文字残留。
7. **创作声明**选「无需声明」，不要选 AI 生成。
8. **发布前质量门**：标题回读一致、`<video>` 已就绪、封面缩略图 ≥ 1、页面无「请上传 / 不能为空 / 不合格」。过了才点，点完必须看到跳转或提示，再回列表页读回标题。
9. **定时发布是「一步提交」**：点「定时发布」→ 选日期+时间 → 点弹窗里的 **「定时发布」**（不是「确定」）就把任务建好了，页面随即离开编辑器。此后 `publish` 必须跳过，**绝不能再点同排的「发布」**（会立刻发出去，把定时作废）。回读核验看列表里的「定时发布 / 预计 … 发布」，条目在 `?type=shortVideo&collection=pre_publish`。
   - 弹窗标题是「定时发文」，里面是**三个 cheetah-select（日期 / 小时 / 分钟）**，`input.cheetah-select-selection-search-input` 全是 `readOnly`，**写 value + dispatch input 完全无效**（会静默保持默认值 = 当前时间 +1 小时）。
   - **不要点开下拉去点选项（2026-11-15 实测彻底走不通）**：这三个下拉都是 `rc-virtual-list` 虚拟列表，只渲染约 9 项；而 Sparo 浏览器在后台时 `document.visibilityState === "hidden"`，`requestAnimationFrame` 被整段暂停 → 改 `scrollTop`、`dispatchEvent(new ScrollEvent('scroll'))`、`ArrowDown` 键盘导航**都不会触发重渲染**，列表永远停在 9点–17点，18 点以后和 44 分这种值永远点不到，只会得到 `SCHEDULE_TIME_UNSETTABLE`。
   - **正解：直接调 Select 组件自己的 `onChange`**（和用户点选同一入口，不依赖任何渲染）。从 `.cheetah-select` 的 `__reactFiber$*` key 往上走，取「`typeof props.onChange === 'function' && ('popupClassName' in props || 'suffixIcon' in props)`」那层为目标，再从祖先里拿 `props.value.options` 拿到全部选项（日期 `2026-11-15` / 小时 `9`…`23` / 分钟 `0`…`59`），校验目标值存在后调 `onChange(value, { value, label })`，最后回读 `.cheetah-select` 文案核对（日期显示成 `11月15日`，不是 `2026-11-15`）。
   - 可定时窗口是 **当前时间 +1 小时 ~ 7 天**；当天已过的小时不在选项里，日期下拉只给 8 天。批量跑时每条都要留足提前量（`目标时间 ≥ 实际提交时间 + 1 小时`），否则跑到后面会整批 `not in options`。
   - 提交后页面会跳到 `/builder/rc/clue?...`（「提交成功，正在审核中」）。此时编辑页的 `.cheetah-modal` 是 SPA 残留，**不能因为「弹窗还在」判 `SCHEDULE_MODAL_STUCK`**，URL 离开 `/rc/edit` 就算成功。
10. **上传组件是异步挂载的**：`uploadVideo` 一进来就查文件框会空手。先看有没有 `<video>`（恢复的草稿可能已挂视频，直接跳过），没有就等文件框最多 20 秒。
11. **核验必须落在列表页**：`/builder/rc/content`。视频（含定时/待发布）在 `?type=video` 的「待发布」页签里，短片也可能在 `?type=shortVideo`。停在编辑页读到自己的标题不算成功，会假阳性。
12. **「定时发布」按钮变灰 disabled（2026-11-15 实测）**：填得再完整，底部「定时发布」和「发布」同时 disabled（「存草稿」仍可点）时，脚本返回 `PUBLISH_DISABLED`。**别当 bug 反复重试**，先回列表页查这条素材是不是已经在「待发布/已发布」里 —— 最常见就是同一条视频已经提交过，平台按重复内容挡住；确实不在列表里再换天/换素材试。
13. **草稿不是服务端草稿，是 localStorage**：键名 `edit-<账号hash>-videoV2`（约 9KB JSON，含 title/topics/videoModule.mediaId）。所以每次打开 `edit?type=videoV2` 都会把上一条视频、标题、话题一起带回来 —— `uploadVideo` 必须用 `--expect-dur` 比对时长，否则会把上一条当成这一条（`已有视频` 跳过），最后发出去的是旧素材。`edit-token` 那个键是鉴权用的，别清。
14. **列表页要翻页看**：`?type=video` 一页 10 条，底部有 `1 2` 分页，`共N篇` 是当前筛选条件下的总数。只截第一页文本就判「没发出去」会误判（2026-11-15 就因此白折腾了一轮）。「已发布」的定时内容显示的是**实际发布时间**，定时中的显示「提交时间 + 预计 X 发布」，两者别混。
15. **同一素材重复提交会产出重复作品**：`--expect-dur` 只能防止拿错视频，防不了「同一视频再提交一次」。重跑前先回列表页确认该标题是否已存在。
16. **账号硬门（2026-11-16 加）**：视频默认只发「图一乐研究所」。`assertAccountName` 在传视频前、`uploadVideo` 之后、点发布前各读一次页面昵称：
   - 传视频前就对不上 → 直接停（`ACCOUNT_NOT_ALLOWED`），页面上什么都没传，换号重跑即可。
   - 上传后才发现对不上 → 调 `removeVideo` 把刚传的视频删掉：先点视频模块里的「删除」并确认；没有删除入口就清 `edit-*-videoV2` 本地草稿，让这条视频不残留，然后再停。
   - 昵称读不到同样按失败处理（`ACCOUNT_NAME_UNAVAILABLE`），不要「没读到就当通过」。
   - 换号只能显式 `--account <昵称>`；`--env` 是浏览器环境，不等于站点昵称，不要拿环境名去对账号。

### 8.4 封面生成

```powershell
node video-cover.mjs --video <mp4> --at <秒> --land-y 0.5 --port-x 0.5 --out-dir <目录>
```

输出 `cover_land.jpg`（1280×720）与 `cover_portrait.jpg`（1080×1440；`--port` 和 `portrait` 都落到这个文件名）。抽帧点选「动作峰值」那一秒，比视频首帧的点击率高，也更容易过封面检测。

**空槽（平台没生成 AI 封面）怎么补**：`[class*=cover-container]` 里没有图、也没有 `[class*=hovercontent]` 时，是 `cheetah-upload` 占位框 —— 此时不要去找「横版封面预览」文字（会误报 `COVER_TRIGGER_MISSING`）。直接给该槽位的 `input[type=file]` 打 id 再 `upload`，传完会弹「封面截取 / 封面预览」小弹窗，点「确定」即生效。长视频（170s+）封面区是后挂载的，动手前先等 `[class*=cover-container]` 出现（最多 60s）。

### 8.5 探测到的锚点（2026-11-14 百家号 videoV2）

- 编辑页：`https://baijiahao.baidu.com/builder/rc/edit?type=video` → 重定向 `type=videoV2`
- 视频文件框：`input[type=file]`，`accept` 含 `.mp4/.mov/...`（与封面的 `image/*` 区分）
- 标题：`[contenteditable=true]`，带 `__lexicalEditor`；全页唯一，兼标题+描述+话题
- 话题联想项：`[class*=topicName]`，文案 `# 搞笑 #`（带空格）
- 话题实体：`span.video-title-tag[data-tag-type=topic]`，带 `data-tag-id` / `data-tag-text`
- 封面容器：`[class*=cover-container]`；横版缩略图宽 ≈221，竖版 ≈93；「编辑封面」遮罩 hover 才出现
- 封面弹窗：`.cheetah-modal`，文案含「横版封面预览 (16:9)」/「竖版封面预览 (3:4)」，底部「确定」是 `cheetah-btn-primary`，右上关闭是 `.cheetah-modal-close`
- 发布前拦截框：「作品描述中存在未匹配的话题/@内容」→ 按钮「不处理」「自动匹配」；不选就不提交
- 发布按钮：`button.cheetah-btn-primary`，文本正好「发布」，同排还有「存草稿」「定时发布」
- 定时弹窗：文案含「定时发文」；`m.querySelectorAll('.cheetah-select')` 依次是 [日期, 小时, 分钟]；提交按钮文本「定时发布」，取消是「取消」
- 话题计数：输入框旁显示 `# 话题 n/10`（上限 10）
- 待发布列表：`/builder/rc/content?type=shortVideo&collection=pre_publish`，状态列显示「定时发布 / 预计 YYYY-MM-DD HH:mm 发布」
- 声明：`input[placeholder*=创作声明]` → 弹窗「必选声明」→「无需声明」→「确定」

