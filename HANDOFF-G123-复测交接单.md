# 交接单：Sparo 0.3.2 安装包 G1/G2/G3 黄金场景复测

> 写于 2026-11-09。交接对象：接手的 AI Agent。
> 你只做一件事：**在安装版 0.3.2 上跑完 G1/G2/G3，回填 QA 记录表，然后向用户汇报。**
> 打包、安装、文档对齐全部已完成并验收，不要重做。

---

## 一、当前进度（不要重做的部分）

| 项 | 状态 |
|---|---|
| 版本号 0.3.2 + CHANGELOG | ✅ 已提交 |
| typecheck + 全量测试 | ✅ 绿 |
| `npm run dist` 重打包 | ✅ `release\Sparo-Setup.exe`，SHA256 E8F5BF9E…，修改时间 2026-11-09 15:30:48 |
| 安装到 `D:\Program Files\Sparo` | ✅ 用户双击安装完成 |
| 文档对齐（AGENTS.md 0.3.2 + INSTALL.md SHA256） | ✅ 提交 dcbe9d3 |
| 工作区恢复 Cursor 现场（stash pop，47 条脏文件） | ✅ typecheck 绿，**不要动这些脏文件** |
| G1/G2/G3 复测 | ❌ **未跑（你的任务）** |

git HEAD = `dcbe9d3`。QA 记录表在 `docs/QA-GOLDEN-SCENARIOS.md` 114-127 行，G1-G8 安装包列全是「未跑」。

---

## 二、你的任务（按顺序）

### 第 0 步：确认环境

1. **确认 3921 端口归安装版**。之前被 Cursor 拉起的开发模式实例（进程名 `electron`，PID 44524，挂着 agent r9b-inst 在测店小秘半成品）占用。G 测试**必须**在安装版上跑（QA 文档规则：「开发窗绿了，不能代替安装包」）。
   - 检查：`Get-NetTCPConnection -LocalPort 3921 | Select OwningProcess`，再看进程名是不是 `Sparo.exe`（安装版）。
   - 如果开发模式实例还在跑：**先问用户能不能关**，那是 Cursor 的现场，不能擅自杀。
2. 安装版没起就启动：`Start-Process "D:\Program Files\Sparo\Sparo.exe"`。
3. 健康检查：`Invoke-WebRequest http://127.0.0.1:3921/health` 应返回 200、toolCount 76。

### 第 1 步：清僵尸单（启动后必做）

底账 `%APPDATA%\sparo-store\missions.jsonl` 尾部有 **4 张僵尸单**（state=running 无 turn）：
- m-mw90rwv0-syzbv（raw=乱码 `????`，编码 bug 遗留）
- m-mw90t1eo-mcfa0（raw=「这单取消不用做了请关单」）
- 两张 raw=「取消」

启动安装版后侧栏会弹「恢复未完成任务」。**回「算了」**（这是 dismiss，scope=all 关全部挂起单）。如果没弹或回复没生效，说明僵尸单还在，逐张确认关闭后再继续。也可以在每次 G 测试前用 `list_agents` 确认侧栏空闲（running=false）。

### 第 2 步：G1 ——「打开微博」

发送侧栏原句：`打开微博`

验收（只看底账，不看侧栏表象）：
- 新 op=open，close.reason=**done**
- chat-memory（`%APPDATA%\sparo-store\chat-memory.json`，滚动 40 条）助手句含「已打开 weibo.com。」
- brainPlan 仅 1 步，cap=navigate

### 第 3 步：G2 ——博主微博做文档

前置：活动标签停在某博主 `weibo.com/u/` 页。G1 之后在微博首页找一个博主链接点进去，或用 MCP navigate 工具直接导航到任一 u/ 页（不需要登录也能看部分博主）。

发送原句：`当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档`

验收：
- realSteps >= 1，首条 findings 的 step.cap=**read_page**
- 助手句含「正在做 1/」
- close=**done**（交付了文档）

### 第 4 步：G3 ——紧跟的重复句

前置：G2 刚关单，上一条助手消息 doc.kind=read。

紧接着发送：`把最近 3 天微博逐条复制下来`

验收：
- **新 op=open、新 mission.id**（关键：这句话是重复表述，验证它没有被误判成上一单的「改写/amend」）
- 走正常任务循环

### 第 5 步：回填 QA 记录表

`docs/QA-GOLDEN-SCENARIOS.md` 114-127 行实机记录表，回填 G1/G2/G3 的「安装包」列 + 底账摘录。表尾注明：
- `git rev-parse --short HEAD` = **dcbe9d3**
- 安装包 `release\Sparo-Setup.exe` 修改时间 = **2026-11-09 15:30:48**

