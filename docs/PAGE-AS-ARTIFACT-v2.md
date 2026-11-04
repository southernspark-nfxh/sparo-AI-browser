# Sparo · 网页即产物（Page as Artifact）可落地方案

> 版本 v2.0 · 2026-11-04
> 基：方沫 v0.1 构想 + 当前 Sparo 架构对齐
> 状态：P0 可开工，P1/P2 分期，技能市场为 v2 架构升级

---

## 零、一句话

**在 Sparo 里说一句话，AI 给你做出一个能看、能点、能导出成视频的网页——而且你全程看着它做。**

不是"生成图片"，不是"生成视频"，是**生成一个活的页面**，然后由 Sparo 自己把它录下来。

---

## 一、先看现状：Sparo 已经有什么、缺什么

方沫的洞察没错：svganimate 没视频生成技术，就是 LLM 写 HTML + 浏览器录自己。Sparo 作为 Electron 浏览器，天然碾压它。

但方沫的构想稿没对 Sparo 现有架构做落地分析。先把账算清：

### Sparo 已有的（可以直接复用）

| 能力 | 位置 | 能做什么 |
|---|---|---|
| LLM 调用链 | `agent/deepseek.ts` + `kernel/reasoner.ts` | 让模型生成任意文本（包括 HTML） |
| HTML 落盘能力 | `agent/report-html.ts` 的 `writeHtmlReport` | 把生成的 HTML 写到 `%APPDATA%\sparo-store\reports\` |
| Electron 渲染能力 | 主进程 + 隐藏 BrowserWindow/BrowserView | 加载任意 HTML，监听 `did-finish-load` |
| 截图能力 | `browser.ts` 的截图链路（`save_shot`） | 已经能 `webContents.capturePage()` |
| 技能包体系 | `strategies/skills/*.json` + `skills/runner.ts` + `skills/store.ts` | `run_skill` 执行步骤、`match_skill` 匹配、`seedBundledSkills` 开机注入 |
| 点数计费 | `CLOUD-SUBSCRIPTION.md` 描述的计量体系 | 已有按调用计费的基础设施 |
| 产物目录 | `%APPDATA%\sparo-store\`（reports/、skills/、captures/） | 可以新增 `artifacts/` 子目录 |

### Sparo 没有的（artifact 必须新建）

| 能力 | 性质 |
|---|---|
| **代码型 skill 加载器** | 现有 skill 全是 JSON 步骤/规则手册，没有能加载一段 TS/JS 代码的机制。artifact 的 capture/export 逻辑必须跑在 Node/Electron 环境里，LLM 写不出来。这是**技能市场架构升级的根本原因**。 |
| **HTML 质量自检** | 生成的动画 HTML 可能白屏、canvas 没像素、动画不跑。需要自动截图 + 像素变化检测，不行就重试或降级。 |
| **逐帧录制管线** | `beginFrameSubscription` + `MediaRecorder` / `capturePage` 序列 → 需要自己搭，现有截图是单张。 |
| **视频编码** | webm → mp4 → gif 的编码链路。Electron 有 MediaRecorder 但格式转换需要 ffmpeg（Node 子进程调用或 wasm 方案）。 |
| **artifact intent 路由** | `intent-router.ts` 的 `RoutedAction` 里没有 artifact 类型。`routeUserGoal` 里也没有匹配"做视频/做动画/生成网页"这类口令的正则。 |
| **artifact cap 注册** | `caps.ts` 的 `CAP_REGISTRY` 里没有让 reasoner 调用 artifact 的能力项。 |
| **新的 MCP/sidechat 工具** | 外部 agent 通过 MCP 调用 artifact 需要 `generate_artifact` / `list_artifacts` / `export_artifact` 等新 tool。 |

---

## 二、方案总览：两条线并行

```
主线 A：artifact 功能落地（为当前 Sparo 增值）
   └─ 复用现有 LLM 调用 + HTML 落盘 + Electron 渲染
   └─ 新建 capture / export 管线
   └─ 进 intent 路由 + cap 注册
   └─ 做成第一个「代码型 skill」

主线 B：技能插件架构升级（为技能市场铺路）
   └─ 把现有 JSON skill 体系升级为支持两种 skill：
      1. 步骤型 skill（现有 JSON 格式，兼容不变）
      2. 代码型 skill（npm package 格式，有 manifest.json + 入口 JS）
   └─ 实现 skill 的 install / uninstall / upgrade
   └─ artifact 作为第一个代码型 skill 落地，验证插件架构
```

**为什么不能等技能市场架构先做好再做 artifact？** 因为 artifact 本身就是第一个需要代码能力的 skill，它逼着我们升级架构。两者必须同步设计，但实施顺序是：先在主进程里硬挂 artifact 跑通 P0，再把它抽成标准代码型 skill 包，最后开放 skill 安装接口。

---

## 三、artifact 具体实施（主线 A）

### 3.1 模块位置

```
src/main/agent/artifact/
   ├─ types.ts          // ArtifactSpec（分镜、场景、时长、风格）
   ├─ generate.ts       // 调 LLM 生成单文件 HTML（含动画/画布）
   ├─ render.ts         // 隐藏 BrowserView 加载，等 did-finish-load + 首帧检测
   ├─ verify.ts         // 自检：截图 + canvas 像素变化检测，失败重试/降级
   ├─ capture.ts        // 逐帧 capturePage 或 MediaRecorder
   ├─ export.ts         // webm / mp4 / gif / 单文件 HTML 四种导出
   └─ index.ts          // 统一入口：generateArtifact() → 产物落盘 → 返回元数据
```

**产物目录：** `%APPDATA%\sparo-store\artifacts\<artifact-id>\`
```
<artifact-id>/
   ├─ artifact.json        // 元数据：title, scenes[], duration, createdAt, costPoints
   ├─ page.html            // 单文件 HTML 产物（活的网页）
   ├─ video.webm           // 视频（P0 只有 webm）
   ├─ video.mp4            // P1 才有
   └─ preview.gif          // P1 才有
```

### 3.2 进 Sparo 架构的四个接入点

#### 接入点 1：intent-router 新增 artifact 路由

在 `intent-router.ts` 的 `RoutedAction` 加一项：

```typescript
| { type: "artifact"; spec: ArtifactSpec }
```

在 `routeUserGoal` 里加正则检测：

```typescript
const ARTIFACT_RE = /做(个|一)?(视频|动画|动效|gif|视频介绍|产品介绍)|生成(一个|个)?(网页|页面).*(动画|能看|能动)|录制.*(网页|页面)|网页.*(视频|动画).*(录|做)/;
```

匹配到就调 `parseArtifactQuery` 函数把自然语言拆成 `ArtifactSpec`：

```typescript
type ArtifactSpec = {
  title: string;           // 从用户话里抽，或者 LLM 润色
  durationSec: number;     // 默认 10 秒，用户说"30秒"就取 30
  scenes: number;          // P0 固定 1，P1 才支持多场景
  style?: string;          // "简约科技风" / "卡通插画" / 用户没说就由 LLM 定
  voiceover?: string;      // P1 才有，P0 为 undefined
  sourceUrl?: string;      // P2 场景 C 才用（AI 驱动真实网页录制）
};
```

#### 接入点 2：caps.ts 注册 artifact cap

```typescript
{ id: "artifact", covers: ["artifact"], when: "用户要做视频、动画、能导出的页面" }
```

#### 接入点 3：新的 agent tool

在 agent 的工具列表里新增（跟 `report_html`、`run_skill` 并列）：

```typescript
generate_artifact({ title, durationSec, style? }) → { ok, artifactId, htmlPath, videoPath }
```

这个 tool 的实现就是 `artifact/index.ts` 的 `generateArtifact()`。

#### 接入点 4：MCP 侧暴露给外部 agent

在 MCP server 里新增三个 tool：
- `generate_artifact` — 侧栏对话路径调用
- `list_artifacts` — 列出本地所有产物
- `open_artifact` — 在 Sparo 窗口里打开某个产物（预览 HTML 或播放视频）

### 3.3 HTML 生成 —— 给 LLM 的系统提示模板

这是最关键的质量护栏。不能让模型瞎写 HTML，必须有严格的提示模板：

```
你是 Sparo Artifact Generator。你的任务是生成一个**单文件、自包含**的 HTML 文档。

硬性要求：
1. 所有 CSS 写在 <style> 标签里，所有 JS 写在 <script> 标签里，**绝对不许引用外部 CDN 或远程图片**（录制时会断网）
2. 必须包含一个 <canvas id="stage" width="1280" height="720"> 作为动画主舞台
3. 动画必须在 HTML 加载后 2 秒内**自动开始**，并且在 <用户指定时长> 秒后**自动停止**（停止后保持最后一帧 3 秒再结束）
4. 使用 requestAnimationFrame 做动画循环，setTimeout 控制时长
5. 必须声明 <!doctype html>、<html>、<head>、<meta charset="utf-8">、<meta name="viewport" content="width=device-width, initial-scale=1">
6. 字体用系统栈：-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei"
7. 配色从以下调色板里选一个：简约科技风（#1a1a2e 底 + #16213e + #0f3460 + #e94560 强调）/ 温暖插画风（#fff5f0 底 + #ffb4a2 + #e5989b + #b5838d）/ 极简黑白风（#000 底 + #fff + #f0f0f0）
8. 内容围绕：<用户描述>

禁止：
- 不许写 fetch()、XMLHttpRequest、WebSocket
- 不许引用 https:// 开头的任何资源
- 不许写 window.open()、alert()、confirm()
- 不许用 setTimeout 之外的定时逻辑做动画
- 任何 <img> 标签必须用内联 base64 data: URI（如果需要图片）

输出：只输出完整的 HTML 文档，不要任何解释文字、markdown 代码块标记、前言或后语。
```

### 3.4 质量护栏

```
LLM 生成 HTML
   ↓ 落盘 page.html
   ↓ 隐藏 BrowserView 加载（offscreen 渲染，不抢前台）
   ↓ 监听 did-finish-load → 等 2 秒（让 requestAnimationFrame 跑起来）
   ↓ capturePage 截第一张 PNG
   ↓ 再等 0.5 秒，截第二张 PNG
   ↓ 像素级 diff（用 sharp 或纯 Node.js 对比）
   ├─ 两张完全相同 → canvas 没在动 → 失败：重试最多 2 次，提示模型"canvas 动起来"
   ├─ 两张有差异 → 动画在跑 → 进入录制
   └─ 截图全黑/全白 → 白屏 → 失败：重试最多 2 次；还不行就降级为静态 HTML + 截图合成 gif
```

重试 prompt 变体（让模型换个写法）：

```
上一版 HTML 的 canvas 没有产生动画效果。请换一种实现方式：
- 用纯 DOM + CSS @keyframes 而不是 canvas 2D API，或
- 确保 canvas.getContext('2d') 的循环真的在画不同内容
- 简化动画逻辑，不要用复杂的物理引擎或粒子系统
```

### 3.5 录制管线（P0 推荐方案）

**P0：`beginFrameSubscription` + 直接写盘**

```typescript
// Electron 主进程侧
const view = new BrowserView({ webPreferences: { offscreen: false } });
view.webContents.loadFile(pathHtml);
// 等 did-finish-load + 首帧检测通过后：
view.webContents.beginFrameSubscription((frameBuffer) => {
  // frameBuffer 是 Buffer，直接写 PNG 或喂编码器
  // 每帧加时间戳，durationSec 到了就 stop + 编码
}, [0, 0, 1280, 720]); // crop rect
```

> ⚠️ 这里有个技术坑：`beginFrameSubscription` 在部分 Electron 版本里拿到的是 raw buffer，需要自己封装成 PNG 或直接喂 ffmpeg 的 stdin。建议 P0 先用单帧 `capturePage()` 逐帧截（慢但稳），等跑通了再切 `beginFrameSubscription` 提效。

**折中方案（P0 实际落地顺序）：**
```
P0-a: capturePage() 逐帧截 → PNG 序列 → ffmpeg 合成 webm（稳但慢，10 秒视频约 300 帧 × ~100ms = 30 秒）
P0-b: beginFrameSubscription → 直接编码（快，等 P0-a 跑通再切）
P1:   MediaRecorder + canvas 中转（实时录制）
P2:   逐帧离线模式（慢速动画也能秒出高画质）
```

### 3.6 编码方案

| 阶段 | 方案 | 说明 |
|---|---|---|
| P0 | ffmpeg 作为系统依赖（`child_process.execFileSync('ffmpeg', ...)`） | 编码 PNG 序列 → webm。用户机器没 ffmpeg 就提示安装，或降级为只输出 PNG 序列（每帧一个文件，在 Sparo 窗口里打开展示） |
| P1 | @ffmpeg/ffmpeg wasm 或内置 ffmpeg-static npm 包 | 打包进安装包，用户零依赖 |
| P2 | 完整 ffmpeg-static，支持 mp4/gif/多场景拼接 | |

**ffmpeg-static 包体积约 80MB**，需要评估安装包体积影响。微软商店版可能需要单独策略。

### 3.7 计费与渠道边界

| 渠道 | artifact 可用性 | 计费 |
|---|---|---|
| BYOK（用户自带 Key） | ✅ 可用 | 只收"录制编码"点数（几乎为零），LLM 调用免费 |
| 云订阅版 | ✅ 可用 | 生成按 LLM 调用计，录制编码按场景数计 |
| 微软商店版（STORE_CHANNEL=msft） | ✅ 可用（不暴露价格 UI） | 点数体系同上，但商店版用户看不到任何购买入口 |
| 企业版/离线版 | ❌ 默认不开启 | 需要单独 license 解锁 |

**点数消耗估算：**
- 生成单场景 HTML：~2000-4000 token 输入 + ~1500-3000 token 输出 → 约 0.01-0.03 美元成本
- 录制 10 秒 720p 视频：CPU 密集，token 无关。定价建议 5-10 点数/次（纯利润）
- TTS 配音（P1）：按字数，约 1 点数/500 字

### 3.8 质量护栏登记到 DECISION-POINTS.md

artifact 有三条会影响后续产品走向的本地判断，必须先登记再合码：

| # | 决策点 | 本地判断 | 理由 |
|---|---|---|---|
| DP-A | LLM 生成 HTML 白屏/不动时的降级路径 | 重试 2 次 → 降级为静态 HTML + 截图合成 gif → 仍失败则返回纯 HTML（让用户自己看） | 不能让用户等了 10 秒拿到一个什么都没有的产物，必须有保底 |
| DP-B | ffmpeg 不可用时的降级 | 跳过编码步骤，只落盘 PNG 帧序列，在 Sparo 窗口里用 image-sequence viewer 展示 | 不能强依赖外部系统；Electron 有文件系统，总能用一种方式交付 |
| DP-C | artifact intent 匹配的边界 | 只有用户明确说"做视频/做动画/生成能动的网页/录成视频"才触发；只说"帮我写个介绍文档"走 report-html，不走 artifact | 不能抢 report-html 的活儿，否则模型写文档时会被拉进一个完全不需要的渲染流程 |

---

## 四、技能插件架构升级（主线 B）

artifact 要代码能力，逼我们把 skill 体系从"纯 JSON 步骤"升级为"JSON 步骤 + 代码插件"双轨制。

### 4.1 为什么现有 JSON skill 不够

现有 skill 的 `steps` 数组能表达的动作是有限的：`navigate`、`click`、`fill`、`wait_for`、`page_text`……这些都是对 Sparo 浏览器窗口的操作。

artifact 需要的能力是：
- 生成一段可执行代码（让 Electron 渲染）
- 管理隐藏 BrowserView 的生命周期
- 调用 `beginFrameSubscription` 或 `capturePage`
- 写 PNG 序列、调用 ffmpeg 编码
- 这些**全在 Node.js/Electron 主进程里跑，跟浏览器窗口无关**

纯 JSON 装不下这些逻辑。我们需要一个能执行代码的 skill 包格式。

### 4.2 技能包 v2 格式

**两种 skill，一个 manifest 格式：**

```typescript
// 步骤型 skill（现有格式，完全兼容，不需要升级）
type StepSkill = {
  id: string;
  title: string;
  kind: "step";              // 新增字段，显式声明类型
  intent: string;
  source: "seeded" | "taught" | "market";
  steps: SkillStep[];        // 现有格式不变
  // ... 其余字段同现有 SKILL-FORMAT.md
};

// 代码型 skill（新增格式）
type CodeSkill = {
  id: string;
  title: string;
  kind: "code";              // 新增字段
  version: string;
  author: string;            // 市场用
  description: string;
  intent: string;             // 什么时候触发
  params: Record<string, ParamDef>; // 入参 schema
  entry: string;             // "dist/index.js"（从 skill 包根目录起的相对路径）
  hooks?: {
    onInstall?: string;      // "dist/hooks/install.js"
    onUninstall?: string;
  };
  requires?: {
    electron?: boolean;      // 是否需要 Electron API
    ffmpeg?: boolean;        // 是否需要 ffmpeg
    nodeVersion?: string;    // 最低 Node 版本
  };
  shareable: true;
  price?: {                  // 市场用
    pointsPerRun?: number;   // 按次计费
    subscription?: number;  // 订阅点数
  };
};
```

**代码型 skill 的目录结构：**

```
artifact-skill/                           // npm 包名，对应 skill id
   ├─ package.json                        // npm 标准
   ├─ skill.manifest.json                 // ← Sparo 识别的 manifest
   ├─ src/
   │   ├─ index.ts                        // 入口：必须 export async function run(ctx, params)
   │   ├─ generate.ts
   │   ├─ capture.ts
   │   └─ export.ts
   └─ dist/                               // 编译后的 JS
       ├─ index.js
       ├─ generate.js
       ├─ capture.js
       └─ export.js
```

**`skill.manifest.json` 必须提供的 run 函数签名：**

```typescript
// 入口函数（skill 运行时调用）
export async function run(
  ctx: SkillContext,
  params: Record<string, unknown>
): Promise<SkillResult>;

type SkillContext = {
  configDir: string;          // %APPDATA%\sparo-store
  browser?: SkillBrowser;     // 浏览器操作能力（artifact 可能不需要）
  logger: (msg: string) => void;
  emitProgress?: (pct: number, msg: string) => void;
};

type SkillResult = {
  ok: boolean;
  message: string;
  artifacts?: Array<{ path: string; kind: "html" | "video" | "image" | "other" }>;
  costPoints?: number;
};
```

### 4.3 Skill 运行时改造

**改造目标：** 让 `skills/runner.ts` 同时支持 step skill 和 code skill。

```typescript
// 伪代码，不是最终实现
export async function runSkill(
  browser: SkillBrowser,
  configDir: string,
  input: { id?: string; query?: string; params?: Record<string, unknown>; dryRun?: boolean }
): Promise<ToolResult> {
  const skill = resolveSkillStrict(configDir, key);

  if (skill.kind === "code") {
    // 代码型 skill：动态加载 JS 包
    return runCodeSkill(configDir, skill, input.params || {}, input.dryRun);
  }

  if (skill.kind === "step" || !skill.kind) {
    // 步骤型 skill（默认，向后兼容）
    return runStepSkill(browser, configDir, skill, input);
  }
}

async function runCodeSkill(
  configDir: string,
  skill: CodeSkill,
  params: Record<string, unknown>,
  dryRun: boolean
): Promise<ToolResult> {
  const skillDir = join(configDir, "skill-packages", skill.id);
  const manifestPath = join(skillDir, "skill.manifest.json");

  if (!existsSync(manifestPath)) {
    return { ok: false, message: `技能包缺失 manifest: ${skill.id}` };
  }

  if (dryRun) {
    return { ok: true, message: `dry-run ${skill.id} (code skill)`, data: { skill } };
  }

  // 动态 require 入口
  const entry = join(skillDir, skill.entry);
  const mod = await import(`file://${entry}?t=${Date.now()}`);
  const fn = mod.run || mod.default;

  if (typeof fn !== "function") {
    return { ok: false, message: `技能包入口没有 run 函数: ${skill.id}` };
  }

  const ctx: SkillContext = {
    configDir,
    logger: (msg) => console.log(`[skill:${skill.id}] ${msg}`),
  };

  const result = await fn(ctx, params);
  return { ok: result.ok, message: result.message, data: result };
}
```

### 4.4 Skill 安装接口（为市场铺路）

```typescript
// 放在 src/main/skills/registry.ts（新增）

export async function installSkill(configDir: string, source: "market" | "local" | "git", ref: string): Promise<Skill>;
export async function uninstallSkill(configDir: string, id: string): Promise<boolean>;
export async function upgradeSkill(configDir: string, id: string): Promise<Skill>;
export async function listInstalledSkills(configDir: string): Promise<Skill[]>;

// 同时暴露为 MCP tools：
// install_skill({ source, ref })
// uninstall_skill({ id })
// list_skills()
```

**安装流程（P0 简化版）：**
```
install_skill({ source: "local", ref: "C:/path/to/artifact-skill" })
   ↓
读 skill.manifest.json → 校验必填字段
   ↓
把整个目录复制到 %APPDATA%\sparo-store\skill-packages\<skill-id>\
   ↓
在 skills.json 里登记（source: "market"）
   ↓
执行 onInstall hook（如果有）
   ↓
完成
```

**P0 不做**：在线市场下载、npm registry 发布、付费购买、签名验证。这些放技能市场 M2（跟 SKILL-COMMUNITY-M2.md 对齐）。

### 4.5 新旧技能格式的过渡策略

| 阶段 | 做什么 |
|---|---|
| P0（artifact 落地） | 现有 JSON skill 保持不变，artifact 在 `agent/artifact/` 直接写代码，主进程 import 调用（不经过 skill 运行时） |
| P1（插件架构上线） | 把 artifact 代码抽成 `artifact-skill/` 代码包，放进 `skill-packages/` 目录。改造 runner.ts 支持 code skill。artifact 成为第一个标准代码型 skill |
| P2（市场开放） | 支持 install_skill / uninstall_skill / list_skills MCP tools。SKILL-COMMUNITY-M2.md 规划的在线市场按需开发 |

**关键约束：P0 阶段 artifact 不走 skill 包格式，直接在 agent 目录下写。** 因为我们还没验证"代码型 skill 运行时加载"这个机制，不能在 artifact 这个新功能上先搭一个未经测试的运行时层。先让 artifact 功能本身跑通，再把它抽成 skill 包验证运行时设计。

---

## 五、实施路径

### P0 · 打通最小闭环（3-5 天，直接写代码，不走 skill 包）

| 天数 | 任务 | 验收标准 |
|---|---|---|
| D1 | `generate.ts` — LLM → 单文件 HTML（含系统提示模板 + 重试 prompt 变体） | 给定"做个 10 秒 Sparo logo 动画"，能拿到一个 canvas 动画 HTML |
| D1 | `writeHtmlReport` 扩展：产物落盘到 `artifacts/<id>/page.html` | 落盘目录结构正确 |
| D2 | `render.ts` — 隐藏 BrowserView 加载 + `did-finish-load` 监听 + 首帧检测 | HTML 加载后 2 秒能拿到第一张截图，白屏/canvas 不动能自动重试 |
| D2 | `verify.ts` — 像素 diff 自检逻辑 | 两张截图像素不同判定为"动画在跑"，相同判定为"没动" |
| D3 | `capture.ts` — P0-a 方案：`capturePage()` 逐帧截 → PNG 序列 | 10 秒 30fps → 300 张 PNG，每帧有时间戳 |
| D3 | `export.ts` — ffmpeg 合成 webm；ffmpeg 不存在时降级为只输出 PNG 序列 | 有 ffmpeg 时拿到 webm；无 ffmpeg 时在窗口里打开 PNG 序列 viewer |
| D4 | 接入点 1：intent-router 新增 artifact 路由 + `parseArtifactQuery` | 说"做个视频介绍 Sparo"能正确拆成 ArtifactSpec |
| D4 | 接入点 2：caps.ts 注册 artifact cap | reasoner 能在计划里选择 artifact |
| D5 | 接入点 3+4：MCP tools + 侧栏入口 + 端到端测试 | 说"做一个 10 秒的 Sparo logo 动画"，侧栏返回产物路径，窗口自动打开预览 |

**P0 验收红线：**
- [ ] 白屏重试 2 次后降级方案走通
- [ ] canvas 不动重试 2 次后降级方案走通
- [ ] ffmpeg 缺失降级方案走通
- [ ] 产物目录结构正确（artifact.json + page.html + video.webm 或 PNG 序列）
- [ ] `intent-router` 不抢 report-html 的活儿（"写个介绍文档"不会误触发 artifact）

### P0.5 · 技能包运行时验证（1-2 天）

| 天数 | 任务 | 验收标准 |
|---|---|---|
| D6 | 创建 `artifact-skill/` 代码包，包含 `skill.manifest.json` + `run()` 入口 | 主进程能动态 require 这个包 |
| D6 | 改造 runner.ts：同时支持 step skill 和 code skill | 步骤型 skill（dxm-crawl-prep）照常运行，artifact-skill 能被 `run_skill({ query: "做视频" })` 触发 |
| D7 | `skills/registry.ts` — installSkill / uninstallSkill / listInstalledSkills | 把 artifact-skill 从本地目录"安装"到 `skill-packages/`，再 `run_skill` 能跑通 |
| D7 | 登记到 DECISION-POINTS.md + SKILL-FORMAT.md 更新 | 文档跟上代码 |

**为什么 P0.5 紧接 P0？** 因为 artifact 跑通后，它本身就是验证"代码型 skill 运行时"最好的测试用例——功能复杂、依赖 Electron API、有明确输入输出。如果 artifact 能成功从"agent 目录硬写"抽到"代码型 skill 包"，说明我们的 skill 运行时设计没问题。反之，说明设计有问题，artifact 可能就该留在 agent 目录里不走 skill 包。

### P1 · 可用性（1-2 周）

- [ ] 多场景 + AI 生成转场
- [ ] TTS 配音（走本地或云端 TTS，混进视频）
- [ ] 字幕烧录
- [ ] 导出 mp4 / gif（ffmpeg-static 内置）
- [ ] 生成前给"故事板预览"，用户可改（svganimate 有这个，很关键——不让人等了 30 秒才发现不对）
- [ ] `beginFrameSubscription` 提效（替换 P0 的 capturePage 逐帧截）
- [ ] 支持 BYOK 用户：artifact 完全免费（LLM 费自己出，编码费为零）
- [ ] 技能包安装接口开放为 MCP tools（install_skill / list_skills / uninstall_skill）

### P2 · 差异化（1 个月）

- [ ] **场景 C：AI 驱动真实网页录制**（Sparo 独有）——agent 自己操作网页 + 同步录制 + 自动加字幕解说
- [ ] 模板库（logo / 数据可视化 / 教学 / 产品演示 / 火柴人）——首批 10 个模板作为内置 skill 包
- [ ] 一键发布到 B站 / 小红书（复用现有社媒自动化）
- [ ] 技能市场开放——允许开发者提交 skill 包、设置点数价格、分成
- [ ] 产物与 skill 包联动：artifact 生成的产物可以一键变成模板 skill 包（"把这个动画导出为技能模板"）

---

## 六、商业模式

### 6.1 跟现有点数体系打通

| 动作 | 点数消耗 | 成本 |
|---|---|---|
| 生成单场景 HTML | 5-10 点数 | LLM 调用（~0.01-0.03 美元） |
| 录制 10 秒 720p 视频 | 5-10 点数 | 几乎为零（CPU 编码） |
| 多场景（3 场） | 20-30 点数 | LLM × 3 + 编码 |
| TTS 配音 500 字 | 2 点数 | 可忽略 |
| 逐帧高画质（1080p 60fps） | 20 点数 | 稍高（帧多编码久） |
| 技能市场第三方 skill | skill 作者定价，Sparo 抽 30% | 零成本 |
| 模板库内置 skill | 免费（点数体系的增值项） | 一次性开发成本 |

### 6.2 BYOK 模式下怎么处理

**用户自带 Key 时，artifact 完全免费。** 理由：
- LLM 调用费走用户自己的通道，Sparo 不收
- 录制编码的 CPU 成本几乎为零
- 这是 Sparo 相对 svganimate 的核心差异化：别人收订阅，我们对 BYOK 用户是纯增值

如果以后发现有人滥用（无限生成超大视频），再加配额限制（每人每天最多 10 次 artifact，每次最多 60 秒）。

### 6.3 定价锚点

| 产品 | 定价 | Sparo 策略 |
|---|---|---|
| svganimate | 订阅制 $20/月 | BYOK 免费 + 云订阅按次付费 |
| Canva Pro | 订阅制 $13/月 | 不竞争，我们是"说一句话"，他们是"拖拖拽拽" |
| Runway/Sora | 每次 $5-10 | 我们便宜 10-50 倍，因为不跑视频渲染管线 |

---

## 七、风险与边界

| 风险 | 应对 |
|---|---|
| LLM 生成的 HTML 有 bug（白屏、动效不跑、引用外部资源） | 系统提示严格禁止外部引用 + 生成后自检像素变化 + 重试 2 次 + 降级兜底。不要指望模型一次写对。 |
| 录出来的视频卡顿 | P0 用 capturePage 逐帧截（可能慢但不卡），P0-b 切 beginFrameSubscription 提效时掉帧会更少，P1 上逐帧离线模式彻底解决。 |
| ffmpeg 依赖导致某些机器装不上 | P0 允许降级为只输出 PNG 帧序列，Sparo 内置 image-sequence viewer 让用户在窗口里看。P1 内置 ffmpeg-static 打包进安装包。 |
| 单场景 HTML 体积大（37KB-100KB） | 可接受，gzip 后很小。artifact 单文件 HTML 是核心卖点，不能拆成多文件。 |
| 用户生成的页面有版权问题 | 生成时加 "AI 生成 · Sparo" 水印。条款里写清用户对自己生成内容负责。技能市场上架时强制审核。 |
| 跟 svganimate 正面撞车 | **不撞。** 它是"做动画的工具"，目标用户是设计师/开发者。Sparo 是"能做东西的浏览器"，目标用户是不会写代码的普通人。场景 C（AI 驱动真实网页录制成教程）更是独一份。 |
| 技能市场质量参差不齐 | P1 开放时先做"官方认证"机制。第三方 skill 必须声明 requires（electron/ffmpeg 等），Sparo 在安装时校验依赖。跑崩的 skill 自动标记 disabled 并提示用户。 |
| 微软商店版能不能带 artifact | 能。artifact 是纯本地能力，不涉及网络请求（除了生成时的 LLM 调用——BYOK 用户自己配通道），也不暴露价格 UI。商店版正常提供，用户自己的 key 照样能跑。 |

---

## 八、决策点清单（需登记到 DECISION-POINTS.md）

| DP# | 决策点 | 当前倾向 | 是否阻塞 P0 |
|---|---|---|---|
| DP-A | LLM HTML 质量自检的降级路径 | 重试 2 次 → 静态 HTML + 截图 gif → 纯 HTML | 是，必须 P0 前定 |
| DP-B | ffmpeg 缺失的降级 | PNG 序列 viewer | 是 |
| DP-C | artifact intent 匹配边界 | 只匹配"做视频/做动画/能动的网页/录成视频"；不抢 report-html | 是 |
| DP-D | 代码型 skill 的运行时安全边界 | 默认沙箱：skill 的 run 函数在独立 VM context 执行，禁止 `require('child_process')`、禁止网络请求。artifact 作为官方 skill 可给豁免。 | 否，P1 再定 |
| DP-E | skill 安装的信任链 | P0.5 只支持本地目录安装。P1 开始支持 git clone。P2 技能市场上线才需要签名验证。 | 否 |
| DP-F | ffmpeg-static 打包导致的安装包体积膨胀 | 安装包分两档：基础版（无 ffmpeg，降级为 PNG viewer）+ 完整版（带 ffmpeg-static，+80MB）。用户下载时自选。 | 否，P1 再定 |
| DP-G | artifact 产物是否自动上传云端 | 否。产物只存本机 `%APPDATA%\sparo-store\artifacts\`。跟现有 captures/、reports/ 保持一致。 | 是，必须 P0 前定 |

---

## 九、一句话总结

**P0：** 在 Sparo 主进程里写 `agent/artifact/` 模块，调 LLM 写 canvas 动画 HTML，Electron 隐藏 BrowserView 渲染，`capturePage` 逐帧截，ffmpeg 合成 webm，产物落盘 + 窗口预览。全链路 3-5 天，有三重降级兜底。

**P0.5：** 把 artifact 抽成第一个代码型 skill 包，验证"manifest + run(ctx, params)"这套 skill 插件架构设计，同时改造 runner.ts 支持 step/code 双轨。

**P1：** 多场景、TTS 配音、mp4/gif、技能安装接口开放。

**P2：** AI 驱动真实网页录制（独一份）、技能市场开放、模板库。

**技能市场的底层逻辑：** Sparo 给开发者一套标准（manifest + run 函数签名 + SkillContext），让任何人都能写一个"能在 Sparo 里跑起来"的能力包。artifact 是第一个这样的包，跑通后所有能力都可以按这个格式插拔、分发、收费。

---

*方沫 构想稿 + 老板 + AI 协作 · 2026-11-04 · P0 可开工*
