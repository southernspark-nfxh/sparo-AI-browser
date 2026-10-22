# Sparo 阅读助手 · 产品规划书

> 版本：v0.2 · 2026-10-21（Advisor review 后：高亮持久化、intent 路由、MVP 加 MCP notes_list、补标签页生命周期）
> 状态：**规划中**（MVP 目标 v0.2.0）
> 定位：给 Sparo 加一条「AI 辅助阅读 + 私人笔记沉淀」线，不脱离核心「AI 在你看的网页上动手」

---

## 1. 为什么做这条线

Sparo 现在的四件实事——**总结、填表、回复、发布**——覆盖了职场人「动手」的场景。但还有一半时间是「用眼睛看」：

- 刷新闻、看网文、读技术文章
- 微信读书网页版追书
- 调研时开 10 个标签页来回切换
- 看到关键段落想留个记号，下次找不到

**现有浏览器/扩展的问题：**

| 工具 | 优点 | 缺点 |
|---|---|---|
| Edge 沉浸式阅读器 | 微软原生、朗读、语法高亮 | 静态——不会帮你摘重点、不会帮你记 |
| 简悦 SimpRead | 中文阅读模式做得最好、标注+导出全 | 手动高亮、手动整理、没有 AI 大脑 |
| SingleFile / MarkDownload | 一键剪藏、离线可用 | 存了就忘，不会帮你关联和回忆 |
| 印象笔记剪藏 | 云端同步、跨设备 | 要账号、要同步、数据离开本机 |
| Arc Easel | 截图+白板组合 | 已停产 Notes；截图不是正文 |
| 各种高亮扩展 | 选中文本→高亮 | 孤立的点，没有知识链 |

**Sparo 能做什么别人做不到的：**

> 现有工具都是「你手动高亮 → 工具帮你存」。Sparo 是「**AI 主动帮你读、帮你摘、帮你理**」——
> - 你说「把这篇网文换成护眼模式」，它开阅读模式
> - 你说「这段为什么重要」，它读上下文告诉你
> - 你说「保存这段到笔记」，它自动附上出处、关联之前存过的相关段落
> - 你说「把今天读的这 3 篇串起来」，它出一页综述

**核心差异化：AI 辅助阅读 ≠ 又一个阅读模式。**

---

## 2. 竞品对标矩阵

| 能力 | Edge 沉浸式阅读器 | 简悦 SimpRead | SingleFile | 印象笔记剪藏 | Arc | **Sparo 要做的** |
|---|---|---|---|---|---|---|
| 自动提取正文 | ✅ | ✅ 中文最佳 | ❌ 整页保存 | ✅ | ❌ 截图 | ✅ 用 Mozilla Readability |
| 阅读模式（去广告/去导航） | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| 主题/字号/行距 | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ 3 套预设 |
| 大声朗读 | ✅ | ❌ | ❌ | ❌ | ❌ | ⏳ Vision 做 |
| 选中文本高亮 | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ 4 种颜色 |
| 高亮加笔记 | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| 一键保存为 Markdown | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| 离线可用 | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ 数据全在本机 |
| AI 摘要 | ❌ Copilot 要另开 | ❌ | ❌ | ❌ | ❌ | ✅ 侧栏直接说 |
| AI 解释/翻译段落 | ✅ Copilot | ❌ | ❌ | ❌ | ❌ | ✅ 侧栏 |
| AI 跨文章聚合 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **独家差异化** |
| 私人笔记本 | ❌ | ❌ 导出到别处 | ❌ | ✅ 云端 | ❌ 已停产 | ✅ 本地 `sparo-store/notes` |
| 与 Agent/MCP 打通 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **MCP 暴露笔记读写** |

---

## 3. PRD

### 3.1 MVP（v0.2.0）——「让阅读更舒服 + 存住关键内容」

**一句话：** 点一下进入干净的阅读视图，选中文本能高亮+加笔记，一键存成本地 Markdown 文件。

#### 3.1.1 阅读模式（Reader Mode）

