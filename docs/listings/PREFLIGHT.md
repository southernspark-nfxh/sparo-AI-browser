# 上架前最后准备 · Preflight

商店文案已按字段写在本目录。这里是**提交按钮之前**还要做的事。不要把内部原版（店小蜜 / 指纹线）打进商店包。

## 1. 构建与文件名

在本仓库根目录：

```powershell
npm run dist
```

产物（英文文件名，给 Microsoft / itch）：

| 文件 | 用途 |
|---|---|
| `release\Sparo-Setup.exe` | 安装包（开始菜单 + 桌面快捷方式名仍是 Sparo） |
| `release\Sparo-Portable.exe` | 便携版 |

国内口播仍可叫「安装包 / 便携版」，文件名用上面两个。

当前 `electron-builder.yml`：`signAndEditExecutable: false`。Microsoft 对 EXE/MSI 的签名与安装体验以 Partner Center 当时文档为准；未签名包可能只能走 itch / 自有分发，不能假设一定能进微软商店。

## 2. 隐私政策 URL（微软几乎必填）

1. 把 [privacy.html](./privacy.html) 放到 GitHub Pages、自有域名或任意 HTTPS。  
2. 用浏览器打开，确认中英两段都能读。  
3. 把 **https://…** 完整地址填进 Partner Center 隐私策略，itch 外链也可贴同一页。

仓库里的 Markdown 不能当商店 URL，除非你用 Pages 把 md 渲成网页。

## 3. 截图（两套语言）

见 [screenshots.md](./screenshots.md)。

- zh-CN 商店页：界面语言 **中文**  
- en-US / itch：设置 → Language → **English**，再拍  

微软桌面图：PNG，**≥ 1366×768**。itch 封面：**630×500**。

## 4. 英文界面自检（拍 en 图之前）

1. 打开 Sparo → Settings → Language → English。  
2. 侧栏应为 Summarize / Fill form / Reply / Publish，主按钮 **Let it act**。  
3. 点 Reply，忙碌时应显示 **Drafting…** 而不是「起草中…」。  
4. 未填 Key 时聊天提示应为英文（No API key…）。  
5. 总结一页，摘要语言应跟界面走英文（已设 English 时）。

## 5. 各店勾选（防拒审）

| 项 | 正确 | 不要 |
|---|---|---|
| 分类 | 效率 / Productivity / itch Other+tool | 游戏、Xbox、营销机器人 |
| 自动化 | 半自动、人点发送 | 无人值守全自动发帖 |
| 会员 | 不卖会员，自备 Key | 应用内订阅模型额度 |
| 指纹 / 店小蜜 | 本包没有 | 和原版 Sparo 混打 |
| itch AI 声明 | 用户自备模型才会调用生成式 AI | 声称整包素材是 AI 生成（除非真是） |
| What’s new | 首发留空 | 把功能简介误贴进 What’s new |

## 6. 应用身份（不要改乱）

| | 值 |
|---|---|
| 产品名 | Sparo |
| appId | `com.sparo.work-browser` |
| 数据目录 | `%APPDATA%\sparo-store` |
| MCP | `127.0.0.1:3921`（给本机 Agent，不是上架卖点正文） |

任务栏图标应是四角星 ICO，不是 Electron 原子。若仍显示旧图标：从任务栏取消固定后再打开。

## 7. 建议提交顺序

1. 隐私页上线  
2. 中英各 4 张截图 + itch 封面  
3. itch 草稿页（可先收钱或先免费试水）  
4. Microsoft：年龄分级问卷 → 商店列表 zh-CN + en-US → 安装包（签名问题未解决就先不要点提交）  

Steam 不要排进这条线。
