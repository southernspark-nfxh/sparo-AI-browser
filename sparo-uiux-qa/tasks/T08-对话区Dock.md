# T08 · 对话区与 Dock 精简

> 工作根目录（绝对路径）：`d:\download\sparo上架应用商店版`
> 唯一改动文件：`d:\download\sparo上架应用商店版\src\renderer\shell.html`
> 前置：T07 已提交（锁屏表单已删，Dock 变短）
> 风险：中（只改侧栏内部结构与提示逻辑）

---

## 0. 现状问题

1. 底部四个快捷动作（总结 / 填表 / 回复 / 发布）是**四段纯文字**，没有图标，大小一致但看不出是按钮。
2. 「我的笔记」被 `.notes-split` 一条通栏分割线挤到第二行，占了半屏高度。
3. 两行提示说同一件事：
   - `#chatHint`：「网页上的发送和提交，始终由你确认」
   - `#csStatus` 默认：「回复只填草稿。发送、提交都请你点。」
4. 欢迎卡前三段文字（kicker / h3 / lead / noEmail）重复表达"可以选一种方式"。
5. `thread-tools`（复制全部 / 清空对话）横在对话区上方，占一行且很显眼。

---

## 1. 目标

1. 四个快捷动作变成"图标 + 文字"的胶囊 chip，一眼看出可点。
2. 「我的笔记」移到对话区右上工具条，不再单独占一行。
3. 底部只保留**一行**提示；`#csStatus` 只在真的有草稿时出现。
4. 欢迎卡删掉一段重复说明，首屏更干净。
5. 对话区工具条降为轻量图标按钮。

---

## 2. 具体改动

### 2.1 快捷动作加图标

DOM（L1453-1460）改成：

```html
<div class="shortcuts">
  <button type="button" class="job" id="btnSummarize" data-i18n="act.summarize" data-i18n-title="act.summarizeTitle" title="阅读当前页，写出要点">
    <svg class="ic"><use href="#i-doc"/></svg><span data-i18n="act.summarize">总结</span>
  </button>
  <button type="button" class="job" id="btnFillForm" data-i18n="act.fill" data-i18n-title="act.fillTitle" title="识别表单并按你给的资料填写，提交前停下">
    <svg class="ic"><use href="#i-form"/></svg><span data-i18n="act.fill">填表</span>
  </button>
  <button type="button" class="job" id="btnCsOneClick" data-i18n="act.reply" data-i18n-title="act.replyTitle" title="起草回复并填入输入框，不会自动发送">
    <svg class="ic"><use href="#i-chat"/></svg><span data-i18n="act.reply">回复</span>
  </button>
  <button type="button" class="job" id="btnPublish" data-i18n="act.publish" data-i18n-title="act.publishTitle" title="按当前站发布，提交前暂停">
    <svg class="ic"><use href="#i-send"/></svg><span data-i18n="act.publish">发布</span>
  </button>
</div>
```

删掉 `<div class="notes-split"></div>` 和 `#btnNotes` 那一行（笔记按钮移到 2.2）。

> 注意：`data-i18n` 现在挂在 `<span>` 上，不要再挂在 button 上，否则 `applyDom()` 会把整个按钮内容替换成文字，图标就没了。

CSS：

```css
.shortcuts {
  display: flex;
  gap: 6px;
  padding: 0 4px 10px;
  flex-wrap: wrap;
}
.shortcuts .job {
  height: 28px;
  padding: 0 10px;
  gap: 5px;
  border: 1px solid var(--line);
  border-radius: var(--r-999);
  background: var(--paper);
  color: var(--text);
  font-size: var(--fs-12);
}
.shortcuts .job .ic { width: 14px; height: 14px; color: var(--muted); }
.shortcuts .job:hover { border-color: var(--accent); }
.shortcuts .job:hover .ic { color: var(--accent); }
.shortcuts .job:disabled { opacity: .4; }
```

### 2.2 笔记按钮移到对话区工具条

`thread-tools`（L1378-1381）改成：

```html
<div class="thread-tools">
  <button type="button" id="btnNotes" title="我的笔记"><svg class="ic"><use href="#i-book"/></svg></button>
  <button type="button" id="btnCopyChat" data-i18n-title="chat.copyAll" title="复制全部"><svg class="ic"><use href="#i-doc"/></svg></button>
  <button type="button" id="btnClearChatDock" data-i18n-title="chat.clear" title="清空对话"><svg class="ic"><use href="#i-close"/></svg></button>
</div>
```

> `#btnNotes` 的 onclick 绑定在别处，id 不变即可；原来按钮里的 emoji 文字删掉。
> `data-i18n="chat.copyAll"` 改挂 `data-i18n-title`，避免 `applyDom` 覆盖成文字。

CSS：

```css
.thread-tools {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  padding: 0 14px 4px;
  flex: 0 0 auto;
  opacity: .55;
  transition: opacity .15s;
}
.sidebar:hover .thread-tools { opacity: 1; }
.thread-tools button {
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--r-8);
  background: transparent;
  color: var(--muted);
}
.thread-tools button:hover {
  background: color-mix(in srgb, var(--text) 7%, transparent);
  color: var(--text);
}
```

