# Sparo

**会动手的 AI 浏览器。** 打开网页，AI 帮你填、帮你回、帮你发；发送前你确认。

聊天 AI 只能告诉你怎么填。Sparo 在你看着的那一页上动手——登录还是你的，窗口还是你的。免费永远自备 Key；云端模型可选，密钥不进电脑。

## 安装（两种）

| 方式 | 给谁 | 怎么做 |
|---|---|---|
| **官网直接下载** | 人 | 打开 [产品页](https://southernspark.dev/zh/products/sparo) 点「免费下载」，双击 `Sparo-Setup.exe` |
| **复制给 AI** | Cursor / Claude 等 | 把 [docs/INSTALL.md](./docs/INSTALL.md) 里的安装段贴给 Agent，让它下载并跑安装包 |

GitHub 最新安装包：

```
https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe
```

完整步骤：[docs/INSTALL.md](./docs/INSTALL.md)

## 人怎么用

1. 双击安装包（开发可 `npm run start`）
2. 侧栏 **设置** 贴自己的模型 Key，或登录体验云端模型（见 [docs/API-KEYS.md](./docs/API-KEYS.md)）
3. 打开网页，点 **总结 / 填表 / 回复 / 发布**，或直接说话。侧栏可切换中 / 英 / 日 / 韩 / 西 / 葡 / 德 / 法 / 意。

回复只填进输入框，发帖在提交前暂停。发送请你自己点。  
侧栏也可以一句话说完出差、订票、比价、调研，打开结果页后出手册；付钱仍是你点。

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
