# 新平台发布能力接入流程

这份文档是从头条 / 百家号 / 搜狐号 / 微信公众号四次接入中提炼出来的可复用经验。下次接微博 / B站 / 知乎时，按这份流程走，可以把"从头摸索"的时间从 2-3 天压缩到 4-6 小时。

---

## 一、状态机模板（固定 8 步）

每个平台 adapter 都必须实现以下 8 个方法，由 `engine.mjs` 统一调度：

```
openBlank ──► fillTitle ──► fillBody ──► insertImages ──► setCover ──► setOptions ──► publishOrSchedule ──► verify
  (开编辑页)    (写标题)      (写正文)      (插正文图)        (封面)       (选项)          (发布/存草稿)         (核验)
```

### 每个步骤的契约

| 步骤 | 输入（从 ctx 取） | 必须返回 | 回读校验 |
|---|---|---|---|
| `openBlank(ctx)` | — | `{ ok: true, tabId }` | 新 tab 的 URL 含 `writeMark` |
| `fillTitle(ctx)` | `ctx.title` | `{ ok: true }` | 编辑器内标题与输入一致（至少 60% 匹配） |
| `fillBody(ctx)` | `ctx.bodyHtml` | `{ ok: true }` | 正文 innerText 长度 > 20 |
| `insertImages(ctx)` | `ctx.images[]` | `{ ok: true, count }` | 正文内 img 数量 |
| `setCover(ctx)` | `ctx.cover` 路径 | `{ ok: true }` | 封面区域有 img / background-image |
| `setOptions(ctx)` | 平台铁律（硬编码） | `{ ok: true }` | 每个 checkbox 的 checked 状态 |
| `publishOrSchedule(ctx)` | — | `{ ok: true, detail }` | 列表页新条目 / URL 跳转 / 回执 |
| `verify(ctx)` | 上一步回执 | `{ ok: true }` | 平台独立的成功信号 |

所有方法签名统一为 `async method(ctx)`，**不从参数取 title/html**，只从 ctx 取。

### 为什么这个顺序

- `openBlank` 必须第一个：拿到 `tabId` 后，后续所有 CDP 操作都带它
- `fillTitle → fillBody → insertImages → setCover` 是"填内容"阶段，依赖 tabId 已就绪
- `setOptions` 在发布前：不依赖内容但依赖 tabId
- `publishOrSchedule → verify` 是最后：不可逆操作，前面全部 ok 才能走到这里

---

## 二、Adapter 接口模板

```javascript
import { fail, pass, sleep } from "../page.mjs";
import { call, exec } from "../sparo.mjs";

// DOM 锚点（按实际探查填）
const TITLE_PM = '...';
const BODY_PM = '...';
const SAVE_BTN = '...';

export const weixin = {
  id: "weixin",
  host: "mp.weixin.qq.com",
  writeUrl: "https://...",          // 编辑器初始 URL
  writeMark: "appmsg_edit_v2",      // URL 片段，用来识别编辑器 tab
  editExisting: null,                // 如果"修改已发布文章"也是编辑器页，给个排除标记
  accountName: "八万里纵横",          // 固定账号名（readSiteAccount 会覆盖）

  async openBlank(ctx) { /* ... */ },
  async waitEditor(ctx, timeout) { /* ... */ },
  async readSiteAccount(ctx) { /* ... */ },
  async readAccountName(ctx) { /* ... */ },
  async readTitle(ctx) { /* ... */ },
  async fillTitle(ctx) { /* ... */ },
  async fillBody(ctx) { /* ... */ },
  async insertImages(ctx) { /* ... */ },
  async setCover(ctx) { /* ... */ },
  async setOptions(ctx) { /* ... */ },
  async publishOrSchedule(ctx) { /* ... */ },
  async verify(ctx) { /* ... */ },
  async probe(ctx) { /* ... */ },   // engine --probe 模式
  async selfCheck() { /* ... */ },  // engine --self-check
};
```

然后注册到两个地方：
- `engine.mjs` 的 `ADAPTERS` 对象
- `publish.mjs` 的 `PLATFORMS` 数组

