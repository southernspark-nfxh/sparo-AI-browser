---
name: weixin-publish
description: 通过本机 Sparo 浏览器 MCP 通道后台发布到微信公众号（八万里纵横账号）。已跑通 开编辑器 → 写标题 → 写正文 → 上传封面 → 存草稿 → 核验 全链路（2026-11-16 端到端实测）。群发发表/定时发布暂由人工兜底。Use when the user asks to publish / 发稿 / 存草稿 / 群发 to 微信公众号 / 公众号 / 微信 / 八万里纵横. Requires Sparo running with logged-in mp.weixin.qq.com session.
---

# 微信公众号发布（八万里纵横 · Sparo MCP）

统一入口复用 `social-media-publish` 技能的 `scripts/publish.mjs`，加 `--platform weixin`。

## 一条命令

```powershell
# 探测（不填内容，只验证 openBlank）
node publish.mjs --platform weixin --probe

# 完整链路：开编辑器 → 写标题 → 写正文 → 存草稿
node publish.mjs --platform weixin --article "<目录>"

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
| **上传封面** | 10 步链路，见下节「封面完整链路」 |
| **存草稿** | `#js_submit.click()`（JS click）→ 轮询 URL 变带 `appmsgid=` |
| **核验** | 回读 `#js_cover_area .js_cover_preview_new` 的 background-image 含 `mmbiz.qpic.cn` |

端到端实测：约 25-30 秒（封面等待上传占大头），全链路 `ok:true`。

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
4. 对话框内 input[type=file] 打 id → Sparo upload        → 上传 cover.jpg
5. 轮询「下一步」disabled === false                       → 实测 7-12 秒，最多等 35 秒
6. JS click   「下一步」                                  → 弹出「编辑封面」裁剪框
7. 轮询裁剪框内出现「确认」按钮（先出壳后出按钮）
8. JS click   「确认」                                    → 关框、封面落到封面区
9. 回读 #js_cover_area .js_cover_preview_new
   background-image 含 mmbiz.qpic.cn                      → 成功
10. 存草稿后 verify 再读一次，防止封面丢失
```

**三个必须记住的坑：**

| 坑 | 现象 | 解法 |
|---|---|---|
| 封面区在视口外 | CDP click 静默无效 | 先 `scrollIntoView({block:'center'})` |
| 「下一步」「确认」是 Vue 按钮 | CDP 合成点击返回 ok 但界面不动 | 必须 JS `.click()` |
| 裁剪框先出壳 | 一看到「编辑封面」就找「确认」会扑空 | 轮询到 `hasConfirm === true` 再点 |

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
| **正文插图** | ⏳ 待开始 | ProseMirror 工具栏「图片」入口（`tpl_item jsInsertIcon img`）还没摸 |
| **群发发表** | ⏳ 暂不做 | 不可逆操作，人工点 |
| **定时发布** | ⏳ 暂不做 | 同上 |

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

`loadArticle()` 返回：`{ dir, title, body, bodyHtml, cover, images }`
展开到 ctx 后：`ctx.title`, `ctx.bodyHtml`, `ctx.cover`...
**adapter 方法签名是 `async fillBody(ctx)`，不从参数取 html**，要从 `ctx.bodyHtml` 拿。

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
| exec 返回值当对象用导致 `JSON.parse("[object Object]")` | `exec` 返回的是 JSON 字符串，不是已解包对象 | 统一走 `page(ctx, script)` 助手 |
| Sparo 反复崩溃 / 启动即退 | 安装版与 dev 版共用 `%APPDATA%\sparo-store`，多实例冲突 | 先 `Stop-Process` 清干净，只开一个 |
