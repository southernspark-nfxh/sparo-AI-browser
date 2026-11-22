# 2026-11-22 交接：未打包源码，给下一扇窗口整批 QA

人要换模型、换窗口，一次把这条线 QA 完。不要打包。不要每测一句就改一句。

代码和设计都在这一个目录，没有另拷一份：

`D:\download\sparo上架应用商店版`

最后一次提交是 `0284699`（`master`，已推过）。下面列出的改动都还在工作区，没有提交。安装包 `release\Sparo-Setup-1.1.1122.exe`（105,037,109 字节，2026-11-22 21:36:37）是更早的一次构建，**不等于现在的源码**。`docs/PRODUCT-TASKBOOK.md` 里写的字节数和哈希与磁盘上这个文件不一致，以磁盘文件和 `CHANGELOG.md` 顶部为准。日常安装目录 `D:\Program Files\Sparo` 更旧。QA 当前源码必须从本目录启动，不要拿已安装的 Sparo 当这批代码。

## 先读这些

| 文档 | 干什么 |
|---|---|
| [PRODUCT.md](./PRODUCT.md) | 商店定位：本机浏览器，自己接单，也交给别的 Agent |
| [AGENTS.md](./AGENTS.md) | 意识是模型，潜意识是脚本；发稿、安全边界、指挥室 |
| [THREE-CHANNEL-DESIGN.md](./THREE-CHANNEL-DESIGN.md) | 下一步升级：门岗 / 无意识 / 有意识 / 新任务 / 终审。设计稿，未开工 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 一页一任务、租约、四色、指挥室 |
| [DECISION-POINTS.md](./DECISION-POINTS.md) | 本地判断登记到 #84。新的提前结束、绕过脑、改走向的判断先登记再写代码 |
| [QA-GOLDEN-SCENARIOS.md](./QA-GOLDEN-SCENARIOS.md) | 黄金场景。通过看底账，不看侧栏感觉 |
| [qa-runs/window-qa-20261122.md](./qa-runs/window-qa-20261122.md) | 今天测试窗已经跑过的句子 |
| [SKILL-FORMAT.md](./SKILL-FORMAT.md) | 技能包字段 |

对人、对界面说「技能」，不要说「妙招」。不要改 `docs/listings/`。不要把云端 Key 写进客户端。

## 怎么开测试窗

不要动日常数据 `%APPDATA%\sparo-store`，不要点已经开着的 `Sparo.exe`。

```text
SPARO_CONFIG_DIR = %APPDATA%\sparo-store-test
SPARO_MCP_PORT = 3922
```

在本目录 `npm run start`。主进程不热更，改完 `src/main` 要重启这个测试进程。端口 3921 是日常安装包。Cursor 里的 `user-sparo` 连的是 3921，不能拿来验这批源码。

## 工作区里这次要验的代码

已修改、未提交：

| 文件 | 这次动了什么 |
|---|---|
| `src/main/browser.ts` | 人已在网页上发问不另开百度（#79）；停止记成已停止（#80）；同一账号环境再打开不另开（#81）；多站只各开首页（#82）；人已在该站则留在当前页（#83）；指挥室派出去的最终回复抄回指挥室（#84） |
| `src/main/agent/sidebar-tab.ts` | `visiblePageKeepsTurn`、`sameSiteWork` |
| `src/main/agent/command-room.ts` | 多站「查看数据」每页一句完整任务，不再把站名抠掉 |
| `src/main/agent/free-soul.ts` | 评论/转发走技能；同站不另开；两件都要做完由模型看页面判断。没有按轮数硬停 |
| `src/main/mcp-server.ts` | 带 client 的 `new_tab` 不论有没有 `envId` 都认领给这个 client。人已经打开的页不认领 |
| `src/main/skills/runner.ts` | 技能步骤 `weibo_act`：当前微博页一次写入、点发送、读回 |
| `src/main/skills/weibo-act.ts` | 新文件。微博评论/转发的页面脚本 |
| `strategies/skills/weibo-comment-repost.json` | 新技能。别名含「微博评论」「微博转发」 |
| `strategies/skills/social-media-publish/scripts/page.mjs` | `owner` 为 `user` 的页不再算自己的。默认登录态只复用已经属于这个 client 的页，否则 `new_tab` |
| `strategies/skills/social-media-publish/scripts/publish.mjs` | 上面两条的自检 |
| `strategies/skills/social-media-publish/scripts/adapters/sohu.mjs` | 开页同样传入 stamp |
| `tests/sidebar-tab.test.ts` `tests/command-batch.test.ts` `tests/env-follow.test.ts` `tests/weibo-act.test.ts` | 对应单测 |
| `docs/DECISION-POINTS.md` | #81 至 #84 |
| `CHANGELOG.md` `docs/PRODUCT-TASKBOOK.md` | 版本说明。任务书里的安装包字节数和哈希已过时 |