---

## 三、DOM 锚点探测方法（通用脚本模板）

每次接新平台，先把下面这段脚本在 Sparo 里跑一遍，把编辑器的 DOM 结构摸清楚：

```javascript
// 在 exec 里跑
JSON.parse(String(await exec(`
(() => {
  // 1. 找所有编辑器（ProseMirror / UEditor / Lexical / 普通 textarea）
  const editors = [];
  // ProseMirror
  [...document.querySelectorAll('.ProseMirror')].forEach(pm => {
    const placeholder = pm.getAttribute('data-placeholder') || '';
    editors.push({ type: 'prosemirror', placeholder, sel: '.ProseMirror' + (placeholder ? `[data-placeholder="${placeholder}"]` : '') });
  });
  // UEditor
  [...document.querySelectorAll('iframe')].forEach(f => {
    try {
      if (f.contentDocument?.querySelector('.editable-editor'))
        editors.push({ type: 'ueditor', sel: 'iframe...' });
    } catch(e){}
  });
  // Lexical
  [...document.querySelectorAll('.editor-input')].forEach(inp => {
    editors.push({ type: 'lexical', placeholder: inp.getAttribute('data-placeholder')||'' });
  });
  // 普通 input/textarea
  [...document.querySelectorAll('input, textarea')].forEach(inp => {
    if (inp.type === 'hidden') return;
    const placeholder = inp.getAttribute('placeholder') || '';
    editors.push({ type: 'input', tag: inp.tagName.toLowerCase(), name: inp.name, placeholder });
  });

  // 2. 找保存/发布按钮
  const btns = [...document.querySelectorAll('button, [role="button"], a, span')]
    .filter(el => !!(el.offsetWidth || el.offsetHeight))
    .map(el => {
      const txt = (el.innerText || '').trim();
      return {
        tag: el.tagName,
        id: el.id || '',
        cls: (el.className || '').toString().slice(0, 60),
        text: txt.slice(0, 20),
        onclick: !!el.onclick,           // 有没有直接绑 onclick
        aria: el.getAttribute('aria-label') || '',
      };
    })
    .filter(b => /保存|发布|发表|提交|确定|预览|定时/.test(b.text))
    .slice(0, 15);

  // 3. 找 file input（封面/正文图上传入口）
  const files = [...document.querySelectorAll('input[type="file"]')].map(f => {
    const r = f.getBoundingClientRect();
    const cs = getComputedStyle(f);
    return {
      accept: f.accept,
      visible: r.width > 0 && r.height > 0,
      rect: { w: Math.round(r.width), h: Math.round(r.height) },
      display: cs.display,
      opacity: cs.opacity,
      parentCls: (f.parentElement?.className || '').toString().slice(0, 80),
    };
  });

  return { editors, btns, files, url: location.href };
})()
`, tabId)).replace(/^.*result.:/, '').replace(/\}..$/, '}'));
```

**先跑这个，再写 adapter。** 不要先假设平台用什么编辑器、按钮在什么位置。

---

## 四、三种主流编辑器的写入策略

| 编辑器 | 平台案例 | 写入方式 | 回读校验 | 坑 |
|---|---|---|---|---|
| **ProseMirror** | 微信公众号、知乎 | `focus()` → `selectAll` → `delete` → `document.execCommand('insertText', text)` 或 `insertHTML(html)` | `.ProseMirror.innerText` 比对 | 同一页面可能有多个 ProseMirror（标题+正文各一个），**必须加属性选择器限定范围** |
| **UEditor** | 百家号 | `ue.setContent(html)` (iframe 内实例) | iframe 内 `.ueditor-body` innerText | iframe 必须等加载完，CDP 操作要带 iframe frameId |
| **Lexical** | 头条号 | `root.clear()` → 全文 setRootText + 分行标记 | `.editor-input` value 全文比对 | 不是所有分支都能用 execCommand，Lexical 有自己的 EditorState |

### 通用回读校验模式