### 2.3 底部只留一行提示

1. 删掉 `<div class="quick-status" id="csStatus" ...>` 的默认文案显示——**保留元素**，由 JS 控制显隐。
2. `renderCs()`（L2957）里改三处：

```js
if (!cs) {
  status.style.display = "none";      // 原先是写 idleLong 文案
  meta.innerHTML = "";
  draftEl.style.display = "none";
  draftEl.textContent = "";
  return;
}
status.style.display = "";            // 有草稿/状态时再出现
```

3. `#chatHint` 保持唯一常驻提示，样式改成单行、12px、居中偏左：

```css
#chatHint {
  margin-top: 6px;
  font-size: var(--fs-12);
  color: var(--muted);
  padding: 0 6px;
  line-height: 1.4;
  text-align: left;
}
```

> `.note` 这个 class 只给 `#chatHint` 用；`.quick-status` 只给 `#csStatus` 用。保留两条规则，不要互相覆盖。

### 2.4 欢迎卡减法

`#welcomeHome`（L1384-1403）删掉这一行：

```html
<p class="cap" data-i18n="welcome.noEmail">也可以先作为普通浏览器使用，需要时再登录或填写密钥。</p>
```

（它的信息和 `welcome.laterHint` 重复。）
保留 kicker + h3 + lead + 三张卡。

### 2.5 `welcomeDone` 三个动作加图标

```html
<div class="welcome-jobs">
  <button type="button" id="welcomeJobSummarize"><svg class="ic"><use href="#i-doc"/></svg><span data-i18n="welcome.jobSummarize">总结这一页</span></button>
  <button type="button" id="welcomeJobWeather"><svg class="ic"><use href="#i-globe"/></svg><span data-i18n="welcome.jobWeather">查今天天气</span></button>
  <button type="button" id="welcomeJobReply"><svg class="ic"><use href="#i-chat"/></svg><span data-i18n="welcome.jobReply">写一条回复</span></button>
</div>
```

CSS：

```css
.welcome-jobs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.welcome-jobs button {
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-999);
  background: var(--paper);
  color: var(--text);
  font-size: var(--fs-12);
  cursor: pointer;
}
.welcome-jobs button:hover { border-color: var(--accent); }
.welcome-jobs button .ic { width: 14px; height: 14px; color: var(--muted); }
```

### 2.6 欢迎卡整体收紧

```css
.welcome { padding: 2px 0 12px; margin-bottom: 6px; }
.welcome h3 { font-size: var(--fs-16); font-weight: var(--fw-b); margin: 0 0 6px; }
.welcome .hint { font-size: var(--fs-12); line-height: 1.45; }
.welcome-choices { gap: 6px; margin-top: 10px; }
.sidebar button.choice { padding: 10px 12px; }
```

---

## 3. 红线

- 不许改 `#btnSummarize` / `#btnFillForm` / `#btnCsOneClick` / `#btnPublish` / `#btnNotes` 的 id。
- 不许删 `#csStatus`、`#csMeta`、`#csDraft` 元素（业务要往里写）。
- 不许把 `data-i18n` 留在含图标的 button 上（会被整段替换）。
- 不许改 `renderCs()` 的文案内容，只改显隐。
- 不许动 `#pauseBar`、`#helpCard`、`#approvalsCard`。
- 不许把 `.shortcuts` 改成图标网格（会挤压输入区）。

---

## 4. 自检

```powershell
cd d:\download\sparo上架应用商店版
Select-String -Path src\renderer\shell.html -Pattern "notes-split" | Measure-Object      # 应为 0
Select-String -Path src\renderer\shell.html -Pattern "id=""btnNotes""" | Measure-Object  # 应为 1
npm run typecheck && npm test
```

---

## 5. 验收（`npm run start`）

- [ ] 底部四个动作都是「图标 + 两字」胶囊，宽度自然，换行整齐
- [ ] hover 时边框和图标变烧赭色
- [ ] 「我的笔记」不再单独占一行，出现在对话区右上
- [ ] 对话区工具条平时是淡的，鼠标进侧栏变清晰
- [ ] 三个工具图标 hover 有浅底
- [ ] 底部只有一行提示（未触发客服回复时）
- [ ] 点「回复」产生草稿后，状态行重新出现，显示草稿信息
- [ ] 清空对话后，状态行再次隐藏
- [ ] 欢迎卡少了重复那段，三张卡间距更紧，首屏能看到输入框
- [ ] 「可以开始使用了」状态下的三个动作有图标
- [ ] 中英文切换后，图标不会被文字覆盖

### 截图

1. Dock 区特写（四个 chip + 输入框）
2. 对话区顶部工具条
3. 欢迎卡首屏

---

## 6. 提交

```powershell
git add src/renderer/shell.html
git commit -m "ui(t08): icon quick actions, single hint line, lighter thread tools"
```
