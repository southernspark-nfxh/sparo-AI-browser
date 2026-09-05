# Microsoft Store · 简体中文（zh-CN）

Partner Center → 产品 → **商店列表**。MSI/EXE 与 MSIX 字段略有差别；下列按 [MSI/EXE 商店列表](https://learn.microsoft.com/zh-cn/windows/apps/publish/publish-your-app/msix/msi-exe/create-a-new-msi-submission) 可粘贴。**每个语言各填一页**（至少 zh-CN 与 en-US）。

描述与功能要点：**纯文本**。描述里不要贴网址、不要 HTML。功能要点不要自己加项目符号，商店会加圆点。

首次提交：**新增内容（What’s new）留空**。

---

## 属性（Properties，不随语言重复填）

| 字段 | 填写 |
|---|---|
| 产品名称 | Sparo |
| 包 / 安装程序显示名 | Sparo |
| 发布者显示名称 | 与开发者帐户一致 |
| 类别 | 效率（Productivity）→ 效率类应用 |
| 设备系列 | 仅 Windows 桌面。不要勾 Xbox / HoloLens / 手机 |
| 年龄分级问卷 | 生产力工具；无用户生成内容托管；无暴力；可访问互联网（用户自选的模型 API） |
| 隐私策略 URL | 先把 [privacy.html](./privacy.html) 或 [PRIVACY.md](../PRIVACY.md) 放到可公网 HTTPS，再粘完整 URL |
| 支持 / 网站 | 可选。有主页再填。描述正文里不要写 URL |
| 系统 | Windows 10 版本 1809 及以上 / Windows 11；x64 |
| 签名 | 当前构建 `signAndEditExecutable: false`。商店 EXE 提交通常仍要按 Partner Center 对安装包的要求准备（见 PREFLIGHT） |

---

## 商店列表名称

| 字段 | 限制 | 文案 |
|---|---|---|
| 产品名称 | 跟属性走 | Sparo |
| 简称 Short title | 50 | 会动手的 AI 浏览器 |
| 排序标题 Sort title | 255 | Sparo 会动手的 AI 浏览器 |
| 语音标题 Voice title | 255 | Sparo 会动手的 AI 浏览器 |

---

## 简短说明 Short description

限制：1000。卡片上常被截到约 **270**，请用下面这一段（约 120 字）。

```
Sparo 是装在电脑上的浏览器。AI 在你正在看的网页上总结、填表、起草回复、走发布步骤。回复只写进输入框，发帖在提交前停下，发送仍由你点。登录和密钥留在这台电脑。自备 DeepSeek、OpenAI 或兼容接口的 Key，不卖会员。
```

---

## 说明 Description（必填）

限制：10000。纯文本，无链接。

```
Sparo 是会动手的 AI 浏览器。

别人家的 AI 把答案停在对话框里，填表、回客服、发帖还得你自己抄回网页。Sparo 反过来：它动的就是你眼前这一页。登录还是你的登录，窗口还是你的窗口。

四个日常动作：

总结这一页。
填表（提交前停下）。
回复客服或评论（只填草稿，你点发送）。
发布内容（提交前暂停）。

它不替你点发送，也不把账号交给云浏览器。模型费用走你自己的 API Key：DeepSeek、OpenAI，以及通义、Kimi、智谱、硅基流动、OpenRouter、Groq、本机 Ollama 等 OpenAI 兼容接口。不支持 Anthropic 或 Gemini 的原生协议，请用它们的 OpenAI 兼容网关。

已经在用 Cursor 或 Claude 的人，可以在设置里点「复制给 Agent」，让同一个窗口给本地 Agent 当手。没装那些软件也可以：人在侧栏说话，Sparo 一样动手。

数据写在这台电脑。没有账号系统，没有云同步会员。

不做什么：不做人设矩阵、不做指纹多开、不承诺无人值守全自动发帖。
```

---

## 新增内容 What’s new

限制：1500。**第一次上架留空。** 以后发版再贴，例如：

```
界面可切换中英日韩等语言。兼容接口可一键填入常用网关。发送前确认的半自动逻辑不变。
```

---

## 产品功能 Product features

最多 20 条，每条 200。不要以「·」「-」开头。

```
人机同窗：AI 操作当前页，你看得见、停得下
总结、填表、回复、发布四个动作
回复只填草稿，发送由你在网页上点
发帖与填表在提交前暂停
自备 API Key，不卖会员、不代扣模型费
默认 DeepSeek，也可填 OpenAI
兼容通义、Kimi、智谱、硅基流动、火山方舟、OpenRouter、Groq、本机 Ollama
界面语言：中文、英语、日语、韩语、西语、葡语、德语、法语、意大利语
设置里一键「复制给 Agent」，安装包和便携版都是真实程序位置
登录、Cookie、密钥只留在这台电脑
提供安装包与便携版
```

---

## 搜索字词 Search terms

每条建议不超过 30 个字符，大约 7 条。

```
AI浏览器
填表
客服回复
半自动
DeepSeek
OpenAI
人机同窗
```

---

## 屏幕截图

至少 1 张 PNG，建议 4 张以上。桌面：**1366×768 或更大**，最大 50 MB。MSI/EXE 最多约 10 张。说明见 [screenshots.md](./screenshots.md)。

中文列表用中文界面截图。英文列表用 English 界面另截一套（Partner Center 按语言分开传）。

建议文件名：

- `ms-zh-01-chat.png` 打开网页 + 右侧对话，四个动作可见  
- `ms-zh-02-settings.png` 设置里贴 Key、选品牌或网关  
- `ms-zh-03-draft.png` 回复草稿已在页面输入框，发送未替你点  
- `ms-zh-04-agent.png` 设置里「复制给 Agent」