```javascript
// 写之前 → 回读 → 比对
const before = await exec(`...write...`, tabId);
await sleep(300); // 等 React/Vue 状态更新
const verify = await exec(`...read...`, tabId);
if (!verify.result.includes(expected.slice(0, Math.floor(expected.length * 0.6))))
  return fail("TITLE_MISMATCH");
```

**不比对全文**（SPA 会对文本做规范化处理，比如去首尾空格、合并换行），只比对前 60% 或前 4 个字符。

---

## 五、保存按钮的 click 问题（关键）

**两种点击方式，适用场景不同：**

| 方式 | 代码 | 适用场景 |
|---|---|---|
| **JS `.click()`** | `exec('document.querySelector("#btn").click()', tabId)` | 按钮的 handler 绑在父容器上（事件委托），元素本身没有直接 onclick |
| **Sparo CDP click** | `call('click', { selector: '#btn', tabId })` | 按钮有直接 onclick handler，或者按钮是 SPA 的虚拟元素需要真实鼠标事件 |

### 判断方法

```javascript
// 探查按钮的事件绑定
JSON.parse(String(await exec(`
(() => {
  const btn = document.querySelector('#js_submit');
  if (!btn) return null;
  return {
    onclickAttr: btn.getAttribute('onclick'),
    hasDirectOnclick: typeof btn.onclick === 'function',
    parentOnclick: typeof btn.parentElement?.onclick === 'function',
    // CDP click 能派发但 JS click 不能时，说明 handler 走的是 addEventListener 绑在元素上
  };
})()
`, tabId)).replace(/^.*result.:/, ''));
```

### 已验证的平台差异

| 平台 | 保存按钮 | 正确方式 |
|---|---|---|
| 微信公众号 | `#js_submit`（SPAN，事件委托在父容器） | **JS `.click()`**（CDP click 不触发） |
| 百家号 | 确认弹层 footer 按钮 | CDP click |
| 头条号 | `.article-publish button.publish-btn` | CDP click |
| 搜狐号 | `.content-manage-bar button` | CDP click |

### 兜底策略

如果不确定哪种方式对，**两种都试**：先 JS click，sleep 1s，看状态有没有变；没变再用 CDP click。

---

## 六、Sparo MCP 工具使用模式

### 核心工具（在 `sparo.mjs` 中导出）

| 工具 | 用途 | 必须带 tabId |
|---|---|---|
| `exec(js, tabId)` | 在指定 tab 里跑任意 JS | ✅ |
| `click(selector, tabId)` | Sparo CDP 真实坐标点击 | ✅ |
| `uploadFile(selector, filePath, tabId)` | 给 file input 传本地文件 | ✅ |
| `press(key, tabId)` | 键盘按键（不常直接用） | ✅ |
| `nav({ url, tabId, envId })` | 导航到 URL | ✅（navigate 自动带 tabId） |
| `switchTab(tabId)` | 切到另一个 tab | — |
| `ensureRender({ tabId })` | 保证目标 tab 布局完成 | ✅ |
| `list_tabs` (call) | 列出所有 tab | — |

### uploadFile 的正确参数

```javascript
// sparo.mjs 里的封装是：uploadFile(selector, file, tabId, expect)
// 内部转换为：call('upload', { files: [file], tabId, selector })
// 直接用 call 时别忘了 selector 选项
const up = await call('upload', {
  selector: 'input[data-sparo-cover]',
  files: ['D:/path/to/cover.jpg'],
  tabId: tabId,
});
```

### 所有操作前先核对 tab URL

```javascript
// page.mjs 的 gateTool 已经封装了：每次动作前先读 location.href
// 跟 ctx.host 比对，不匹配就返回 MISMATCH
```

---

## 七、真实案例：微信公众号接入全过程

### Day 1：探路

| 步骤 | 做了什么 | 结果 |
|---|---|---|
| 打开编辑器 | 首页点「新的创作 → 文章」，会新开 tab | ✅ tab 从 `appmsg_edit_v2` 变 `appmsg_edit` |
| 探查 DOM | 跑通用脚本模板 | ✅ 发现两个 ProseMirror（标题 + 正文各一个） |
| 探查保存按钮 | 用 JS click vs CDP click 对比 | ✅ JS click 100% 触发，CDP click 不触发（事件委托） |
| 存草稿 | `#js_submit.click()` → 等 URL 变 | ✅ 拿到 `appmsgid` |

