# T03 · Chrome 收成两行 + 移除书签栏 + ⋯ 折叠菜单

> 工作根目录（绝对路径）：`d:\download\sparo上架应用商店版`
> 改动文件（只有这两个）：
> - `d:\download\sparo上架应用商店版\src\renderer\shell.html`
> - `d:\download\sparo上架应用商店版\src\main\browser.ts`
> 前置：T02 已提交
> 风险：中（改 Chrome 高度，网页区洞的 y 坐标会变）

---

## 0. 矿工须知

现在顶部是三行 104px：标签 36 + 导航 40 + 书签栏 28。
书签栏是**纯展示条**，点 `▤` 弹的是主进程原生菜单，所以删掉这条 28px 栏**不会丢功能**。
删完 Chrome 变 76px，网页区多出 28px 可视高度。

主进程里有两个常量必须同步改，否则网页会被顶到错误位置：

```ts
// src/main/browser.ts L400-401（当前值）
const CHROME_H = 104; // tabs 36 + omnibox 40 + bookmarks bar 28
const SIDEBAR_W = 312;
```

---

## 1. 目标

1. Chrome 从 104px 收成 **76px**（标签 36 + 导航 40），书签栏不再占行。
2. 导航栏从 7 个控件收成 **5 个**：后退、前进、刷新、地址栏、收藏、⋯（⋯ 里再放 4 项）。
3. ⋯ 菜单内含：历史记录、书签、页面内查找、优化内存。全部复用现有 id 与 onclick，不重写逻辑。
4. 标签显示站点图标（favicon），拿不到就退回地球图标。
5. 网页区不能出现被压窄、空白、错位。

---

## 2. 改动 A：`shell.html` 布局

### 2.1 常数与网格

```css
:root { --chrome-h: 76px; }

.app {
  display: grid;
  grid-template-columns: 1fr var(--side-w);
  grid-template-rows: env(titlebar-area-height, 36px) 40px 1fr;
  height: 100%;
  width: 100%;
}

.page-hole { grid-column: 1; grid-row: 3; }   /* 原为 4 */
```

`.sidebar` 的 `grid-row: 2 / -1` **保持不变**（它从导航行开始，跨到底）。

### 2.2 删掉书签栏

1. 删除 DOM 整块（L1333-1335）：

```html
<div class="bm-bar" id="bmBar">
  <span class="bm-empty" id="bmEmpty" ...>...</span>
</div>
```

2. 删除 CSS：`.bm-bar`、`.bm-chip`、`.bm-chip:hover`、`.bm-more`、`.bm-more:hover`、`.bm-empty`、`.bm-menu-wrap`、`.bm-menu`、`.bm-menu.open`。
   **保留** `.menu-item`、`.menu-sep`、`.menu-hint`（⋯ 菜单要复用）。

3. 删除 JS：
   - `const bmBarEl`、`const bmEmptyEl`（L1692-1693）
   - `function packBookmarkBar()` 整个函数（L1858-1919）
   - `window.addEventListener("resize", () => packBookmarkBar());`（L3734）
   - `overflowUrls` 变量（L1712），`openBmMenu()` 改成 `window.sparkShell.openBookmarksMenu();`

4. 删掉 `.bar` 的 `border-right: 1px solid var(--line);`（和侧栏 `border-left` 叠成了双线）。

### 2.3 导航栏结构

把现在的（L1311-1332）改成：

```html
<div class="bar">
  <div class="nav">
    <button id="back" data-i18n-title="nav.back" title="后退"><svg class="ic"><use href="#i-back"/></svg></button>
    <button id="forward" data-i18n-title="nav.forward" title="前进"><svg class="ic"><use href="#i-fwd"/></svg></button>
    <button id="reload" data-i18n-title="nav.reload" title="刷新"><svg class="ic"><use href="#i-reload"/></svg></button>
  </div>
  <input class="url" id="url" type="text" spellcheck="false" data-i18n-placeholder="url.placeholder" placeholder="输入网址，例如 baidu.com" />
  <button class="icon-btn" id="btnStar" data-i18n-title="bookmark.star" title="收藏此页"><svg class="ic"><use href="#i-star"/></svg></button>

  <div class="nav-more" id="navMoreWrap">
    <button class="icon-btn" id="btnNavMenu" title="更多" aria-haspopup="true" aria-expanded="false">
      <svg class="ic"><use href="#i-more"/></svg>
    </button>
    <div class="nav-menu hide" id="navMenu">
      <button type="button" class="menu-item" id="btnHistory" data-i18n-title="nav.history" title="历史记录">
        <svg class="ic"><use href="#i-history"/></svg><span>历史记录</span>
      </button>
      <button type="button" class="menu-item" id="btnBmMenu" data-i18n-title="bookmark.menu" title="书签">
        <svg class="ic"><use href="#i-bookmark"/></svg><span>书签</span>
      </button>
      <button type="button" class="menu-item" id="btnFind" title="在页面内查找">
        <svg class="ic"><use href="#i-search"/></svg><span>页面内查找</span>
      </button>
      <div class="menu-sep"></div>
      <button type="button" class="menu-item" id="btnMem" data-i18n-title="mem.moonTitle" title="休眠后台标签，释放内存。点休眠的标签会重新加载。">
        <svg class="ic"><use href="#i-moon"/></svg><span data-i18n="mem.optimize">优化内存</span>
      </button>
    </div>
  </div>

  <div class="find-bar" id="findBar">
    ...保持不变...
  </div>
</div>
```

**注意：`#btnHistory`、`#btnBmMenu`、`#btnMem` 的 id 一字不改**，JS 里的 `onclick` 绑定会自动继续生效。
`#btnMem` 原来的 `.mem-chip` class 去掉，改用 `.menu-item`。