| 项 | 说明 |
|---|---|
| 触发 | 侧栏按钮「阅读模式」 / 快捷键 `Ctrl+Shift+R` / 右键菜单「进入阅读模式」 |
| 底层 | `@mozilla/readability`（npm，Firefox 同款）从当前 DOM 提取正文 |
| 渲染 | 在 Sparo 窗口开一个新标签页，复用现有 `readingReportHtml()` 管线 |
| 主题 | 3 套预设：护眼豆沙绿 / 纸张米白 / 夜间黑 |
| 字号 | 14 / 16 / 18 / 20 px 四档 |
| 宽度 | 自动（最大 720px）/ 宽屏（最大 960px） |
| 不做 | 大声朗读、PDF 阅读（Vision 再说） |

#### 3.1.2 高亮与笔记（Highlight & Note）

| 项 | 说明 |
|---|---|
| 触发 | 选中文本 → 浮层工具栏出现 |
| 工具栏 | 4 种颜色高亮（黄/绿/蓝/红）+ 添加笔记 + 复制 + 保存 |
| 数据 | **按 URL 持久化**到 `%APPDATA%\sparo-store\highlights.json`（key = 当前 URL，value = 高亮数组）。刷新、关掉 Sparo 重开，同一 URL 的高亮都会回来。用户主动点「清除高亮」才删。 |
| 格式 | 高亮段落用 HTML `<mark>` 包裹，笔记存 JSON 行内 |
| 导出 | 一键导出为 Markdown：正文 + 高亮摘录 + 笔记 |
| 不做 | 图片高亮、代码段高亮（Vision 再说） |

#### 3.1.3 本地笔记库（Local Notes）

| 项 | 说明 |
|---|---|
| 存储 | `%APPDATA%\sparo-store\notes\` 目录 |
| 结构 | 每篇笔记 = 一个 `.md` 文件 + 一个 `meta.json` 元数据 |
| meta.json | `{ id, title, source_url, saved_at, highlights: [...], tags: [...] }` |
| 侧栏入口 | 侧栏底部「我的笔记」按钮 → 弹出笔记列表 |
| 列表视图 | 卡片式：标题 + 来源域名 + 保存时间 + 标签 chips |
| 笔记详情 | 复用 `readingReportHtml()` 渲染，高亮段落保留颜色 |
| 搜索 | 文件名匹配即可（全文搜索 Vision 再说） |
| 不做 | 文件夹/层级、云同步、多人协作 |

#### 3.1.4 AI伴读模式（两个按钮，两种交互）

**这是 Sparo 阅读器的核心差异化能力。** 两个按钮的交互逻辑完全不同：

##### 按钮1：「AI伴读」开关（toggle mode）

| 项 | 说明 |
|---|---|
| 外观 | 阅读模式页顶部工具栏的一个 toggle 按钮：默认灰色「AI伴读 关」，点亮后蓝色「AI伴读 开」 |
| 打开后行为 | 用户每次划线/框选（mouseup）→ AI 自动总结选中内容 → **先进只读预览区** → 用户点「确认存入」才写入笔记库 |
| AI 做什么 | 取选中文本段 → 调用模型生成「一句话总结」→ 返回预览 |
| 预览区 | 阅读模式页右下角浮出 200px 高的抽屉：上半是选中文本（灰底），下半是 AI 总结，底部三个按钮「存入笔记」「跳过」「再试试」 |
| 自动落盘策略 | **默认用户确认后存。** 不做无声自动写入——这是 AI 输出的红线（经验教训：自动写入用户数据 = 事故） |
| 侧栏反馈 | 每次 AI 总结完，侧栏顶部冒 toast：「已生成总结，点预览区决定是否存入」 |
| 关闭后行为 | toggle 关掉，划线恢复为普通高亮（只上色，不触发 AI） |

**状态机：**
```
[AI伴读 关] ──点击──▶ [AI伴读 开]
    ▲                    │
    │                    │每次划线
    │                    ▼
    │              [AI 总结中...spinner]
    │                    │
    │                    ▼
    │              [预览区浮出]
    │              ┌─用户点「存入」→ 写入 notes → 侧栏 toast 成功
    │              ├─用户点「跳过」→ 高亮保留、不存
    │              └─用户点「再试试」→ 重新调模型
    │
    └──点击（随时可关）──