### Day 2：填内容

| 步骤 | 做了什么 | 结果 |
|---|---|---|
| 写标题 | ProseMirror focus → selectAll → insertText | ✅ 回读 innerText 比对 |
| 写正文 | ProseMirror focus → insertHTML(html) | ✅ 2356 字全部注入 |
| 字段名 bug | `article.mjs` 返回 `bodyHtml`，adapter 写成 `ctx.html` | ❌ EMPTY_BODY → 修了 |
| end-to-end | 全链路跑一篇真实稿 | ✅ 所有步骤 ok |

### Day 3：封面攻坚（已攻克）

| 现象 | 结论 |
|---|---|
| JS `.click()` on `#js_cover_area` 没反应 | 该组件只认真实鼠标事件 |
| CDP click 也没反应 | **元素默认在视口外**（scrollTop 之外），坐标打空 → 先 `scrollIntoView({block:'center'})` |
| 抽屉弹出后 `.js_imagedialog` 打不开对话框 | 这个链接吃 JS `.click()`，CDP 不行 |
| 上传后「下一步」一直灰 | 只是没传完，实测 7-12 秒后自动解禁，别提前放弃 |
| 点「下一步」CDP 返回 ok 但界面不动 | Vue 按钮不响应合成事件 → 一律 JS `.click()` |
| 裁剪框出现了却找不到「确认」 | 对话框先出壳、按钮后渲染 → 轮询到按钮存在再点 |
| 改 parent display 强行露出 file input | ❌ 破坏 DOM，上传请求路由不到，别这么干 |

**最终可用链路（10 步）**：scrollIntoView → CDP 点封面区 → JS 点「从图片库选择」→ 对话框内 file input 上传 → 等「下一步」解禁（≤35s）→ JS 点下一步 → 等「确认」出现 → JS 点确认 → 回读 `background-image` 含 `mmbiz.qpic.cn` → 存草稿后再回读一次。

**通用规律（适用于所有新平台）**：CDP click 只解决「元素在视口外/需要真实坐标」，不解决「框架自定义事件」；Vue/React 组件按钮一律优先 JS `.click()`，再用回读状态判定是否真的生效。

### 还没做的

- 正文插图（找 ProseMirror 工具栏图片入口）
- 群发发表（`#js_submit` 是存草稿，发表按钮 DOM 还没摸）
- 定时发布

---

## 八、常见坑速查

| 坑 | 解决 |
|---|---|
| SPA 路由跳转后 DOM 是空的 | 等 URL 片段匹配 + 编辑器选择器出现，不要只 sleep 固定时间 |
| `execCommand('insertText')` 不生效 | 先 focus() + selectAll() + delete()，清空再写；ProseMirror 要求光标在编辑器内 |
| CDP click 返回 ok 但按钮没反应 | 换 JS `.click()`，这个按钮的 handler 走事件委托 |
| 回读校验一直 FAIL | 不要比对全文，只比对前 60% 或前 N 个字符 |
| 多个 ProseMirror | 必须加属性选择器（placeholder / data- 属性）限定到正确那一个 |
| `loadArticle` 返回 `bodyHtml`，adapter 写成 `ctx.html` | **记住**：`...article` 展开到 ctx，article.mjs 返回什么字段，ctx 就有什么字段 |
| Sparo 端口连不上 | 先 `Get-NetTCPConnection -State Listen \| Where LocalPort -eq 3921`，没有再启动 |
| Sparo 反复崩溃 / 启动即退 | 安装版和 dev 版**共用 `%APPDATA%\sparo-store`**，不能同时开；先 `Stop-Process` 清干净再只起一个 |
| Agent 让用户手动开浏览器 | 不对。浏览器是给 Agent 用的，Agent 自己拉起进程并等端口 UP |
