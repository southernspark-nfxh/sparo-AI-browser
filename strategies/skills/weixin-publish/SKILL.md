---
name: weixin-publish
description: 通过本机 Sparo 浏览器 MCP 通道后台发布到微信公众号（八万里纵横账号）。默认「Word 导入 → 统一排版 → 封面 → 存草稿」，0 图 / 1 图 / 多图都走同一条链路，排版按正规公众号规范（正文 15px/1.75、H2 主色竖条、引用浅灰底、图片整宽圆角）。2026-11-16 三条流程端到端实测通过。Use when the user asks to publish / 发稿 / 存草稿 / 群发 to 微信公众号 / 公众号 / 微信 / 八万里纵横. Requires Sparo running with logged-in mp.weixin.qq.com session.
---

# 微信公众号发布（八万里纵横 · Sparo MCP）

统一入口复用 `social-media-publish` 技能的 `scripts/publish.mjs`，加 `--platform weixin`。

## 一条命令

```powershell
# 探测（不填内容，只验证 openBlank）
node publish.mjs --platform weixin --probe

# 完整链路（默认：Word 导入 → 统一排版 → 写标题 → 封面 → 存草稿）
node publish.mjs --platform weixin --article "<目录>"

# 换排版主题：editorial（默认，深蓝主色）/ ink（纯墨色）/ green（微信绿）
node publish.mjs --platform weixin --article "<目录>" --theme ink

# 只带 1 张图（多图目录里挑第一张）
node publish.mjs --platform weixin --article "<目录>" --images 1

# 关掉 Word 导入，改回直填正文（不推荐，直填路径没有正文插图）
node publish.mjs --platform weixin --article "<目录>" --no-docx

# 续跑（从 setCover 步骤继续，不重写标题正文）
node publish.mjs --platform weixin --article "<目录>" --from setCover

# dry-run（填到选项就停，不点发布）
node publish.mjs --platform weixin --article "<目录>" --dry-run
```

文章目录必须包含 `title.txt`、`body.md`，可选 `cover.jpg` 和 `images/`。

## 铁律

1. **群发发表必须人工兜底**（不可逆操作，当前 adapter 只做存草稿）
2. 存草稿也不丢：先存草稿，人工确认后再点发表
3. 验证码 / 滑块 / 短信验证 → 立即停手，交用户
4. 标题硬上限 64 字（微信公众号系统限制），超过会直接 FAIL

## 已跑通

| 环节 | 方式 |
|---|---|
| **开编辑器** | 复用已登录公众号 tab 的 `token`，直接 navigate 到 `appmsg_edit_v2&isNew=1`（不再点首页菜单）；没有带 token 的 tab 才退回首页点击 |
| **写标题** | `.ProseMirror[data-placeholder="请在这里输入标题"]` → focus → selectAll → delete → execCommand('insertText')，回读 innerText 比对 |
| **写正文** | `.rich_media_content .ProseMirror` → focus → selectAll → delete → execCommand('insertHTML', html)，回读 innerText 长度 |
| **文档导入** | `#js_import_file`（顶部「导入」）→ `.import-file-dialog` 文件框 → Sparo upload 生成的 docx → 等对话框关闭且正文有字（单次 5-8 秒）|
| **统一排版** | `formatBody`：读回正文结构 → 重建带内联样式的 HTML → `formatBlock('p')` + 全选 + `insertHTML` 覆盖；存草稿后样式仍在 |
| **上传封面** | 10 步链路，见下节「封面完整链路」 |
| **存草稿** | `#js_submit.click()`（JS click）→ 轮询 URL 变带 `appmsgid=` |
| **核验** | 回读 `#js_cover_area .js_cover_preview_new` 的 background-image 含 `mmbiz.qpic.cn`；再回读正文长度、正文真实图片数、首段字号、H2 竖条 |

端到端实测：单次 25-60 秒（导入 5-8 秒、排版 1-2 秒、封面 6-12 秒）。2026-11-16 三条流程全绿：