### 第 6 步：向用户中文汇报

- G1/G2/G3 结果（过了/没过、底账证据）
- 提醒：白屏一周观察期自 11-09 装新包起重新起算
- 不要自己 git commit，问用户是否提交 QA 回填

---

## 三、怎么发消息（MCP 通道，用户已批准）

用户批准用 MCP `sidebar_chat` 发（与手打同一条 handleChat 管线，底账记录一致）。

### 现成工具：`%TEMP%\sparo-mcp.ps1`

已创建并修好编码。用法：

```powershell
. $env:TEMP\sparo-mcp.ps1
$msg = [IO.File]::ReadAllText("$env:TEMP\g-msg.txt", [Text.Encoding]::UTF8).Trim()
McpCall <自增id> "sidebar_chat" ('{"text":"' + $msg + '","hands":true}')
```

中文句子必须先用 Write 工具写进 `g-msg.txt`（UTF-8），PowerShell 再读入。**不要直接在命令行里内联中文字符串**。

脚本自动处理：token 认证（读 `%APPDATA%\sparo-store\mcp-auth.json`）、header `x-sparo-client: eaf5bb`、SSE 响应解析。若脚本丢失，见下文重建要点。

### 查底账

```powershell
Get-Content "$env:APPDATA\sparo-store\missions.jsonl" -Tail 20
```

每张单看 op=open/turn/close 链条。chat-memory 直接 Read json 文件。

---

## 四、坑（前人踩过的，别再踩）

1. **PowerShell 5 中文编码**：`Invoke-WebRequest` 字符串 body 按 ASCII 发，侧栏收到 `????`，会被 `isConfusionText` 吃掉并回复一段无关的排查说明（G1 第一次就这么废的）。修复：`[Text.Encoding]::UTF8.GetBytes($body)` + `-ContentType "application/json; charset=utf-8"`。脚本里已修。
2. **「取消」开新单**：`isCancelText` 是精确匹配（`/^(取消|算了|不做了|停止任务|关掉)$/`，见 `src/main/agent/slots.ts` 83 行），且要求 `ctx.active` 存在才走 cancel 分支（`src/main/agent/runtime.ts` 218 行）。僵尸单不是 active，所以回「取消」会 openFromGoal 开新单而不是关单。**关僵尸单用「算了」走恢复提示的 dismiss，别用「取消」。**
3. **UI 自动打字不可靠**：Electron 渲染的侧栏不暴露 UIA，坐标点击 + 系统键入两次都失败。走 MCP sidebar_chat。
4. **DeferExecuteTool 参数**：toolName 和 params 是两个独立参数，别把 JSON 塞进 params。
5. **两种实例共享数据目录**：开发模式 electron 和安装版 Sparo.exe 共用 `%APPDATA%\sparo-store` 和 3921 端口。跑 G 测试前务必确认 3921 的属主是 Sparo.exe，否则你测的是 Cursor 的开发实例，结果无效。
6. **等待节奏**：G2/G3 是真任务（读页、做文档），发送后底账不会立刻有 close，轮询 `missions.jsonl` 尾部，间隔 5-10 秒。关单有声音提示（任务栏闪），但你看不到，只信底账。

---

## 五、禁区

- **不动**工作区 47 条脏文件（Cursor 的店小秘半成品现场）。
- **不动** `D:\download\Sparo`（原版 3920 / `%APPDATA%\sparo`）——那边只同步侧栏能力，不搬云订阅。
- **不动** `docs/listings/`（提审前另做一轮）。
- **不杀** Cursor 的开发模式实例，除非用户同意。
- **不重打包**、不 bump 版本、不 commit（除非用户明确要求）。
- 云端 Key 不进客户端。

## 六、重建 MCP 脚本（如果 %TEMP% 被清）

要点：POST `http://127.0.0.1:3921/mcp`，JSON-RPC 2.0，method=tools/call，params.name=sidebar_chat，params.arguments={"text":...,"hands":true}；Headers：`Authorization: Bearer <token>`（从 `%APPDATA%\sparo-store\mcp-auth.json` 读）、`x-sparo-client: eaf5bb`、`Accept: application/json, text/event-stream`；body 必须 UTF8 字节；SSE 响应取 `data:` 行解析。首次可能需要 initialize 拿 clientId。

---

## 七、完成后

回填 QA 表 → 中文汇报用户（G1/G2/G3 结果 + 白屏观察期提醒）→ 等用户指示是否 commit。QA 文档改动是本仓库唯一预期落盘变更。
