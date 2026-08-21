# Sparo 人机同窗浏览器 — 完整 QA 报告

> 审查日期：2026-08-10  
> 审查范围：静态代码审查（~25+ 核心文件）+ 构建验证（typecheck / build 通过）+ 文档对照  
> 审查方式：未启动 GUI（先做静态 QA 闭环，动态 QA 后续补充）  
> 分类标准：P0 阻塞级 · P1 重要级 · P2 体验级

---

## 摘要

本次 QA 共发现 **22 个问题**：

| 等级 | 数量 | 定义 |
|:---:|:---:|---|
| **P0** | 5 | 必现功能失效 / 文档与实现不一致 / 数据安全风险 |
| **P1** | 8 | 架构可维护性 / 扩展性 / 测试覆盖 / 核心场景体验 |
| **P2** | 9 | UI 细节 / 性能优化 / 非核心工具链 |

构建与基础检查结果：

| 检查项 | 命令 | 结果 |
|---|---|---|
| TypeScript 严格类型检查 | `npm run typecheck` | ✅ 通过（strict:true） |
| Electron Vite 构建 | `npm run build` | ✅ 通过（耗时 <1s，产物 336KB+） |
| 依赖安装 | `Test-Path node_modules` | ✅ 已安装 |
| 3920 端口占用 | `netstat -ano \| findstr 3920` | ✅ 无占用（Sparo 未启动，正常） |

---

## 一、P0 阻塞级问题（5 项）

> 优先级理由：直接导致核心功能不可用、验收闭环断裂、安全防护缺失。

---

### P0-01：内置 Chat Agent 无法读取新配置字段