| 场景 | appmsgid | 结果 |
|---|---|---|
| 多图（3 张插图） | 100001881 | 正文 383 字 / 3 图 / mso 残留 0 / 封面在 / `VERIFY_OK` |
| 单图（1 张插图） | 100001886 | 正文 401 字 / 1 图 / 样式保存后仍在 / `VERIFY_OK` |
| 零图（纯文字） | 100001874 | 正文 401 字 / 0 图 / `VERIFY_OK` |

## 文档导入（默认路径，2026-11-16 实测通过）

`scripts/docx.mjs` 零依赖生成 .docx（`zlib.deflateRawSync` + 手写 CRC32 + 最小 OOXML），把标题、段落、插图一次打进文档；`importDocx(ctx)` 负责导入。

```text
1. 微信默认 forceDocx：0 图 / 1 图 / 多图全部 mode=docx（--no-docx 才关）
   --images N 可只带前 N 张；其它平台仍按「≥3 张 + --docx-import」触发
2. 生成 docx 到 %TEMP%\sparo-docx-*\，文件名就用标题（微信拿文件名当标题）
3. JS click '#js_import_file' → 等 .import-file-dialog 出现
4. 文件框打 id → Sparo upload → 等「对话框关闭 + 正文 >20 字」
5. 顺序：importDocx → formatBody（统一排版）→ fillTitle（覆盖文件名）→ setCover
6. verify 回读：正文长度、真实图片数、首段字号、H2 竖条、封面 background-image
```

**四条必须记住的坑：**

| 坑 | 现象 | 解法 |
|---|---|---|
| 微信 handler 立刻清空 `input.files` | 上传后读 files=0，以为没挂上，其实已在导入 | 只以「对话框关闭 + 正文有字」判定，别用 files.length |
| 导入按钮点击后面板还在动画 | 立刻 upload 可能不生效，90 秒空等 | 先等 800ms，再上传；20 秒没落稿就用新 id 重传（最多 3 次）|
| 导入后标题是文件名 | 标题与本意可能差一个字 | importDocx 之后必须再跑 fillTitle |
| 导入会覆盖全文 | 先导入再续写会把内容冲掉 | docx 模式下 docxImport 顶掉 fillBody + insertImages，不要混用 |

## 排版（formatBody：默认对微信生效）

**为什么单独做：** Word 导入会把样式带成一堆 `mso-*` 内联 CSS，正文默认 18pt、段落挤在一起，直接发出去不好看。`formatBody` 把导入结果重新排成正规公众号版式。

### 版式规范（照正规公众号文章）

| 元素 | 规格 |
|---|---|
| 正文 | 15px / 行高 1.75 / 段后 20px / `#3f3f3f` / 字距 0.5px / 两端对齐 |
| 一级标题 H1 | 22px 加粗 `#1a1a1a`，上 36px 下 18px |
| 二级标题 H2 | 18px 加粗 `#1a1a1a` + **左侧 4px 主色竖条**，上 32px 下 16px |
| 三级标题 H3 | 16px 加粗主色，上 26px 下 12px |
| 列表段 | 识别 `• · ▪ ◦ - 1. 2、` 前缀，左缩进 20px，段距 8px |
| 引用 | 浅灰底 `#f7f7f7` + 左侧 3px 灰竖线 + 右圆角 6px + 字色 `#666` |
| 图片 | 宽 100%、高 auto、居中、上下 18px、圆角 8px |
| 分割线 | 1px `#e6e6e6`，上下 28px |
| 强调 | `strong/b` 加粗 `#1a1a1a`；`code` 浅灰底小圆角 |
| 主色 | 一套主题最多 2-3 种颜色（默认深蓝 `#0F4C81`） |

**正规公众号文章的排版习惯（写 body.md 时就照着来）：**

