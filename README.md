# Sparo

网页上的活——填表、回消息、发内容——可以有个 AI 替你干。

Sparo 是装在你 Windows 上的浏览器。它就在你正看着的那一页上干活：草稿写进输入框，提交前停下来，等你点发送。登录和密钥都留在这台电脑。免费可以贴自己的模型 Key；想用云端模型，登录就行。

## 安装（两种，选一个）

**自己装：** 打开 [官网产品页](https://southernspark.dev/zh/products/sparo)，点「免费下载」，双击 `Sparo-Setup.exe`，装完从桌面打开。

**让 AI 装：** 把下面这段原样复制给你的 Cursor / Claude，它替你下载、安装：

```text
请帮我安装 Sparo，一款装在 Windows 上的 AI 浏览器。
1. 下载最新安装包：https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe
2. 运行安装包完成安装（用户目录即可，不要改系统盘权限）。
3. 装完从桌面或开始菜单打开 Sparo，不要用 npm run start。
```

最新安装包直链：

```
https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe
```

完整步骤：[docs/INSTALL.md](./docs/INSTALL.md)

## 装好之后

1. 打开 Sparo，侧栏「设置」里贴上自己的模型 Key，或登录用云端模型（见 [docs/API-KEYS.md](./docs/API-KEYS.md)）
2. 随便开个网页，点「总结 / 填表 / 回复 / 发布」，或者直接用说的
3. 侧栏支持中文、English、日本語、한국어、Español、Português、Deutsch、Français、Italiano

分寸是这样的：AI 写的回复只进输入框；要发布的内容，提交前停下等你确认。付钱、发送，永远你自己点。

更大的活也能一句话交给它——安排出差、订票比价、查资料做调研。它会自己翻页面，把结果整理成一份手册给你。

## 让 Agent 控制这扇窗

1. 打开 Sparo，保持开着
2. 点 **复制给 Agent**（程序位置和连接方式在同一段里）
3. 发给你的 Agent，或写入它的本地工具配置

Agent 先读 **[AGENTS.md](./AGENTS.md)**，再看 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)、[docs/PRODUCT-TASKBOOK.md](./docs/PRODUCT-TASKBOOK.md)、[CHANGELOG.md](./CHANGELOG.md)。

| 文档 | 用途 |
|---|---|
| [docs/PRODUCT.md](./docs/PRODUCT.md) | 卖点、痛点、不做什么 |
| [docs/CLOUD-SUBSCRIPTION.md](./docs/CLOUD-SUBSCRIPTION.md) | 可选云端模型（M1） |
| [docs/PRIVACY.md](./docs/PRIVACY.md) · [docs/PRIVACY.en.md](./docs/PRIVACY.en.md) | 隐私政策 |
| [docs/API-KEYS.md](./docs/API-KEYS.md) | 模型密钥（国内 / 海外 / 本机） |
| [STORE.md](./STORE.md) | 发行线与打包 |
| [docs/STORE-LISTING.md](./docs/STORE-LISTING.md) | 商店短文案 |
| [docs/listings/README.md](./docs/listings/README.md) | 按字段粘贴（提审前会另改一轮） |

## 开发

```powershell
npm install   # 仅首次
npm run start
```

打包 Windows 安装包：`npm run dist`，产物在 `release\`。
