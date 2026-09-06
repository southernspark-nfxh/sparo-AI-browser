# Sparo

网页上的活——填表、回消息、发内容——可以有个 AI 替你干。

The work on the web — filling forms, answering messages, posting — an AI can do it for you.

Sparo 是装在你 Windows 上的浏览器。它就在你正看着的那一页上干活：草稿写进输入框，提交前停下来，等你点发送。登录和密钥都留在这台电脑。免费可以贴自己的模型 Key；想用云端模型，登录就行。

Sparo is a browser on your Windows PC. It works on the page in front of you: drafts go into the box, then it stops and waits for you to click send. Logins and keys stay on this computer. Free with your own model key. Prefer cloud models? Sign in — those keys never land on your PC.

## 安装（两种，选一个） · Install (pick one)

**自己装：** 打开 [官网产品页](https://southernspark.dev/zh/products/sparo)，点「免费下载」，双击 `Sparo-Setup.exe`，装完从桌面打开。

**Install it yourself:** Open the [product page](https://southernspark.dev/products/sparo), click **Download Free**, run `Sparo-Setup.exe`, then open Sparo from the Desktop.

**让 AI 装：** 把下面这段原样复制给你的 Cursor / Claude，它替你下载、安装。

**Let your AI install it:** Paste one of these blocks into Cursor / Claude.

中文：

```text
请帮我安装 Sparo，一款装在 Windows 上的 AI 浏览器。
1. 下载最新安装包：https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe
2. 运行安装包完成安装（用户目录即可，不要改系统盘权限）。
3. 装完从桌面或开始菜单打开 Sparo，不要用 npm run start。
```

English:

```text
Could you install Sparo for me? It's an AI browser for Windows.
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
2. 随便开个网页，点「总结 / 填表 / 回复 / 发布」，或者直接用说的  
   Open any page. Click **Summarize / Fill form / Reply / Publish**, or just say what you want.
3. 侧栏支持中文、English、日本語、한국어、Español、Português、Deutsch、Français、Italiano  
   The sidebar speaks those languages too.

分寸是这样的：AI 写的回复只进输入框；要发布的内容，提交前停下等你确认。付钱、发送，永远你自己点。

The rule is simple: AI drafts go into the input box. Before anything publishes, it stops and waits. Paying and sending — you click.

更大的活也能一句话交给它——安排出差、订票比价、查资料做调研。它会自己翻页面，把结果整理成一份手册给你。

Bigger jobs work the same way: plan a trip, compare tickets, research a topic. It opens the pages and hands you a handbook.

## 让 Agent 控制这扇窗 · Let an agent drive this window

1. 打开 Sparo，保持开着 · Keep Sparo open
2. 点 **复制给 Agent**（程序位置和连接方式在同一段里） · Click **Copy for Agent**
3. 发给你的 Agent，或写入它的本地工具配置 · Paste that into your agent

Agent 先读 **[AGENTS.md](./AGENTS.md)**，再看 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)、[docs/PRODUCT-TASKBOOK.md](./docs/PRODUCT-TASKBOOK.md)、[CHANGELOG.md](./CHANGELOG.md)。

Start with **[AGENTS.md](./AGENTS.md)**.

| 文档 · Doc | 用途 · What it's for |
|---|---|
| [docs/PRODUCT.md](./docs/PRODUCT.md) | 卖点、痛点 · product story |
| [docs/CLOUD-SUBSCRIPTION.md](./docs/CLOUD-SUBSCRIPTION.md) | 可选云端模型 · optional cloud models |
| [docs/PRIVACY.md](./docs/PRIVACY.md) · [docs/PRIVACY.en.md](./docs/PRIVACY.en.md) | 隐私 · privacy |
| [docs/API-KEYS.md](./docs/API-KEYS.md) | 模型密钥 · model keys |
| [STORE.md](./STORE.md) | 发行线 · shipping |
| [docs/STORE-LISTING.md](./docs/STORE-LISTING.md) | 商店短文案 · store blurb |
| [docs/listings/README.md](./docs/listings/README.md) | 按字段粘贴 · store fields |

## 开发 · Develop

```powershell
npm install   # first time only
npm run start
```

打包 Windows 安装包 · build the Windows installer: `npm run dist`（产物在 `release\`）。