- 段与段之间靠 `margin` 留白（20px），**不用空段落**撑距离
- 一段 2-4 行；长段落拆成两三段，手机屏读起来才不压抑
- 标题前留更大间距（32px），标题和正文之间 16px，层级一眼分明
- 图片整宽、居中、不加边框；同一篇里图片比例尽量一致
- 重点只加粗、不换色；全文主色不超过 2 种，链接和强调都用主色
- 引用块只放金句 / 关键数据，一段最多一个
- 列表用 `• ` 或 `1. ` 开头，一项一行，别把长句塞进列表

### 三个可切换主题（`scripts/format.mjs`）

```text
editorial  默认：主色 #0F4C81（深蓝），正文 #3f3f3f，图片圆角 8
ink        纯墨色：主色 #1a1a1a，适合严肃长文，图片圆角 6
green      微信绿：主色 #07C160，引用底 #f2fbf6，适合生活/品牌稿
```

字号、行高、段距、字距、主色、引用色、圆角全部集中在 `format.mjs` 的 `THEMES`，**改一处全文生效**；命令行 `--theme` 切换。

### 执行步骤（4 步）

```text
1. 读回导入后的正文：摊平 section/div 壳，收集 H1-H6 / P / UL / OL / BLOCKQUOTE / HR / img
2. 逐块重建带内联样式的 HTML（正文 p、标题 h、引用 p、列表 ul/ol、图片 p>img）
3. 整段包一层 <section>，先 formatBlock('p') 把当前块改回正文块，再全选 → delete → insertHTML
4. 回读：真实图片数 ≥ 导入时、首段有 font-size、H2 有 border-left、mso 残留 = 0
```

**三个必须记住的坑（踩过）：**

| 坑 | 现象 | 解法 |
|---|---|---|
| 直接改 DOM 的 `el.style` | 编辑时看着对，存草稿后样式全丢 | 样式必须走「重建 HTML + insertHTML 粘贴」，ProseMirror 才记进文档模型 |
| 导入后当前块是 `h1` | 粘贴的段落被塞进 h1 壳（`h1 > section > p`），标题层级全乱 | 粘贴前 `execCommand('formatBlock', false, 'p')`，把当前块改回正文块 |
| 只粘裸 `<p>` | 空编辑器也会被自动包 `section`，但从 h1 块起粘就乱 | 整段外围显式包 `<section>...</section>`，粘贴结果稳定 |

## DOM 锚点

```
标题 ProseMirror → .ProseMirror[data-placeholder="请在这里输入标题"]
                    （注意：全页 2 个 .ProseMirror，不能全页选！必须加属性选择器）
正文 ProseMirror → .rich_media_content .ProseMirror
保存草稿按钮     → #js_submit（SPAN，click handler 事件委托在父容器上）
作者输入         → #author
公众号昵称       → .weui-desktop-account__nickname
封面区           → #js_cover_area .js_cover_btn_area（默认在视口外）
封面抽屉「从图片库选择」→ .js_imagedialog
图片库对话框     → .weui-desktop-dialog_img-picker
裁剪对话框       → .weui-desktop-dialog__wrp（innerText 含「编辑封面」）
文档导入入口     → #js_import_file（顶部「导入」，LI）
导入对话框       → .import-file-dialog（内含 input[type=file]，接受 doc/docx/markdown）
```

### 保存按钮的 click 问题

`#js_submit` 的 handler 绑在父容器上，不是元素本身的 onclick。**必须用 JS `.click()`**：

```javascript
// ✅ 正确：JS click
document.querySelector('#js_submit')?.click()

// ❌ 错误：CDP click 不触发（事件冒泡路径不对）
```

## 封面完整链路（2026-11-16 实测通过）

```text
1. #js_cover_area.scrollIntoView({ block: 'center' })   ← 关键！元素默认在视口外
2. CDP click  '#js_cover_area .js_cover_btn_area'        → 弹出 4 选项抽屉
3. JS click   '.js_imagedialog'                          → 打开「选择图片」对话框
4. 等 1.5 秒让图片库列表渲染完（Vue 会换掉 file input），再打 id → Sparo upload
5. 轮询「下一步」disabled === false                       → 实测 6-12 秒
   20 秒还没解禁 → 重新取 input 再传一次（列表重渲染会让首传落空），再等 20 秒
6. JS click   「下一步」                                  → 弹出「编辑封面」裁剪框
7. 轮询裁剪框内出现「确认」按钮（先出壳后出按钮）
8. JS click   「确认」                                    → 关框、封面落到封面区
9. 回读 #js_cover_area .js_cover_preview_new
   background-image 含 mmbiz.qpic.cn                      → 成功
10. 存草稿后 verify 再读一次，防止封面丢失
```

