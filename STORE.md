# Sparo 发行说明

这是面向应用商店与官网的 **Sparo** 源码。免费永远自备 Key；订阅是可选云端模型，Key 不进电脑。

产品文案：[docs/PRODUCT.md](./docs/PRODUCT.md)  
安装：[docs/INSTALL.md](./docs/INSTALL.md)  
上架短文案：[docs/STORE-LISTING.md](./docs/STORE-LISTING.md)  
按商店字段粘贴：[docs/listings/README.md](./docs/listings/README.md)（**提审前另改一轮**，本目录仍可能写着旧叙事）  
隐私：[docs/PRIVACY.md](./docs/PRIVACY.md) · [docs/PRIVACY.en.md](./docs/PRIVACY.en.md)  
API Key：[docs/API-KEYS.md](./docs/API-KEYS.md)  
云订阅 M1：[docs/CLOUD-SUBSCRIPTION.md](./docs/CLOUD-SUBSCRIPTION.md)

| | 本仓库（公开产品） |
|---|---|
| 给谁 | 职场用户；也可给 Cursor / Claude 当本机浏览器手 |
| 卖什么 | 软件 + 可选云端模型（Key 不进电脑）；商店内零支付 |
| 数据目录 | `%APPDATA%\sparo-store` |
| MCP 端口 | **3921** |
| 首页动作 | 总结 · 填表 · 回复 · 发布 |
| 接 Agent | 侧栏 **复制给 Agent** |

界面不出现指纹多开 / 店小蜜代运营。

## 用户怎么打开

命令行不是给用户的。用户双击 `Sparo-Setup.exe`，然后从桌面或开始菜单点 Sparo。也可以双击 `Sparo-Portable.exe`。

开发者打包：`npm run dist`，产物在 `release\`。

## 产品一句话

打开网页，AI 帮你填、帮你回、帮你发。发送前你确认。  
一句话也能办出差、订票、比价、调研：打开结果页，侧栏出手册。

## 启动（开发）

```powershell
npm install   # 仅首次
npm run start
```

侧栏设置里贴 DeepSeek / OpenAI 兼容 Key，或登录体验云端模型。