```

##### 按钮2：「一键盘存」（one-shot action）

| 项 | 说明 |
|---|---|
| 外观 | 阅读模式页顶部工具栏的大按钮：「📚 一键盘存」 |
| 点击后行为 | **三步骤，一次性跑完：** |
| 步骤1 | 调用 AI 总结当前页全文（5 句话 + 核心观点） |
| 步骤2 | 存正文全文到 `notes/{id}.md` |
| 步骤3 | 写读书记录 meta（来源 URL、保存时间、阅读时长估计） |
| 预览区 | 和按钮1复用同一个抽屉：上半是 AI 总结，下半是「将保存：全文 N 字 + 读书记录」 |
| 落盘策略 | 同按钮1——**先进预览区，用户点「确认键存」才写入** |
| 不做 | 不自动给标签（Vision 版本再做） |

**两个按钮的异同：**

| 维度 | 按钮1 AI伴读 | 按钮2 一键盘存 |
|---|---|---|
| 交互模式 | toggle 开关，划线触发 | one-shot，主动点 |
| AI 输入 | 当前选中的一小段 | 当前页全文 |
| AI 输出 | 一句话总结 | 5 句话 + 核心观点 |
| 保存内容 | 选中段 + AI 总结 | 全文 + AI 总结 + 读书记录 meta |
| 阅读节奏 | 边读边记 | 读完了一键存档 |

##### 红线（从经验教训来的）

1. **AI 生成内容永远先进预览区，禁止无声写入用户数据。** 即使用户说了"自动存储"，也要给可见的确认环节
2. **AI 请求失败不阻塞阅读。** 网络/Key 挂了 → toast 提示「AI 暂时不可用，但高亮已保存」，用户继续读
3. **AI 总结失败的段落只存高亮文本本身，不跳过。** 用户划线的核心动作不受 AI 质量影响

#### 3.1.5 侧栏 AI 与阅读模式的联动

| 用户说 | Sparo 做什么 |
|---|---|
| 「把这页换成阅读模式」 | 走阅读模式管线，新开标签 |
| 「打开 AI伴读」 | 等同 toggle 点「AI伴读 开」 |
| 「总结这页 5 句话」 | 调用现有 `summarize` 能力，读 `page_text` |
| 「这段为什么重要」 | 选中文本段作为上下文，调用模型解释 |
| 「翻译这段」 | 选中文本段，模型翻译，结果注回笔记 |
| 「保存这页到笔记」 | 走「一键盘存」管线 |
| 「把刚才那 3 段串起来」 | 取当前 session 内所有高亮，让模型组织成一段综述 |

**关键：** 阅读模式、AI伴读、一键盘存和侧栏 AI 是同一条链路——不是四个独立功能。

#### 3.1.6 MVP 不做的

- ❌ 大声朗读（Vision）
- ❌ PDF 阅读模式（Vision）
- ❌ 图片/代码段高亮（Vision）
- ❌ 跨文章主题聚合（Vision）
- ❌ 云同步（Sparo 坚持数据在本机）
- ❌ 文件夹/多层级组织（MVP 用 tags 扁平管理）
- ❌ 微信读书专属适配（先看通用阅读模式能不能覆盖）
- ❌ 导出到 Notion/印象笔记（MVP 只存本地 Markdown）

---

### 3.2 Vision（v0.3.0+）——「从保存到理解」

**一句话：** AI 帮你把散落的笔记串成知识网络。

| 功能 | 说明 |
|---|---|
| **AI 自动标签** | 保存笔记时，模型建议 3-5 个标签 |
| **跨文章聚合** | 侧栏说「把上周关于 RAG 的 5 篇串起来」→ 出一页综述 |
| **知识卡片** | 模型从多篇笔记中抽出核心概念，生成结构化卡片 |
| **高亮时间线** | 按时间轴看你最近都在关注什么 |
| **遗忘曲线提醒** | 存了 7 天/30 天的笔记，侧栏轻提醒「要不要过一遍」 |
| **大声朗读** | 阅读模式内置 TTS（Electron 可用 Web Speech API） |
| **PDF 阅读模式** | 加载 PDF → 提取文本 → 走同样的高亮+笔记管线 |
| **MCP 暴露笔记** | 给 Cursor/Claude 开放 `notes_read` / `notes_search` / `notes_write` |
| **Agent 自动整理** | 你开着 Sparo 读东西，Agent 在后台帮你做笔记关联 |

---

## 4. 技术方案

### 4.1 架构图

```
┌─────────────────────────────────────────────────┐
│              Sparo 浏览器窗口                      │
│                                                  │
│  ┌──────────┐  ┌────────────┐  ┌──────────────┐ │
│  │ 原始网页   │  │ 阅读模式标签 │  │ 笔记列表面板  │ │
│  │ (pageHole) │  │ (HTML 渲染) │  │ (侧栏弹层)    │ │
│  └────┬─────┘  └──────┬─────┘  └──────┬───────┘ │
│       │               │                │         │
│  page-scripts     report-html.ts   notes/ 目录    │
│  preload 注入    (已有，复用)    (新增写入)       │
│       │               │                         │
│       ▼               ▼                         │
│  ┌────────────────────────────┐                  │
│  │  主进程新增模块               │                  │
│  │  - reader.ts (正文提取)       │                  │
│  │  - notes.ts (笔记读写)        │                  │
│  │  - highlight.ts (高亮数据)    │                  │
│  └────────────────────────────┘                  │
│                                                  │
│  数据层：%APPDATA%\sparo-store\                   │
│  ├─ notes\  (新)                                 │
│  │   ├─ {id}.md                                  │
│  │   └─ {id}.meta.json                           │
│  ├─ notes-index.json (全部笔记索引)               │
│  ├─ highlights.json (按 URL 持久化的高亮数据)     │
│  └─ reader-preferences.json (主题/字号偏好)       │
└─────────────────────────────────────────────────┘
```

### 4.2 依赖清单

```
新增 npm 依赖：
  @mozilla/readability   ^0.5.0   ← Firefox 阅读模式同款正文提取
  turndown               ^1.0.0   ← HTML → Markdown 转换（readability 输出 HTML）