**四个必须记住的坑：**

| 坑 | 现象 | 解法 |
|---|---|---|
| 封面区在视口外 | CDP click 静默无效 | 先 `scrollIntoView({block:'center'})` |
| 「下一步」「确认」是 Vue 按钮 | CDP 合成点击返回 ok 但界面不动 | 必须 JS `.click()` |
| 裁剪框先出壳 | 一看到「编辑封面」就找「确认」会扑空 | 轮询到 `hasConfirm === true` 再点 |
| 图片库列表还在渲染 | input 被 Vue 换掉，上传落空，「下一步」一直灰 | 进对话框先等 1.5 秒；20 秒不解禁就换新 input 重传 |

抽屉 4 个选项（DOM 已确认）：

```
.js_selectCoverFromContent   从正文选择
.js_imagedialog              从图片库选择   ← 采用这条
.js_imageScan                微信扫码上传
.js_aiImage                  一键生成封面
```

## 还没做（优先级）

| 环节 | 状态 | 说明 |
|---|---|---|
| **正文插图（直填路径）** | ⏳ 待开始 | 顶部「图片」入口 `#js_editor_insertimage` 已定位，点开后是文件框/下拉，尚未打通落稿；微信默认走 docx，不受影响 |
| **群发发表** | ⏳ 暂不做 | 不可逆操作，人工点 |
| **定时发布** | ⏳ 暂不做 | 同上 |
| **正文视频 / 音频** | ⏳ 暂不做 | 需要单独探测入口 |

## Adapter 文件

`scripts/adapters/weixin.mjs` — 导出 `weixin` 对象，所有方法签名与头条/百家号对齐。

注册位置：
- `engine.mjs` 的 `ADAPTERS` 对象已加入 `weixin`
- `publish.mjs` 的 `PLATFORMS` 数组已加入 `"weixin"`

## 特殊注意事项

### Dev 版 vs 安装版 Sparo（同一份 userData，不能同时开）

- 安装版 `D:\Program Files\Sparo\Sparo.exe` 和 dev 版 `npm run start` **共用 `%APPDATA%\sparo-store`**
- 两个同时运行 = 单实例锁冲突 + 数据目录互相踩，会反复崩溃/启动即退
- 起浏览器前先清干净：`Get-Process -Name "Sparo" | Stop-Process -Force`，再只启动一个，等 20 秒端口 3921 UP
- **Agent 自己负责把浏览器拉起来**，不要让用户手动打开；MCP 端口起来后 `GET http://127.0.0.1:3921/health` 自检

### openBlank：直接导航，不再点菜单

已登录的公众号标签 URL 里都带 `token=<数字>`。adapter 现在的做法：

1. `list_tabs` 找任意 `mp.weixin.qq.com` 标签，从 URL 抽 `token`
2. 优先挑不在 `appmsg_edit` 上的标签（避免顶掉正在编辑的草稿）
3. 直接 `navigate` 到 `...?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=<token>`
4. 轮询标题 + 正文两个 ProseMirror 出现

找不到带 token 的标签才退回老的「首页 → 新的创作 → 文章」点击流程（会新开 tab）。

### article.mjs 字段名

`loadArticle()` 返回：`{ dir, title, body, bodyHtml, blocks, textLen, cover, images }`
展开到 ctx 后：`ctx.title`, `ctx.bodyHtml`, `ctx.blocks`, `ctx.textLen`, `ctx.cover`...
**adapter 方法签名是 `async fillBody(ctx)`，不从参数取 html**，要从 `ctx.bodyHtml` 拿。
docx 路径用 `ctx.blocks`（`markdownBlocks` 拆出的顺序块）与 `ctx.imagePlan.use`（本次要带的图）。

