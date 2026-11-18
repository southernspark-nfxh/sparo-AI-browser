# Sparo · 独立 Agent 浏览器

*独立 Agent 浏览器 — 自己接单自己干，安全边界内自动完成。*

The work on the web — filling forms, publishing, researching — an Agent can finish it, not just talk about it.

Sparo 有两个定位，缺一不可：

1. **自己就是能独立完成任务的 Agent**：接单、规划、动手、验收、关单。人不用围观、不用逐步点头，它可以最小化在后台跑，不抢屏幕、不抢键盘。
2. **为 Agent 设计的浏览器**：Cursor、Trae、Codex、Hermes、Claude 等任何能调 MCP 的 Agent，都可以操纵同一扇窗口干活。

Sparo is a browser on your Windows PC with an agent built in: it takes a task, plans it, does it, verifies it, and closes it. You don't have to watch. It's also a browser designed *for* agents — any MCP-capable agent (Cursor, Codex, Hermes, Claude…) can drive the same window.

登录和密钥都留在这台电脑。免费可以贴自己的模型 Key；想用云端模型，登录就行。

## 怎么干活 · How it works

**AI 做意识，脚本做潜意识。**

| 角色 | 职责 |
|---|---|
| **意识（AI）** | 判断、决策、认阶段：识别页面在哪一步，点「下一步」或「发布」，卡住换策略，发布前暂停 |
| **潜意识（脚本）** | 执行、投递：一次性注入标题、正文、话题，设封面，读页面状态 |

不逐字打、不循环 fill；脚本跑不动时意识介入；没有现成技能的表单走 `analyze_page → execute_primitives`。

**安全边界**：支付、登录、验证码永远人来；删除放行并留 7 天恢复提示；保存、发送、发布在自动模式直接做，逐步模式确认一次；付费项先报费用等人授权。

## 两大核心能力 · Two flagship abilities

**① 自媒体发稿运营** — 一条命令从草稿到发布：

| 平台 | 说明 |
|---|---|
| 头条号 / 百家号 / 大鱼号 / 搜狐号 | 图文：后台填稿→插图→封面→发布→回读核验 |
| 百家号 | 另支持**视频**发布（上传→账号核验→标题→话题→封面→发布/定时） |
| 微信公众号 | Word 导入 + 统一排版，**只存草稿**，群发由你点 |
| 企鹅号 | docx 导入→标题→分类→标签→存草稿/发布→双核验 |
| 小红书 | 长文：注入标题正文→排版→话题→暂停 |
| 其他站点 | 微博、知乎等 20+ 渠道：复制模板技能即可扩展，或现场 `analyze_page` 通用填发 |

**② 电商页面编辑** — 店小秘采集箱上品前编辑：标题中文→英文、价格公式、重量换算、库存封顶、主图批量改尺寸、图片翻译（先报费用）、保存后回读 6 项核验。交付标准见 [docs/ECOMMERCE-LISTING-NORTH-STAR.md](./docs/ECOMMERCE-LISTING-NORTH-STAR.md)。

日常的活也能一句话交出去：出差、订票比价、调研、租房、挂号——它自己翻页面，多种信息调研出**报告页**在窗口打开。同站点多账号：**设置 → 账号** 建多个环境，Cookie 互不可见，不用来回切登录。

## 安装（两种，选一个） · Install (pick one)