| 项 | 内容 |
|---|---|
| **现象** | 用户在新版设置面板填写了通用字段 `apiKey` / `baseUrl` / `model`，但侧边栏本地 Chat 始终显示"未配置"，Agent 无法启动。 |
| **根因** | `loadSettings()` 已迁移读取通用 `apiKey` 字段，但 `rebuildDeepSeek()` 仍读取旧的 `deepseekApiKey` 三个废弃字段——**load 与 save 双向不对称**。 |
| **影响范围** | 内置 Agent Provider（DeepSeek/OpenAI/Custom 三档全中），所有依赖本地 Chat 的功能（侧边栏对话、内联 Intent 解析）全挂。 |
| **定位代码** | [browser.ts L1149-L1158](file:///d:/download/Sparo/src/main/browser.ts#L1149-L1158) ← 读取废弃字段；[store.ts L75-L98](file:///d:/download/Sparo/src/main/settings/store.ts#L75-L98) ← 返回通用新字段 |
| **修复方案** | 方案 A（推荐）：把 `rebuildDeepSeek` 改为读取 `this.settings.apiKey` / `baseUrl` / `model`，按 `provider` 走预设逻辑。<br>方案 B（软兼容）：在 `loadSettings` 返回对象里同时回填 deprecated 字段（`next.deepseekApiKey = next.apiKey`）。 |
| **验证方法** | 写入 settings.json `{"provider":"deepseek","apiKey":"sk-xxx","baseUrl":"...","model":"deepseek-v4-flash"}` → 启动后侧边栏 Chat 应进入 Ready 而非"请配置 API Key"。 |

---

### P0-02：package.json 缺失验收脚本，QA 文档无法执行

| 项 | 内容 |
|---|---|
| **现象** | `.github/qa-notes/P0-fix.md` 第 16-17 行明确写了 `npm run accept:p0`（百度三项确认）和 `npm run accept:weibo`（微博连发 3 条），但 `package.json` scripts 里只有一个 `accept`，直接运行会报 `Missing script`。 |
| **根因** | 文档更新了但 package.json 脚本没同步。 |
| **影响范围** | 所有新同学按文档跑验收全部卡壳；CI 流水线挂不上回归脚本。 |
| **定位代码** | [P0-fix.md L16-L17](file:///d:/download/Sparo/.github/qa-notes/P0-fix.md#L16-L17) vs [package.json L8-L19](file:///d:/download/Sparo/package.json#L8-L19) |
| **修复方案** | 在 package.json scripts 补两条：<br>`"accept:p0": "node scripts/verify-human-shell.mjs p0"`<br>`"accept:weibo": "node scripts/verify-human-shell.mjs weibo"`<br>或映射到 scripts/ 下对应 QA 脚本的正确文件名与参数。 |
| **验证方法** | 根目录执行 `npm run accept:p0` → 脚本启动（即使因环境缺登录 fail，也不能是 Missing script）。 |

---

### P0-03：MCP HTTP 层缺失 CORS / 请求日志 / 限流 / 统一错误码

| 项 | 内容 |
|---|---|
| **现象** | `http.createServer` 裸写，三层防护全部缺失：<br>① **无 CORS 头**：第三方 Web App / IDE 插件接入会被浏览器预检拦截。<br>② **无访问日志**：谁在何时调了什么 tool、成功失败、耗时多少——**零可观测性**。<br>③ **无限速率**：恶意脚本可 1000+ req/s 打爆 `screenshot` / `fill`。<br>④ **错误码不规范**：401 直接返回纯文本 `Unauthorized`，而非 MCP 标准 JSON 错误。 |
| **根因** | MCP Server 只做了最基本的 Bearer Token 鉴权，没有中间件层。 |
| **影响范围** | 虽然绑定 `127.0.0.1` 是对的，但一旦接入 Claude Desktop Web、多进程并发 Agent、或其他本地网关——**分分钟撞墙或出问题排不了**。 |
| **定位代码** | [mcp-server.ts L523-L600](file:///d:/download/Sparo/src/main/mcp-server.ts#L523-L600) |
| **修复方案** | 1. CORS：响应头加 `Access-Control-Allow-Origin/Methods/Headers`，可配开关；<br>2. 日志：每次请求记一行 `[YYYY-MM-DD HH:mm:ss] method path status latencyMs clientIp toolName?`；<br>3. 限流：简单 Token Bucket，`Map<token, lastHit[]>`，默认 10 req/s 软上限；<br>4. 错误格式：4xx/5xx 统一 JSON `{"error":"...","mcp_error_code":"..."}`。 |
| **验证方法** | 造 OPTIONS 预检请求 → 返回 204 + CORS 头；短时间发 20 个请求 → 后 10 个 429；mcp-auth.json 拿错 token → 401 返回 JSON。 |

---

### P0-04：electron-vite 构建目标漏了 chrome.html + sidebar.html 为死文件

| 项 | 内容 |
|---|---|
| **现象** | `src/renderer/` 有三个 HTML：`shell.html` / `sidebar.html` / `chrome.html`，但 electron.vite.config.ts renderer input **只注册了 shell**。全项目 grep `sidebar.html|chrome.html` 0 处引用。两个结果：要么文件已废弃没人清理，要么多窗口 Sidebar/独立 Chrome 栏功能在构建产物中不存在。 |
| **根因** | 历史遗留文件未清理 / 构建配置未同步功能需求。 |
| **影响范围** | 新人花时间改 Sidebar 样式 → 构建后发现文件根本没进 out/renderer/ = **严重浪费工时**。 |
| **定位代码** | [electron.vite.config.ts L30-L38](file:///d:/download/Sparo/electron.vite.config.ts#L30-L38) + 全项目 grep sidebar/chrome 0 引用 |
| **修复方案** | 二选一明确决策：<br>A. **确认废弃** → 删除 `chrome.html` 和 `sidebar.html`，加注释在 shell.html 顶部说明侧边栏已内嵌。<br>B. **还要上线** → electron.vite input 补 `sidebar` / `chrome` 两条，并在 `browser.ts` 的 BrowserWindow 创建时 loadFile 对应产物。 |
| **验证方法** | `npm run build` 后 `Get-ChildItem out/renderer/` 列出的文件必须与配置一致（要么只有 shell，要么 3 个都有），不能有"源代码存在但构建产物缺失"的中间态。 |

---

### P0-05：提交按钮 qaGate + requestApproval 串行链缺超时/拒绝回滚

| 项 | 内容 |
|---|---|
| **现象** | `click()` 对含"提交/发布/保存/确认"字样的按钮自动跑：`qaGate() → requestApproval() → trustedClickAt()`。三个漏洞：<br>① **qaGate FAIL 没阻断**：只返回 `{ok:false}` 但继续往下进入审批和点击。<br>② **requestApproval 无超时**：人走开开会 = Agent 永远挂死 Promise 不 resolve。<br>③ **拒绝后无回滚**：用户点"拒绝"后页面已展开的下拉、已打开的弹窗、已填充的脏数据留在那里 = 后续所有 ref 全失效。 |
| **根因** | 把"QA 检查→人审→执行"当线性流程，没考虑分支和异常。 |
| **影响范围** | 所有发帖/提审/保存的核心 99/1 分工场景。审批卡住 = 整个工作流挂死；审批被拒 = 页面状态脏。 |
| **定位代码** | [browser.ts click() 方法内](file:///d:/download/Sparo/src/main/browser.ts#L2783-L2997) 搜索 `qaGate` / `requestApproval` 调用点 |
| **修复方案** | 1. qaGate FAIL → 直接 return，不进入审批；<br>2. requestApproval 加 300s 默认超时（可配置），超时返回 `{rejected:"timeout"}`；<br>3. 拒绝 / 超时 → 调用 `dismissOverlays()` + 清空 snapshot 缓存；<br>4. `ClickConfirm` 补 `approval: "granted" \| "rejected" \| "timeout" \| "skipped"` 字段供上游分支处理。 |
| **验证方法** | 手动在审批弹窗等待 5 分钟 → Agent 不挂死并拿到 timeout；故意点拒绝 → 页面下拉菜单关闭。 |

---

## 二、P1 重要级问题（8 项）

> 优先级理由：不立即修则维护成本指数上升、回归风险高、核心卖点（录制/Skills/跨域 iframe）质量下降。

---

### P1-01：SparkBrowser 上帝类 ~3200 行，维护性红灯

| 项 | 内容 |
|---|---|
| **现象** | `browser.ts` 单文件塞了 Tab 管理 / 布局 / navigate/click/fill/snapshot/wait_for / xhs 全家桶 / chat 解析 / sessions / recording / skills 等 **12 个方向**，字段约 40 个，方法 70+。典型症状：上次"click 删 DOM backup"的双击 bug 就是因为两条路径在同方法内串扰没隔离。 |
| **影响范围** | 任何改动回归概率极高。不符合你"改 A 不能错 B"的硬要求。 |
| **定位代码** | [browser.ts](file:///d:/download/Sparo/src/main/browser.ts) 全文 ~3200 行 |
| **修复方案** | 按职责拆 5 个类，`SparkBrowser` 做 Facade（对外 API 不变，内部 this.xxxManager.xxx()）：<br>• `TabManager` → createTab / switchTab / closeTab / activeTabId<br>• `PageDriver` → navigate / click / fill / snapshot / wait_for / execute 纯原语<br>• `XhsPublisher` → xhs_* 共 8 个方法聚合（减少 browser.ts 约 600 行）<br>• `SkillManager` → skillsCache / 录制 start_stop / matchSkills / runSkill<br>• `ChatRouter` → parseLocalIntent / handleChat / 本地 Intent 分发 |
| **验证方法** | 拆后所有 MCP 工具 handler 跑通（`accept:p0` + `xhs-longform-e2e` 通过），browser.ts 单文件 ≤ 1500 行。 |

---

### P1-02：shell.html 单文件 ~1500 行，前端零模块化

| 项 | 内容 |
|---|---|
| **现象** | shell.html 把 CSS 变量 / Grid 布局 / Chrome 栏样式 / Sidebar 样式 / Tabs 渲染 / BookmarksBar / Toast / IPC 通信 / 状态渲染 / 审批队列 UI 全部塞一个文件。约 700 行内联 `<script>`，无组件、无 TS、无模块边界。 |
| **影响范围** | 加个小按钮要上下滚 300 行找 DOM 生成逻辑。对于你追求的"高级感 UI / 叙事排版层级"，地基不合格。 |
| **定位代码** | [shell.html](file:///d:/download/Sparo/src/renderer/shell.html) 全文 |
| **修复方案** | 最小闭环（不引入新框架）：<br>① 抽出 `shell/styles.css` + `shell/app.ts`（electron-vite 自动处理 HTML 引用）；<br>② 至少拆 4 个 IIFE 模块：Tabs / ChromeBar / Sidebar（审批+状态+Chat）/ BookmarksBar，各自拿 root element，不互相直接操作 DOM；<br>③ 统一通过 `shell-preload` 暴露的 API 走 IPC，不散落 `ipcRenderer.send/on`。<br>中期迁 React + Vite + Tailwind（匹配技术栈偏好，顺手写动效/震屏反馈）。 |
| **验证方法** | shell.html ≤ 500 行，只留结构 skeleton；chrome devtools 看 source map 有独立 app.ts / styles.css。 |

---

### P1-03：缺少 ESLint / Prettier / Husky 规范链

| 项 | 内容 |
|---|---|
| **现象** | 只有 `tsc --noEmit`。观察 `tools/index.ts` 第 36-44 行 skills 相关 handler 缩进和前后不一致（同一文件内 2 格 vs 4 格混用）。`rebuildDeepSeek` 用 deprecated 字段 tsc 不报（deprecated 只是 JSDoc 注释没加 `@deprecated` 注解 + ESLint rule）。 |
| **影响范围** | 格式漂移、deprecated 调用漏网、潜在的 `any` 逃逸（strict 关了才会有，但格式乱会掩盖真问题）。 |
| **定位代码** | [tools/index.ts L36-L44](file:///d:/download/Sparo/src/main/tools/index.ts#L36-L44) 缩进错位 |
| **修复方案** | 1. 装 `eslint + @typescript-eslint/parser + @typescript-eslint/eslint-plugin + prettier + eslint-config-prettier + husky + lint-staged`；<br>2. 启用 `deprecation/deprecation` rule 抓旧字段调用；<br>3. scripts 加 `"lint": "eslint src --ext .ts --max-warnings 0"`，和 typecheck 一起在 pre-commit hook 跑；<br>4. 加 `.editorconfig` 统一缩进。 |
| **验证方法** | `npm run lint` 全 0 warning；pre-commit hook 自动 format。 |

---

### P1-04：0 单元测试（手动 QA 脚本 ≠ 自动化测试）

| 项 | 内容 |
|---|---|
| **现象** | `scripts/` 有 30+ `.mjs` 端到端 QA 脚本，但 **没有 Vitest / Mocha 任何断言框架**。纯函数（如 `cdpUtf8Expr("你好")` 是否正确？`loadSettings` 迁移 6 条路径？）全靠人肉读代码。这次 P0-01 的 deprecated 字段错配，如果有 settings 的单测根本不会漏。 |
| **影响范围** | 每次改代码人肉跑一遍浏览器 = 效率极低 + 漏测必然。 |
| **定位代码** | 无 test 目录；package.json devDependencies 无测试框架 |
| **修复方案** | 1. 装 `vitest + @vitest/coverage-v8`；<br>2. 第一批优先测纯函数（不依赖 Electron）：<br>   • `settings/store.test.ts` → loadSettings 迁移路径 / saveSettings patch / PROVIDER_PRESETS（6 条）<br>   • `cdp-frames.test.ts` → cdpUtf8Expr / urlsLooselyEqual / matchFrameOffsets（12 条）<br>   • `skills/runner.test.ts` → matchSkills 打分 / substDeep 模板 / extractBodyFromMarkdown（8 条）<br>3. 第二批测 browser.ts 拆出来的子模块；<br>4. `scripts/qa-*` 保留为 E2E，和单测分 CI 任务。 |
| **验证方法** | `npm run test` 全绿 + `coverage ≥ 70%`（首批目标，后续拉到 85%+）。 |

---

### P1-05：tools/index.ts 内联 vs 抽离模式不一致

| 项 | 内容 |
|---|---|
| **现象** | navigate/snapshot/click/fill 抽到了独立文件，但 `list_tabs / get_url / get_title / pause / resume / list_workflows` 仍在 tools/index.ts 内联实现，且 return 包装模式不统一：有的直接 `return browser.xxx()`，有的 `async () => ({ok:true,...})` 多包一层。 |
| **影响范围** | 新增工具时新人不知道跟哪种模式 = 代码风格持续漂移。 |
| **定位代码** | [tools/index.ts](file:///d:/download/Sparo/src/main/tools/index.ts) 全文 121 行 |
| **修复方案** | 和 P1-01 拆上帝类联动：全部抽离成独立小文件 `tools/list-tabs.ts`、`tools/get-url.ts` 等。每个文件暴露签名严格：`export async function xxxTool(browser: SparkBrowser, ...args): Promise<ToolResult>`。 |
| **验证方法** | tools/index.ts 只剩 import + createToolHandlers 映射，无具体业务逻辑。 |

---

### P1-06：wait_for 不支持跨域 iframe（和 snapshot refs 体系不兼容）

| 项 | 内容 |
|---|---|
| **现象** | snapshot 已支持跨域 iframe（refs 命名 `x0.e3`），但 `wait_for` 只在主文档 `wc.executeJavaScript` 查 DOM。Agent 在含 iframe 的页面上 snapshot 拿到 `x0.e5`，再 `wait_for(ref:"x0.e5")` → **永远超时**。 |
| **影响范围** | 核心四件套（navigate/snapshot/click/fill）都支持跨域 iframe，唯独 wait_for 不支持 = 含 iframe 的工作流必卡死。 |
| **定位代码** | [browser.ts L1052-L1092](file:///d:/download/Sparo/src/main/browser.ts#L1052-L1092) ← wait_for 只查主文档；对比 click/fill 的跨域路径 |
| **修复方案** | wait_for 顶部加 `parseCrossFrameRef(input.ref)`（cdp-frames.ts 有现成函数），命中跨域 ref → 走 `withDebugger + cdpEvaluate(frame.frameId, FRAME_WAIT_SCRIPT)` 路径，和 click/fill 对齐。`selector` / `text` 参数同理补 CDP 搜索。 |
| **验证方法** | 构造含 x-origin iframe 的 test fixture：snapshot 得 `x0.e1` → wait_for 200ms 内返回 ok。 |

---

### P1-07：cdpEvaluate/cdpCall 每次新建 IsolatedWorld，长时间运行内存泄漏

| 项 | 内容 |
|---|---|
| **现象** | [cdp-frames.ts L101-L104](file:///d:/download/Sparo/src/main/cdp-frames.ts#L101-L104) 和 [L146-L149](file:///d:/download/Sparo/src/main/cdp-frames.ts#L146-L149) 每次执行都 `Page.createIsolatedWorld`，worldName 带 `Date.now() + random`。理论上 frame 销毁时清理，但若单页长时间不刷新（小红书编辑页挂 30 分钟），同一个 frame 堆 **几百个孤立世界不释放**。 |
| **影响范围** | Sparo 主力场景是批量发帖 / 采集等长时间运行。内存缓慢上涨 = 用户怀疑产品泄漏。 |
| **根因** | 为了简单每次建新世界，但没做 context 复用。 |
| **修复方案** | SparkBrowser 加 `isolatedWorldCache: Map<frameId, {contextId, createdAt}>`，首次 create 后缓存；navigate 后清空对应 frameId 的 cache；超过 10 分钟强制重建（避免 context 被 GC 搞出悬垂）。 |
| **验证方法** | 同一 frame 连续跑 500 次 cdpCall → DevTools Performance memory 曲线无阶梯上涨（应持平或小幅波动）。 |

---

### P1-08：录制 Skill 在 SPA 路由跳转后 ref 失效，无降级映射策略

| 项 | 内容 |
|---|---|
| **现象** | `start_recording → 用户点导航 → SPA 切 /next → stop_recording`，保存的 Skill step 是 `{tool:"click", params:{ref:"e15"}}`。但下次 replay 时同一页面 ref 是 snapshot 重新编号的，e15 根本不是同一元素。**当前录制时没有同步存 selector / text / ariaLabel 等冗余字段做降级**。 |
| **影响范围** | Sparo 差异化卖点"一招鲜（录制+复用 Skills）"的 SPA 重放成功率极低 = 卖点是坏的。 |
| **定位代码** | recording 相关方法在 [browser.ts](file:///d:/download/Sparo/src/main/browser.ts) 搜 `startRecording` / `stopRecording`；对比 skills runner 的重放逻辑 |
| **修复方案** | 录制每个 step 多存 3 份冗余：① `cssPath`（FRAME_COLLECT_SCRIPT 里已有逻辑）；② `innerText`（给 click_text 兜底）；③ `ariaLabel/placeholder`。Replay 时优先级：ref → selector → click_text → analyze_page + fuzzy match，前一级失败自动降级后一级。 |
| **验证方法** | 录一个含 3 次 SPA 路由跳转的 Skill（如小红书草稿箱→编辑页→发布页）→ 重启后重放成功率 ≥ 80%。 |

---

## 三、P2 体验级问题（9 项）

> 优先级理由：不阻塞主流程，但显著影响长期使用体验 / 性能 / 专业感。

| ID | 现象 | 定位 | 建议 |
|:---:|---|---|---|
| **P2-01** | 缺少暗/亮主题切换，硬编码浅色变量 `--bg: #fafafa` 等。夜间对眼睛不友好。 | [shell.html](file:///d:/download/Sparo/src/renderer/shell.html) 搜 `:root` / `--bg` | 加 `@media (prefers-color-scheme: dark)` 自动检测；侧边栏补 toggle；主题存 settings.json `theme` 字段。 |
| **P2-02** | UI 字符串中英混排（"Agent paused" vs "审批队列"），无 i18n 机制。 | shell.html 内联字符串 + browser.ts pushStatus 消息 | 抽 `locales/{zh-CN,en-US}.json`；启动按系统 `app.getLocale()` 选；settings 可手动切换。 |
| **P2-03** | `trustedClickAt` 不支持双击 / 右键 / 拖拽；且 mousedown-mouseup **无间隔**，部分现代 UI 框架（检查按下持续时间）会不触发。 | [browser.ts L1940-L1966](file:///d:/download/Sparo/src/main/browser.ts#L1940-L1966) | 加 opts `{doubleClick?:boolean, button?:"left"\|"right", downDelayMs?:number}`；默认 downDelayMs=30。另补 `trustedDragAt(from, to)`。 |
| **P2-04** | 审批队列 `approvals: Map` 无过期清理。人不操作会无限堆积，重启前旧审批永远挂在 Sidebar 顶。 | browser.ts approvals 字段 + Sidebar 渲染逻辑 | requestApproval 超时 / 拒绝时从 Map delete；Sidebar 渲染加"过期 N 分钟"角标；启动时清空 approvals。 |
| **P2-05** | Skills 列表无搜索 / 分页 / 排序，超过 20 条就难翻；用户录满后找妙招等于大海捞针。 | `skills/store.ts` listSkills 返回全数组；shell.html Sidebar skills 渲染 | listSkills 支持 `{query?, sortBy?:"updatedAt"\|"successRate", limit?, offset?}`；Sidebar 补搜索框 + 排序下拉。 |
| **P2-06** | 书签栏溢出无滚动 / 折叠，硬撑宽度会挤压标签栏或换行破坏布局。 | shell.html `.bm-bar` CSS | `.bm-bar { overflow-x: auto; scrollbar-width: thin; }`；尾部加 "⋯" 下拉菜单收纳溢出项（Chrome 同款）。 |
| **P2-07** | `withDebugger` 每次调用都 attach→detach CDP，高频 click 场景和浏览器抢 debugger 锁，偶发 `Another debugger is already attached`。 | [cdp-frames.ts L31-L63](file:///d:/download/Sparo/src/main/cdp-frames.ts#L31-L63) | SparkBrowser 构造时 attach 一次 debugger，记 `debuggerAttached:true`，全局复用；app quit 时统一 detach；Target.setAutoAttach 初始化时开一次即可。 |
| **P2-08** | `mcp-auth.json` token 永不轮换。一旦泄漏（拷贝了 config 目录、被恶意脚本读了文件）= 永久后门。 | mcp-server.ts token 生成逻辑 | 加环境变量 `SPARO_MCP_TOKEN_TTL`（单位秒，默认 0=永不过期兼容现有）；到点重签 token 并原子写入 mcp-auth.json；token 格式加前缀 `sp1_` 方便将来迁移 / 审计。 |
| **P2-09** | `contains_text` / `page_text` 和 wait_for 同病：**只查主文档**，不合并跨域 iframe 文本。页面含 iframe 时文本检查漏判。 | browser.ts containsText / pageText 方法 | 复用 snapshot 的 CDP 跨域路径，合并所有 frame 的 body.innerText 返回。 |

---

## 四、落地路线图（按"地基 → 框架 → 装修"的 7 步任务书）

> 适配你的工作流：分步开发 · 每步交付验证 · 最小闭环 · TDD 优先

| Step | 名称 | 对应问题 | 预估工作量 | 交付物 | 验收标准 |
|:---:|---|---|:---:|---|---|
| **Step 1** | **修 P0 小闭环**（P0-01/02/04） | P0-01 deprecated 字段；P0-02 scripts 缺失；P0-04 死文件 / 构建漏页 | 0.5 天 | 1 个 commit；跑 typecheck + build | `npm run accept:p0` 不 Missing script；settings.json 填 apiKey 后 Chat Ready；构建产物与源码文件数一致 |
| **Step 2** | **P0 安全加固**（P0-03 MCP 中间件） | P0-03 CORS + 日志 + 限流 + 错误码 | 1 天 | 新增 `src/main/mcp-security.ts`；Vitest 单测 5 条 | OPTIONS 预检通过；100 请求/秒触发 429；日志文件可 grep |
| **Step 3** | **P0 审批链完善**（P0-05） | P0-05 qaGate 阻断 + 审批超时 + 回滚 | 0.5 天 | browser.ts click 方法改造；`ClickConfirm` 类型补字段 | qaGate FAIL 不进入审批；5 分钟不操作自动 timeout；拒绝后 overlay 关闭 |
| **Step 4** | **打地基：代码规范 + 首批单测**（P1-03/04） | P1-03 ESLint/Prettier/Husky；P1-04 纯函数单测 | 1 天 | .eslintrc / .prettierrc / husky hook；test/ 首批 26 条用例 | `npm run lint` 零 warning；`npm run test` 全绿；coverage ≥ 65% |
| **Step 5** | **拆框架：上帝类 + Tools 一致化**（P1-01/05） | P1-01 browser.ts 拆 5 模块；P1-05 tools 全抽离 | 2 天 | 5 个新子模块文件；tools/ 12 个独立文件 | 对外 API 0 变化；`accept:p0` + `xhs-longform-e2e` 全通过；browser.ts ≤ 1500 行 |
| **Step 6** | **补能力：跨域 + 缓存 + Skills**（P1-06/07/08） | P1-06 wait_for 跨域；P1-07 IsolatedWorld 缓存；P1-08 录制冗余降级 | 1.5 天 | wait_for 跨域实现；IsolatedWorld Map；recording step 冗余字段 | x-origin iframe fixture wait_for 200ms ok；500 cdpCall 内存无阶梯上涨；SPA Skill 重放 ≥ 80% |
| **Step 7** | **装修：P2 挑 3-5 项**（建议 P2-01 / P2-03 / P2-05 / P2-07 / P2-09） | 主题；trustedClickAt 间隔；Skills 搜索；CDP 长连；contains_text 跨域 | 1.5 天 | 主题切换 + Sidebar toggle；trustedClickAt opts；Skills 搜索；CDP 复用；文本合并 | 主题切换 CSS 变量无闪烁；双击/右键能触发；Skills 搜关键字秒出结果 |

**总计约：8 个工作日** 完成所有 P0 + P1 + 精选 P2。

---

## 五、风险备注（动态 QA 待补）

本次报告基于**静态代码审查**，以下项目需启动 Sparo GUI 后补做动态验证（建议另开 `QA-DYNAMIC-R3.md`）：

1. **小红书端到端**：跑 `scripts/xhs-longform-e2e-v3.mjs`，验证 10 步全流程无 ref 失效、正文注入无乱码、封面/话题可点。
2. **跨域 iframe 点击**：用 `verify-portal-menu` 脚本测 Ant Design + Element UI 两套 Portal 下拉。
3. **微博连发**：`accept:weibo` 真实账号跑 3 条，验证时间线 + contains_text 回读。
4. **文件上传**：`verify-upload` 脚本 + 真实图片 10 张，验证 CDP setInputFiles。
5. **下拉组合**：`verify-select-combo` 覆盖原生 select + Antd Select + combobox 三类。
6. **人机同窗 Pause/Resume**：Agent 跑一半按暂停，手动改 DOM，resume 后 snapshot 能否正确感知变化。

---

*— End of Report —*