新增 CSS：

```css
.nav-more { position: relative; flex: 0 0 auto; }

.nav-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 208px;
  padding: 6px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--r-16);
  box-shadow: var(--shadow-2);
  z-index: 40;
}
.nav-menu.hide { display: none; }

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--r-8);
  background: transparent;
  color: var(--text);
  font-size: var(--fs-13);
  text-align: left;
}
.menu-item .ic { color: var(--muted); }
.menu-item:hover { background: color-mix(in srgb, var(--text) 6%, transparent); }
.menu-item:hover .ic { color: var(--text); }
```

### 2.4 菜单开关 JS

在 `starEl.onclick = toggleStar;` 附近加：

```js
const navMenu = document.getElementById("navMenu");
const navMenuBtn = document.getElementById("btnNavMenu");
function setNavMenuOpen(open) {
  navMenu.classList.toggle("hide", !open);
  navMenuBtn.setAttribute("aria-expanded", open ? "true" : "false");
}
navMenuBtn.onclick = (e) => {
  e.stopPropagation();
  setNavMenuOpen(navMenu.classList.contains("hide"));
};
document.addEventListener("click", (e) => {
  if (!e.target.closest || !e.target.closest("#navMoreWrap")) setNavMenuOpen(false);
});
document.getElementById("btnFind").onclick = () => {
  setNavMenuOpen(false);
  openFindBar();
};
```

菜单项点击后要收起：在 `#navMenu` 上加一个委托监听：

```js
navMenu.addEventListener("click", () => setNavMenuOpen(false));
```

`#btnFind` 用的是已有函数 `openFindBar()`（L2025）。

### 2.5 标签 favicon

在 `renderChrome()` 里，创建 `title` 之前插入图标：

```js
const ico = document.createElement("img");
ico.className = "tab-ico";
ico.alt = "";
ico.draggable = false;
if (tab.favIcon) {
  ico.src = tab.favIcon;
  ico.onerror = () => { ico.replaceWith(globeFallback()); };
} else {
  ico.replaceWith(globeFallback());
}
function globeFallback() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("class", "ic tab-ico");
  s.innerHTML = '<use href="#i-globe"/>';
  return s;
}
el.appendChild(ico);
```

CSS：

```css
.tab-ico { width: 14px; height: 14px; flex: 0 0 14px; border-radius: 3px; object-fit: contain; }
.tab .title { min-width: 0; }
```

标签激活态加一条品牌色指示：

```css
.tab.active { box-shadow: inset 0 -2px 0 var(--accent); }
```

---

## 3. 改动 B：`browser.ts`

### 3.1 常量

```ts
const CHROME_H = 76; // tabs 36 + omnibox 40（书签栏已移除）
```

`SIDEBAR_W` **本任务不动**（T04 再改）。

### 3.2 favicon 数据

1. 在标签状态类型里加字段：`favIcon?: string;`
2. 在 `wc.on("page-title-updated", ...)`（L824）旁边加：

```ts
wc.on("page-favicon-updated", (_e, icons: string[]) => {
  tab.favIcon = (icons && icons[0]) || "";
  this.pushChromeState();
});
```

3. `getChromeState()` 的 tab 映射里加一行：`favIcon: t.favIcon || "",`

### 3.3 `pageBounds` 注释

把 L1584 那句「洞的宽/x 由 shell 的固定 grid 唯一决定（1fr + 312px 侧栏）」改成与现状一致的表述（侧栏宽度暂仍为 312，T04 会改成可调），**逻辑一行都不要改**。

---

## 4. 红线

- **不许改 `spark:page-hole` 的夹取逻辑**（`b.y < 40 || b.y > 200` 这段必须保留）。
- 不许动 `SIDEBAR_W`。
- 不许删 `#btnStar`、`#back`、`#forward`、`#reload` 的 id。
- 不许把历史/书签/内存做成新的 div 假按钮——必须保留原 `<button>` 与 id。
- 不许在 `#navMenu` 里放设置入口（设置留在侧栏右上角）。
- 不许改 `src/shared/i18n.ts`。

---

## 5. 自检

```powershell
cd d:\download\sparo上架应用商店版
Select-String -Path src\renderer\shell.html -Pattern "bm-bar|bm-chip|packBookmarkBar" | Measure-Object   # 应为 0
Select-String -Path src\main\browser.ts -Pattern "CHROME_H = " | Select-Object Line                   # 应为 76
npm run typecheck && npm test
```

---

## 6. 验收（`npm run start` 自己点）

- [ ] 顶部只剩两行：标签 + 导航，总高 76px，网页明显多出一条可视区域
- [ ] 网页区顶部没有被导航栏挡住，也没有露出白条
- [ ] 网址输入、前进后退、刷新都正常
- [ ] 点 ⋯ 弹出菜单，点空白处菜单消失，再点又出现
- [ ] 菜单里「历史记录」能打开历史面板
- [ ] 菜单里「书签」能弹出书签菜单（原生菜单）
- [ ] 菜单里「页面内查找」能打开查找条，Ctrl+F 也仍然有效
- [ ] 菜单里「优化内存」能执行并给出提示
- [ ] 标签左侧有站点小图标；新开空白页显示地球图标
- [ ] 激活标签底部有一条烧赭色 2px 指示
- [ ] 窗口拉到最小时，网页区没有被压成窄条

### 截图

1. 顶部两行 Chrome 全宽特写
2. ⋯ 菜单展开特写
3. 三个标签（含 favicon）特写

---

## 7. 提交

```powershell
git add src/renderer/shell.html src/main/browser.ts
git commit -m "ui(t03): collapse chrome to two rows, drop bookmark bar, add overflow menu"
```