不需要新增：
  markdown-it             ← 已有 markdownToHtml()，足够
  highlight.js            ← MVP 不做代码高亮
  tesseract.js            ← MVP 不做图片 OCR
```

### 4.3 现有代码复用

| 现有模块 | 复用点 | 改什么 |
|---|---|---|
| `report-html.ts` → `readingReportHtml()` | 阅读模式渲染、笔记详情页 | 新增高亮颜色样式、笔记 meta 区 |
| `report-html.ts` → `markdownToHtml()` | Markdown→HTML | 不动，已够用 |
| `page-scripts.ts` | preload 注入脚本 | 新增 `READER_MODE_CSS`、`HIGHLIGHT_INJECT_SCRIPT` |
| `browser.ts` → `webContents` 操作 | 新开阅读模式标签、执行 preload 脚本 | 新增 `openReaderModeTab(url)` |
| `settings/store.ts` | 偏好持久化 | 新增 `reader: { theme, fontSize, width }` |
| `mcp-server.ts` | 对外能力暴露 | MVP 先不暴露，Vision 再加 |

### 4.4 核心管线

#### 4.4.1 进入阅读模式

```text
用户 Ctrl+Shift+R / 侧栏「阅读模式」
  → browser.ts 调用 webContents.executeJavaScript()
  → 注入 Readability.js（从页面 DOM 提取正文 HTML）
  → 返回 { title, content, textContent, byline, siteName }
  → 主进程用 reportHtml.readingReportHtml() 包壳
  → 新开标签页 writeHtmlReport() 写入 %APPDATA%\sparo-store\reports\
  → 聚焦到新标签
```

#### 4.4.2 高亮+笔记

```text
用户在阅读模式页选中文本
  → preload 里的 HIGHLIGHT_INJECT_SCRIPT 监听 mouseup
  → 计算 Selection → 生成唯一 chunk id → 读取 highlights.json 该 URL 的数组 → append → 写回
  → 浮层工具栏出现（4 色高亮 + 加笔记 + 复制 + 保存）
  → 用户点颜色 → 文本包裹 <mark data-chunk-id="xxx" style="background:yellow">
  → 用户点「加笔记」→ 弹出小输入框 → 笔记文本存 <aside data-chunk-id="xxx">
  → 用户点「保存」→ 所有高亮和笔记打包成 JSON → 发 IPC 到主进程
