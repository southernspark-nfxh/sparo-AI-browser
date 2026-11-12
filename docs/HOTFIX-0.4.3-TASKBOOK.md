# v0.4.3 Hotfix 任务书：白屏修复 + 侧栏新标签自动切焦点

> **发给谁**：任何一个 Cursor 窗口（只需一个，两个问题都在 browser.ts 里改）
> **工作目录**：`D:/download/sparo上架应用商店版`
> **分支**：master，HEAD `d3ef576`，tag `v0.4.2`
> **基线**：`npm test` 120 files / 900 tests 全绿；`npm run typecheck` 退出码 0；`npm run lint` 0 error
> **不许碰**：`package.json` 版本号、`docs/listings/`、`free-soul.ts` 的系统提示（v0.4.2 合的两段多窗口提示已就位）、`intent-router.ts` 的路由决策逻辑、现有 `stealBlocked` / `clientOwnsWindow` 任何一处调用

---

## 真机问题清单

### P1：网页切换偶发白屏

**用户描述**：标签之间切换时，新标签有时候会白屏——地址栏、标签栏都有，只有网页内容区白。重点地址栏刷新一下才恢复。

**根因定位**：

`src/main/browser.ts` 的 `wakeTab()` 里：

```typescript
void view.webContents.loadURL(normalizeUrl(tab.url || DEFAULT_URL));
```

是 fire-and-forget，不等待 load 完成就 return。`switchTab()` 紧接着 `layout()` + `focusActivePage()` + `pushChromeState()` —— 壳层 chrome（地址栏/标签栏）同步画好了，但 WebContentsView 里的内容还在加载中，中间有个空白窗口期。

登记的两秒守卫（`assertChromeHole` 每 2 秒查覆盖几何）不查 `webContents` 是不是还在 loading，所以白屏期间 guard 不会触发。

**修法**：

#### 改动 1 — wakeTab() 补 ready-to-show 触发 chrome guard

文件：`src/main/browser.ts`

在 `wakeTab()` 函数里，`loadURL` 之后追加：

```typescript
void view.webContents.loadURL(normalizeUrl(tab.url || DEFAULT_URL));
view.webContents.once('ready-to-show', () => {
  // 只在标签仍属活跃时补排，避免已切走时触发无意义 layout
  if (this.activeTabId === tab.id) this.armChromeGuard();
});
```

#### 改动 2 — switchTab() 对 discarded 标签延迟推状态

文件：`src/main/browser.ts`

找到 `switchTab(id: string): ToolResult` 方法（约 line 2100），改 `resetChromeCoverState()` 之后的逻辑：

```typescript
switchTab(id: string): ToolResult {
  if (!this.tabs.has(id)) return { ok: false, message: `Tab not found: ${id}` };
  const tab = this.tabs.get(id);
  const wasDiscarded = tab?.discarded === true;

  this.resetChromeCoverState();
  this.wakeTab(id);
  this.activeTabId = id;
  if (tab) tab.lastActiveAt = Date.now();
  this.lastSnapshot = null;
  this.layout();
  this.focusActivePage();

  if (wasDiscarded && tab?.view?.webContents && !tab.view.webContents.isDestroyed()) {
    const wc = tab.view.webContents;
    // 等内容开始加载再推状态，避免壳层先画、内容还没回来
    const pushOnStart = () => {
      this.pushChromeState();
      this.pushSidebarState();
    };
    const pushOnDone = () => {
      this.pushChromeState();
      this.requestHoleReport();
      this.pushSidebarState();
    };
    wc.once('did-start-loading', pushOnStart);
    wc.once('did-finish-load', pushOnDone);
  } else {
    this.pushChromeState();
    this.requestHoleReport();
    this.pushSidebarState();
  }

  return { ok: true, message: `Switched to tab ${id}`, data: this.listTabs() };
}
```

### P2：侧栏开新标签不自动切过去

**用户描述**：侧栏输入"帮我跳转某网页" → 新标签开了 → 用户还停在原标签 → 必须手动点新标签切过去。这不符合习惯。

**根因定位**：

`createAgentTab()` 传 `activate=false`，新标签 `activeTabId` 不变。

- `src/main/browser.ts` line 1258：`createAgentTab()` 硬编码 `activate=false`
- `src/main/agent/mcp-sessions.ts` line 174-198：`bindClientTab()` 对 SIDEBAR_CLIENT_ID 调 `createAgentTab(url)` 不传 activate