Trae 实际调用的发布引擎在仓库外，已按同一规则改过：

`C:\Users\60914\.trae-cn\skills\social-media-publish\scripts\`

那份不在 git 里。仓库里的 `strategies/skills/social-media-publish` 才是产品副本。两边自检都跑过 `SELF_CHECK_OK`。正在运行的 Sparo 进程还没有 `new_tab` 认领，不重启测试窗，发稿引擎仍会拒绝 `owner=user` 的新页。

不要拿去 QA、也不要提交的未跟踪文件：`.uploads/`、`_probe_wechat.mjs`、`wx_*.png`、`wxpub*.png`、`发布包/`、`摩点待发货订单-20261118.csv`。

## 设计上这批代码在守什么

- 一页一个任务。页要么是人的，要么归某一个 Agent（`owner` 为 `user` 或 `agent:<clientId>`）。
- 指挥室是总览，不是网页。从指挥室派出去的结果要回到指挥室。一组全部结束才交 HTML。
- 意识决定评哪一条、写什么、发不发。潜意识一次写入并读回。没有微博评论技能时，不要让模型自己循环点发送。
- 外部 Agent 新开的页归它自己。人正在看的编辑页不能被发稿引擎拿去写。
- 登录、验证码、付钱停给人。客服发送只填草稿。发稿看执行模式：逐步确认停一次，自动执行做完再汇报。没说自动发就只填草稿。
- 三通道（门岗 / 无意识 / 有意识 / 新任务）还没做，不要在这轮 QA 里当成已有功能。

## 已经在测试窗看过的

端口 3922、数据目录 `sparo-store-test`。记录在 [qa-runs/window-qa-20261122.md](./qa-runs/window-qa-20261122.md)。

过了的包括：微博页问社会新闻不弹百度；停止后卡片是「已停止·待结束」；「打开微博、知乎、头条和百家号」各一张首页；付款按钮不代点；可丢删除有 7 天提示；指挥室写诗先给思路。

## 这批源码还没在窗口里跑过

下一扇窗口请整批跑，不要只挑一条。跑的是本目录重启后的测试窗，不是 `D:\Program Files\Sparo`。

1. 人已经在微博页，说去汪海林的微博评论并转发：留在当前页，不另开。评论和转发都要在页面上读到，不能只看点击回执。
2. 只说评论、或只说转发：只做那一件。没登录就停在这一页。
3. 指挥室说「打开微博、知乎、头条和百家号，查看数据」：四页各一张，每页一句完整任务，结果出现在指挥室，不编「消息被截断」。某一页没读到要写明。
4. 外部 Agent（带 `x-sparo-client`）调用不带 `envId` 的 `new_tab`：新页 `owner` 是 `agent:` 加这个 client。人已经打开的页仍是 `user`。
5. 发稿引擎在默认登录态：不改写人正在看的编辑页，新开的编辑页 `owner` 是自己的 client。别人的编辑页报 `NO_EDITOR_TAB`，不拿去发。
6. 同一账号环境第二次打开：还是原来那一页，不叠出多张百家号。
7. 百家号图文标题一次写入。上一轮测试窗填出来是 119 字、159 字，不是给定的短标题，草稿数仍是 0。这是已知失败，还没修。
8. 安装包上的 G1、G2、G3 不要在这轮用旧 exe 冒充当前源码。当前源码测完、人点头之后再打包，下一包版本号是 `1.1122.3`。

仍要人在场、不要自己做完的：微信公众号扫码，真人键盘打字时的焦点让开，店小秘图片翻译费用和「保存并认领」。