```

#### 4.4.3 保存到本地笔记库

```text
主进程收到高亮数据
  → notes.ts 生成 { id: uuid, title, sourceUrl, savedAt, highlights: [...], tags: [] }
  → notes.ts 用 turndown 把阅读模式 HTML 转 Markdown
  → 写入 %APPDATA%\sparo-store\notes\{id}.md
  → 写入 %APPDATA%\sparo-store\notes\{id}.meta.json
  → 更新 %APPDATA%\sparo-store\notes-index.json（全部笔记索引）
  → 侧栏提示「已保存到笔记库，共 N 篇」
```

### 4.5 notes 目录结构

```
%APPDATA%\sparo-store\notes\
  ├── notes-index.json          ← 所有笔记的 id/title/sourceUrl/savedAt/tags 索引
  ├── abc123.md                 ← Markdown 正文
  ├── abc123.meta.json          ← 元数据
  ├── def456.md
  ├── def456.meta.json
  └── ...
```

**notes-index.json 示例：**

```json
[
  {
    "id": "abc123",
    "kind": "note",
    "title": "RAG 综述：检索增强生成的现状",
    "source_url": "https://arxiv.org/abs/2312.10997",
    "saved_at": "2026-10-21T14:32:00Z",
    "tags": ["AI", "论文", "RAG"],
    "highlight_count": 7
  }
]
```

**abc123.meta.json 示例：**

```json
{
  "id": "abc123",
  "kind": "note",
  "title": "RAG 综述：检索增强生成的现状",
  "source_url": "https://arxiv.org/abs/2312.10997",
  "site_name": "arXiv",
  "saved_at": "2026-10-21T14:32:00Z",
  "highlights": [
    {
      "chunk_id": "h1",
      "color": "yellow",
      "text": "Retrieval-Augmented Generation (RAG) ...",
      "note": "这段话定义了 RAG，后面引用要回到这里"
    }
  ],
  "tags": ["AI", "论文", "RAG"]
}
```

**abc123.md 示例：**

```markdown
# RAG 综述：检索增强生成的现状

> 来源：https://arxiv.org/abs/2312.10997
> 保存于 2026-10-21

## 正文

Retrieval-Augmented Generation (RAG) ...

## 我的高亮与笔记

### 💛 黄色高亮

**Retrieval-Augmented Generation (RAG) ...**

> 📝 这段话定义了 RAG，后面引用要回到这里
```

### 4.6 Intent 路由设计（新增 intent 类型）

现有 `intent-router.ts` 只识别：`travel` / `mission` / `feishu` / `page` / `read` / `llm`。
需要新增三种，防止侧栏口令被 LLM 闲聊路径截胡：

| 新 intent | 触发词示例 | 路由到 |
|---|---|---|
| `reader_mode` | 「阅读模式」「换成阅读模式」「护眼模式」「读这篇」 | `browser.ts.openReaderModeTab(currentUrl)` |
| `notes_action` | 「保存到笔记」「存这页」「加笔记」 | `notes.ts.saveCurrentPage()` |
| `notes_search` | 「笔记里搜」「我的笔记」「列出笔记」 | `notes.ts.list() / notes.ts.search()` |

**路由优先级：** `reader_mode` / `notes_*` 在 `page` / `llm` 之前检查。
避免用户说「把这页换成阅读模式」被 `page_text` 截成「读这页内容」。

```
intent-router.ts 路由顺序：
  1. feishu（最高优先级，带上下文）
  2. travel / trip-plan（带城市/日期槽位）
  3. mission（比价/调研等）
  4. ★ reader_mode（新增：关键词匹配）
  5. ★ notes_action / notes_search（新增：关键词匹配）
  6. leftover（打开 URL + 后半句）
  7. page / read（读页/总结）
  8. llm（兜底闲聊）