v0.4.2 多窗口护栏故意设计"后台 agent 不抢用户焦点"是对的，但 **SIDEBAR_CLIENT_ID（侧栏唯一活跃时）开的目标页应该让用户看到**。关键区分：

| 场景 | activate |
|---|---|
| 后台 agent（非 sidebar client）跑任务中开的中间标签 | false |
| SIDEBAR_CLIENT_ID 唯一活跃时的新标签 | **true** |
| 多 agent 并行时（clientWindows 有 >= 2 个 clientId 绑同一扇窗） | false |

**修法**：

#### 改动 3 — createAgentTab 加可选 activate 参数（默认 false）

文件：`src/main/browser.ts`

找到 `createAgentTab(url?: string): string` 方法（约 line 1257），改为：

```typescript
/** 开一个后台标签。activate=false 时 activeTabId 保持不变，不抢焦点。关闭渲染节流，最小化时定时器照跑。 */
createAgentTab(url?: string, activate = false): string {
  const target = url && url.trim() ? url : DEFAULT_URL;
  return this.createTab(target, activate, { agentOwned: true });
}
```

#### 改动 4 — bindClientTab 判断是否自动切

文件：`src/main/agent/mcp-sessions.ts`

找到 `bindClientTab()` 函数（约 line 174），在调用 `createAgentTab()` 时加 activate 逻辑。伪代码：

```
function bindClientTab(clientId, winId, fallbackUrl):
  // 已有 client 绑定的 tab 没被占用 → 复用（现有逻辑不动）
  // 否则需要新建

  const isSidebar = (clientId === SIDEBAR_CLIENT_ID)
  // 查 clientWindows 里同扇窗还有没有别的活跃 client
  // clientWindows 是 Map<clientId, winId>，在 browser.ts 上
  // 通过 this.getOwnerWinIds() 或类似 getter 查
  const othersOnSameWin = [...clientWindows.entries()]
    .filter(([cid, wid]) => wid === winId && cid !== clientId)
  const activate = isSidebar && othersOnSameWin.length === 0

  return this.createAgentTab(fallbackUrl, activate)
```

如果 `mcp-sessions.ts` 没有直接访问 `clientWindows` 的路径，加一个 getter 到 browser.ts：

```typescript
/** 当前绑定到指定窗口的 agent clientId 集合。用于判断侧边栏是否独占焦点资格。 */
getClientsOnWindow(winId: string): Set<string> {
  const set = new Set<string>();
  for (const [cid, wid] of this.clientWindows) {
    if (wid === winId) set.add(cid);
  }
  return set;
}
```

---

## 验证清单

### 必须过

- [ ] `npm run typecheck` 退出码 0（tsc --noEmit）
- [ ] `npm test` 全量 120 files / 900 tests 全绿（不引入新失败）
- [ ] `npm run lint` 0 error（19 条原有 warning 豁免）
- [ ] `npm run build` electron-vite build 过

### 真机（改完后发给主合码窗口前先自查）

- [ ] 反复在 5+ 张标签之间切换，discarded 的醒过来不白屏
- [ ] 侧栏输入"帮我打开 https://github.com" → 新标签自动切过去
- [ ] 开两扇窗各跑 agent → 各自开标签不互相抢
- [ ] 后台 agent 跑任务中开的中间标签 → 仍保持静默不抢焦点

---

## 交付格式

贴以下内容：

```text
=== git diff --stat ===
（文件列表 + 增删行数）

=== npm test ===
（最后 10 行，含 Test Files / Tests 计数 + EXITCODE=）

=== npm run typecheck ===
EXITCODE=

=== npm run lint ===
（0 error 确认）

=== 关键改动说明 ===
- wakeTab: ...
- switchTab: ...
- createAgentTab: ...
- bindClientTab: ...
```

---

## 绝对禁止

1. 不动 `package.json` 的 `version` 字段
2. 不改 `intent-router.ts` 的 `agentShouldOpenOwnSurface` 路由判断（路由不动，改执行层 activate 参数）
3. 不删任何一处现有的 `stealBlocked()` 或 `clientOwnsWindow()` 调用
4. 不碰 `docs/listings/` 目录
5. 不为让测试过而放宽校验（比如删掉某个 assert）
6. 不碰 `free-soul.ts` 的系统提示文本
7. 不打包、不打 tag、不动 origin 远程