## 测试文章目录示例

```
D:\文字游戏引擎和游戏设计\AAA媒体矩阵自动发布\02_发布包\
└── 20261116_马斯克挺黄仁勋_改\
    ├── title.txt        ← "黄仁勋离场之后，马斯克第一个坐不住了"
    ├── body.md          ← Markdown 正文
    ├── cover.jpg        ← 封面（38KB）
    └── images\          ← 正文插图目录（可选）
```

## 已存的草稿（验证用）

| appmsgid | 说明 |
|---|---|
| 100001780 | 第一篇端到端测试稿（马斯克挺黄仁勋） |
| 100001781 | demo 测试稿（纯正文） |
| 100001798 | 封面上传首次成功稿（v14 手工链路） |
| 100001806 | **adapter 全链路首跑成功稿（标题+正文+封面+存草稿）** |
| 100001832 | docx 导入全链路（3 张插图 + 封面 + 存草稿，verify 通过） |
| 100001874 | **零图纯文字 + 排版（mso=0，样式保存后仍在）** |
| 100001881 | **多图（3 张）+ 排版全链路** |
| 100001886 | **单图（1 张）+ 排版全链路** |

## 踩坑清单

| 现象 | 原因 | 修复 |
|---|---|---|
| fillTitle 返回 EMPTY_TITLE | adapter 签名写成 `fillTitle(ctx, title)`，engine 只传 ctx | 改成 `fillTitle(ctx)` 从 `ctx.title` 取 |
| fillBody 返回 EMPTY_BODY | 写成 `ctx.html` 但 article 返回 `bodyHtml` | 改字段名 |
| readHref is not defined | adapter 调了 page.mjs 没导出的符号 | 改用 `exec('location.href')` |
| adapter.probe is not a function | probe 模式 engine 调 `adapter.probe(ctx)` | 加 probe 方法返回 pass |
| ProseMirror 空 | SPA 路由后需要等挂载完成 | waitEditor 轮询选择器出现 |
| #js_submit CDP click 失败 | handler 事件委托不绑元素 | JS `.click()` |
| openWriteTabGeneric not provided | import 了 page.mjs 没导出的符号 | 只保留 fail, pass, sleep + call, exec |
| 封面区 CDP click 无反应 | `#js_cover_area` 默认在视口外，坐标打空 | 先 `scrollIntoView({block:'center'})` |
| 点「下一步」返回 ok 但界面不动 | Vue 按钮不响应 CDP 合成事件 | 改 JS `.click()` |
| 裁剪框出现但找不到「确认」 | 对话框先出壳、按钮后渲染 | 轮询到 `hasConfirm === true` 再点 |
| 上传后 `files.length === 0` | 微信 handler 先取走文件并清空 input | 正常现象，不是失败；看「下一步」是否解禁 |
| 排版时样式看着生效、存草稿后全丢 | 直接改 DOM 的 `el.style` 不进 ProseMirror 文档模型 | 重建带内联样式的 HTML，`insertHTML` 粘贴覆盖 |
| 粘贴后段落被塞进 `h1` 壳 | Word 导入后当前块是 h1，粘贴沿用当前块类型 | 先 `execCommand('formatBlock', false, 'p')` 再粘，且整段包 `<section>` |
| 封面「下一步」一直灰 | 图片库列表重渲染换掉了 file input，首传落空 | 进对话框等 1.5 秒再传；20 秒不解禁就换新 input 重传 |
| exec 返回值当对象用导致 `JSON.parse("[object Object]")` | `exec` 返回的是 JSON 字符串，不是已解包对象 | 统一走 `page(ctx, script)` 助手 |
| Sparo 反复崩溃 / 启动即退 | 安装版与 dev 版共用 `%APPDATA%\sparo-store`，多实例冲突 | 先 `Stop-Process` 清干净，只开一个 |