```

**识别方式：** 先用关键词正则匹配（快速、低成本），匹配不到再让模型判断。
关键词表：`阅读模式|护眼|reader|笔记|note|高亮|保存这页|存这页`。

### 4.7 阅读模式标签页生命周期

| 场景 | 行为 |
|---|---|
| 用户从原始页 Ctrl+Shift+R | **新开一个阅读模式标签**，原标签保留不关闭。两个标签可以互相切换 |
| 用户在阅读模式标签里点外部链接 | 在**新标签**打开（target=_blank），不替换阅读模式 |
| 用户关闭阅读模式标签 | 仅关闭阅读模式渲染，原始页不受影响。**但高亮数据已经持久化**，下次再对同一 URL 开阅读模式会回来 |
| 用户从侧栏「笔记列表」点开一篇笔记 | 新开一个**笔记详情标签**，复用 `readingReportHtml()` 渲染 |
| 多个阅读模式标签并存 | 每个标签页独立注入 preload 脚本，各自维护自己的高亮状态。`highlights.json` 以 URL 为 key，不会互相污染 |

**为什么新开标签而不是替换原始页？** 用户可能需要在原始页和阅读模式之间对照，替换会破坏他的浏览流程。成本只是多一个标签，收益是零干扰。

### 4.8 MCP 工具暴露（MVP 就做）

Sparo 现有卖点是「Agent 也能开这扇窗」。笔记数据已经是本地 JSON，暴露给 MCP 成本极低，但让 Sparo 在 Agent 生态里比简悦/SingleFile 价值高一个维度。

**MVP 暴露 1 个只读工具：**

| 工具名 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `notes_list` | `{ limit?: number, tag?: string, search?: string }` | 笔记索引数组（id/title/sourceUrl/savedAt/tags/highlightCount） | Cursor/Claude 可以读到你存的笔记 |

**Vision 再加 2 个：**

| 工具名 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `notes_read` | `{ id: string }` | 完整 meta.json + Markdown 正文 | 读单篇笔记全文 |
| `notes_write` | `{ title, sourceUrl, highlights, tags }` | 新笔记 id | Agent 帮你自动整理笔记 |

**技术实现：** `mcp-server.ts` 里已有 `tools/index.ts` 表，加 1 行映射到 `notes.ts.list()` 即可。

---

## 5. 侧栏入口设计

### 5.1 侧栏按钮区（新增）

```
┌─────────────────────────┐
│  Sparo                    │
├─────────────────────────┤
│  总结  填表  回复  发布    │  ← 现有四个动作
│                           │
│  ───── 阅读 ─────         │  ← 新分组
│  [阅读模式] [保存到笔记]   │
│                           │
│  ───── 我的笔记 ─────     │  ← 新分组
│  📋 笔记列表              │
│  🔍 在笔记里搜             │
│                           │
├─────────────────────────┤
│  [设置] [复制给 Agent]     │
└─────────────────────────┘
```

### 5.2 侧栏口令示例

```
把这页换成阅读模式
总结这页 5 句话
这段为什么重要            ← 先选中文本，再发口令
翻译这段                  ← 同上
保存这页到笔记
把我上周关于 RAG 的笔记串起来
在我的笔记里搜"向量数据库"
列出最近保存的 10 篇
```

---

## 6. 验收清单（MVP）

### 6.1 阅读模式

| # | 场景 | 预期 |
|---|---|---|
| R1 | 打开知乎文章 → Ctrl+Shift+R | 进入干净阅读视图，无侧边栏/推荐 |
| R2 | 打开微信读书网页版章节 → 阅读模式 | 同上；若 Readability 提取失败，降级为聚焦模式（只高亮正文区） |
| R3 | 打开 news.ycombinator.com → 阅读模式 | 提取正文成功，评论区被裁掉 |
| R4 | 切换主题：护眼/米白/夜间 | 即时切换，偏好存 settings |
| R5 | 切换字号 14→20→16 | 即时切换，偏好存 settings |
| R6 | 刷新阅读模式标签 | **高亮保留**（已持久化到 highlights.json，按 URL 取回）。换不同 URL 的标签则显示该 URL 的高亮或空 |

### 6.2 高亮与笔记

| # | 场景 | 预期 |
|---|---|---|
| H1 | 阅读模式页选中文本 → 点黄色高亮 | 文本变黄底，刷新后丢失 |
| H2 | 同一段再选 → 点绿色高亮 | 只保留最后一种颜色 |
| H3 | 选中 → 加笔记 → 输入框填完回车 | 笔记存到 chunk，显示在对应段落下方 |
| H4 | 多选几段 → 保存到笔记库 | 主进程收到所有高亮和笔记，写入 notes 目录 |

### 6.3 笔记库

| # | 场景 | 预期 |
|---|---|---|
| N1 | 保存后侧栏「笔记列表」 | 新笔记出现在列表顶部，显示标题+来源+时间 |
| N2 | 点笔记卡片 | 新开标签页走 readingReportHtml 渲染，高亮保留颜色 |
| N3 | 关掉 Sparo 重开 | 笔记列表数据从 notes-index.json 恢复，不丢 |
| N4 | 保存 10 篇后 notes-index.json | 数组长度 = 10，每条有 id/title/sourceUrl/savedAt/tags |
| N5 | 删笔记（侧栏弹层里右键） | .md + .meta.json 都删，index 同步 |

### 6.4 侧栏 AI 联动

| # | 口令 | 预期 |
|---|---|---|
| A1 | 「把这页换成阅读模式」 | 触发阅读模式管线 |
| A2 | 「总结这页 5 句话」 | 走现有 summarize 能力，读 page_text |
| A3 | 「保存这页到笔记」 | 走保存管线，写入 notes |
| A4 | 「在我的笔记里搜 RAG」 | 主进程读 notes-index.json，匹配 tags/title |
| A5 | 「列出最近保存的 10 篇」 | 按 saved_at 倒序返回前 10 |

### 6.5 不回归

| # | 场景 | 预期 |
|---|---|---|
| X1 | 出行/比价/调研手册 | 不受影响，report-html.ts 的 tripReportHtml/researchReportHtml 继续正常 |
| X2 | 填表/回复/发布四件事 | 不受影响 |
| X3 | 云订阅 | 不受影响 |
| X4 | Agent MCP 连接 | 不受影响 |

---

## 7. 与 AGENTS.md 红线的关系

| 红线 | 本功能是否触碰 | 说明 |
|---|---|---|
| 不替用户运营、不做人设矩阵 | ❌ | 阅读器是单人本地使用 |
| 数据在本机 `%APPDATA%\sparo-store` | ✅ | 新增 `notes\` 子目录，遵守 |
| 不把云端 Key 写进客户端 | ❌ | 笔记数据不走云端，不涉及 |
| 不自动点发送/付钱/提交 | ❌ | 保存笔记不是危险动作；侧栏 AI 说「保存」就是写入文件 |
| 先 QA 再让人验收 | ✅ | 上面验收清单就是 QA 底线 |
| 改完先自己点通按钮 | ✅ | 侧栏按钮必须自己点通 |

---

## 8. 后续迭代路线图

| 版本 | 功能 | 依赖 |
|---|---|---|
| **v0.2.0（MVP）** | 阅读模式 + 高亮+笔记（持久化）+ 本地笔记库 + 侧栏联动 + **MCP notes_list（只读）** + intent 路由新增 | `@mozilla/readability` + `turndown` + preload 脚本 + intent-router 扩展 |
| v0.2.5 | AI 自动标签 + 笔记内全文搜索 | 模型 + `notes-index.json` 扩展 |
| v0.3.0 | 跨文章聚合综述 + 大声朗读（Web Speech API）+ PDF 支持 | 模型 + Electron 原生能力 |
| v0.3.5 | **MCP notes_read / notes_write** + Agent 自动整理（Agent 可以帮你写笔记了） | mcp-server.ts 新增 tools + Agent 能力 |
| v0.4.0 | 微信读书专属适配 + 网页小说站（起点/晋江）适配 | 目标站点的 Readability 选择器调优 |
| **暂缓** | 云同步、多人协作、印象笔记/Notion 导出、图片 OCR、代码高亮 | 等 MVP 用户反馈 |

---

## 9. 风险和对策

| 风险 | 概率 | 对策 |
|---|---|---|
| Readability 对某些站点提取失败（比如微信读书 SPA） | 高 | 降级为「聚焦模式」：不提取正文，只是把非正文元素隐藏（display:none），保留页面原貌 |
| 高亮层和页面自身样式冲突 | 中 | 高亮样式全部用 inline style + `!important`，且限定在 preload 注入的作用域内 |
| 笔记数据量大会不会卡 | 低 | MVP 用 JSON 文件索引；1000 篇以内没问题；如果要做全文搜索再考虑 SQLite |
| 用户不知道有这个功能 | 中 | 第一次打开 Sparo 时，在欢迎卡里加「试试把网页换成阅读模式」引导卡 |
| 和简悦/SingleFile 功能重叠会不会被问「为什么不用简悦」 | 必然 | 答案：简悦是工具，Sparo 是带 AI 的助手——你要的不是一个更好的阅读模式，是一个能**帮你读、帮你记、帮你串**的 AI |