**自己装：** 打开 [官网产品页](https://southernspark.dev/zh/products/sparo)，点「免费下载」，双击 `Sparo-Setup.exe`，装完从桌面打开。

**Install it yourself:** Open the [product page](https://southernspark.dev/products/sparo), click **Download Free**, run `Sparo-Setup.exe`, then open Sparo from the Desktop.

**让 AI 装：** 把下面这段原样复制给你的 Cursor / Claude，它替你下载、安装。

**Let your AI install it:** Paste one of these blocks into Cursor / Claude.

中文：

```text
请帮我安装 Sparo，一款装在 Windows 上的独立 Agent 浏览器。
1. 下载最新安装包：https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe
2. 运行安装包完成安装（用户目录即可，不要改系统盘权限）。
3. 装完从桌面或开始菜单打开 Sparo，不要用 npm run start。
```

English:

```text
Could you install Sparo for me? It's an agent browser for Windows.
1. Download the latest installer: https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe
2. Run the installer (per-user is fine; don't change system permissions).
3. Open Sparo from the Desktop or Start menu. Do not use npm run start.
```

最新安装包直链 · latest installer:

```
https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe
```

完整步骤 · full steps: [docs/INSTALL.md](./docs/INSTALL.md) · [docs/README.en.md](./docs/README.en.md)

## 装好之后 · After install

1. 打开 Sparo，侧栏「设置」里贴上自己的模型 Key，或登录用云端模型（见 [docs/API-KEYS.md](./docs/API-KEYS.md)）  
   Open Sparo. In **Settings**, paste your own model key, or sign in for cloud models ([docs/API-KEYS.md](./docs/API-KEYS.md)).
2. 直接说目标，或点「总结 / 填表 / 回复 / 发布」  
   Just say what you want, or click **Summarize / Fill form / Reply / Publish**.
3. 侧栏支持中文、English、日本語、한국어、Español、Português、Deutsch、Français、Italiano  
   The sidebar speaks those languages too.
4. 执行模式在输入框旁切换：**逐步确认**（发布/发送前停一下）或**自动执行**（干完再汇报）；支付、登录、验证码两种模式都归你  
   Switch execution mode next to the input box; paying, sign-in, and captchas are always yours.

## 让 Agent 控制这扇窗 · Let an agent drive this window

1. 打开 Sparo，保持开着 · Keep Sparo open
2. 点 **复制给 Agent**（程序位置和连接方式在同一段里） · Click **Copy for Agent**
3. 发给你的 Agent，或写入它的本地工具配置 · Paste that into your agent

Agent 先读 **[AGENTS.md](./AGENTS.md)**（30 秒路径），能力全景、工作模式、安全边界看 **[docs/AGENTS.md](./docs/AGENTS.md)**，MCP 工具清单看 [docs/MCP-API.md](./docs/MCP-API.md)。

Start with **[AGENTS.md](./AGENTS.md)**, then **[docs/AGENTS.md](./docs/AGENTS.md)** for the full capability map.

| 文档 · Doc | 用途 · What it's for |
|---|---|
| [AGENTS.md](./AGENTS.md) | Agent 30 秒上手 · agent quick path |
| [docs/AGENTS.md](./docs/AGENTS.md) | 能力全景、意识+潜意识、安全边界 · capability map, work model, safety |
| [docs/MCP-API.md](./docs/MCP-API.md) | MCP 工具清单 · MCP tool reference |
| [docs/PUBLISHING.md](./docs/PUBLISHING.md) | 多平台发布手册 · publishing playbook |
| [docs/PRODUCT.md](./docs/PRODUCT.md) | 卖点、痛点 · product story |
| [docs/CLOUD-SUBSCRIPTION.md](./docs/CLOUD-SUBSCRIPTION.md) | 可选云端模型 · optional cloud models |
| [docs/MULTI-ACCOUNT.md](./docs/MULTI-ACCOUNT.md) | 同站点多账号 · multiple accounts per site |
| [docs/ECOMMERCE-LISTING-NORTH-STAR.md](./docs/ECOMMERCE-LISTING-NORTH-STAR.md) | 电商上品交付标准 · listing standard |
| [docs/PRIVACY.md](./docs/PRIVACY.md) · [docs/PRIVACY.en.md](./docs/PRIVACY.en.md) | 隐私 · privacy |
| [docs/API-KEYS.md](./docs/API-KEYS.md) | 模型密钥 · model keys |
| [CHANGELOG.md](./CHANGELOG.md) | 版本变更 · changelog |
| [docs/PRODUCT-TASKBOOK.md](./docs/PRODUCT-TASKBOOK.md) | 现行任务 · current tasks |
| [STORE.md](./STORE.md) | 发行线 · shipping |
| [docs/STORE-LISTING.md](./docs/STORE-LISTING.md) | 商店短文案 · store blurb |
| [docs/listings/README.md](./docs/listings/README.md) | 按字段粘贴 · store fields |

## 开发 · Develop

```powershell
npm install   # first time only
npm run start
```

打包 Windows 安装包 · build the Windows installer: `npm run dist`（产物在 `release\`）。
