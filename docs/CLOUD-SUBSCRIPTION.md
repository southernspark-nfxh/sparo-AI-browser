# 云订阅 M1 — 给后续 Agent

> 2026-09-05 落地。本仓库是公开产品客户端。  
> 产品叙事：[PRODUCT.md](./PRODUCT.md) · 隐私：[PRIVACY.md](./PRIVACY.md) · 任务书：[PRODUCT-TASKBOOK.md](./PRODUCT-TASKBOOK.md) v0.3.5

M1 **没有做** Skill 社区、加购点包、海外 Gumroad、`declared_domains` 硬闸。M1 没过验收，不要开 M2。

---

## 30 秒

| 事实 | 不要搞反 |
|---|---|
| 免费永远自备 Key（`llmMode: "byok"`） | 不要阉割 BYOK |
| 订阅 = 可选云端模型；Key 只在独立代理服务端 | 不要把云端真 Key 写入 settings / 下发客户端 |
| 对外「1 次任务」= 一次 `handleChatJob`（含 planner + 多轮 tool + 手册） | 不要按每次 `/chat/completions` 扣「次数」 |
| 内部 1 点 = 10 万加权 token（输入×1 + 输出×3）；约 N 次 = `剩余点 / 2` | 点数不跨月；季/年按月注入 |
| 登录后**每台设备 3 次**体验（按任务计，不是积分礼包） | 用尽提示贴自己的 Key 或去官网开通 |
| 商店应用内**零支付按钮**；`shell.openExternal` 开官网 | `STORE_CHANNEL=msft` 更严，包里不能出现价格文案 |
| 支付只验服务端回调；客户端「已付款」不可信 | Gumroad / 加购 = M1.5，还没做 |
| JWT ≤1h + refresh；Electron `safeStorage` 存 `cloud-session.bin` | 设置目录翻不到云端真 Key |

数据：`%APPDATA%\sparo-store`（`settings.json` 的 `llmMode`、`cloud-device.json`、加密 `cloud-session.bin`）。  
代理：`SPARO_CLOUD_API`（开发默认同机 `http://127.0.0.1:3940`）。官网账户页：`SPARO_ACCOUNT_URL`（默认 `https://southernspark.dev/sparo/account`）。

---

## 三边结论（已拍板，不要重开）

- **产品：** 旧叙事「只卖软件、不设云端账号」已改。对外说「云端模型 / 无需自己配 Key」，少用「会员」。微软商店包只留「登录 / 去官网管理订阅」。
- **技术：** 代理 OpenAI 兼容；按 `task_id` 累加 usage 再结算。余额检查在 `handleChatJob` 开头，不在每一轮 tool call。云模式收紧 `page_text`（约 3000 字）。
- **用户：** 极客只贴 Key、不登录。大众登录试 3 次再决定。到期只停云端；网页登录和本地 Key 不动。代理挂了或未登录 → 自动退回已保存的 BYOK。

---

## 仓库边界

| 部分 | 角色 |
|---|---|
| 本仓库 | 客户端（3921 / `sparo-store`） |
| 独立 `sparo-pay` 服务 | 登录、配额、LLM 代理、支付回调。**不要**把云端 Key 并进本仓库 |
| 其它内部产品线 | 出行/飞书可以对齐；**云订阅不要移植、不要弹登录** |

---

## 客户端改了什么

| 文件 | 作用 |
|---|---|
| `src/main/settings/store.ts` | `llmMode: "byok" \| "cloud"`，默认 `byok` |
| `src/main/cloud/config.ts` | API / 账户 URL / `STORE_CHANNEL=msft` |
| `src/main/cloud/auth.ts` | 设备码、发码/验码、refresh、`/me`、`safeStorage` |
| `src/main/cloud/quota.ts` | `assertAndStartTask` / `settleCloudTask` |
| `src/main/cloud/session.ts` | `cloudFetch`：JWT + `X-Sparo-Task` |
| `src/main/agent/deepseek.ts` | `fetchImpl`、`setTaskId`；cloud 带 `X-Sparo-Task` |
| `src/main/browser.ts` | `rebuildDeepSeek` 双模式；`handleChatJob` 开任务/结算；IPC `spark:cloud-*` |
| `src/main/shell-preload.ts` | 暴露 cloud IPC |
| `src/renderer/shell.html` | 两种模式卡片、邮箱验证码、余量文案 |
| `src/shared/i18n.ts` | 中英为主；去掉「不卖会员」绝对句 |

IPC：`spark:cloud-send-code` / `verify` / `logout` / `open-account` / `cloud-refresh`。

侧栏：本月约 N 次，或体验还剩 N 次；任务结束后「这次大约用了 X 次」。

---

## 服务端（sparo-pay，独立仓库）

听本机 `127.0.0.1:3940`（开发）。生产用环境变量指向线上代理。

| 路由 | 作用 |
|---|---|
| `GET /health` | 探活 |
| `POST /auth/send-code` `/verify` `/refresh` | 邮箱验证码登录 |
| `GET /me` | 配额快照 |
| `POST /tasks/start` `/settle` | 一个侧栏对话一个 `taskId`；体验次数在 start 扣 |
| `POST /v1/chat/completions` | 验 JWT + `X-Sparo-Task`；尾帧 usage 累加 |
| `POST /pay/create` | 建支付单（月/季/年） |
| 支付回调 | 服务端验签；客户端「已付款」不可信 |

限流约 10r/s/IP。日志不回显 key。

---

## 计量（必须对齐，否则用户觉得被骗）

1. 侧栏一句（会走模型的）→ `/tasks/start` 拿到 `task_id`  
2. planner / `completePlain` / `chat` 多轮 HTTP **共用**该 id  
3. 代理把 input/output token 累加到 task  
4. `/tasks/settle` 按点扣月额度；体验用户在 start 时已扣 1/3 次  
5. 展示：订阅看 `approxTasks`；体验看 `trial.left`

非模型句（暂停、打印、纯打开）不 `start`。额度不足：拒开**新**任务；已开任务能跑完。有本地 Key 则本轮退回 BYOK。

---

## 验收（M1 缺一不可）

1. 抓包 / `%APPDATA%\sparo-store` 翻不到云端真 key  
2. 额度或 3 次体验用尽：拒开新任务，已开任务能跑完  
3. 一次「订酒店」只计 **1 个任务**，日志里多轮 HTTP 同一 `task_id`  
4. 断网或代理挂：BYOK 仍可用  
5. `STORE_CHANNEL=msft` 构建搜不到支付/价格文案（不要出现价格 / 档位 / 扫码）

本仓库：`npx vitest run`。代理服务另跑它自己的测试。Electron 侧栏登录闭环还要人在开发窗点一次。

---

## 明确还没做（不要当已上线）

- M1.5：Gumroad、加购点包  
- M2：Skill 社区 / 导入导出 / 分成、`declared_domains` 硬闸  
- `docs/listings/` **未改**。上架/提审前必须另做一轮，否则商店页仍写「不设云端账号」  
- 官网账户页、支付商品在生产环境的真实接通  

Pro 买断冻结；M1 人测过完再谈 M2。
