# A1 期任务书：新 Agent 接入自述 + 店小秘技能可执行化

> 背景：换新 Cursor 窗口 / 新 Trae 账号连上 Sparo，不知道这个浏览器能做什么，也不知道有技能，必须人提醒。
> 本期目标：任何一个没有记忆的 agent，连上 Sparo 就知道「有什么能力、有哪些技能、下一句调哪个工具」；同时把已经跑通的「打开→编辑→保存」写进技能，让侧栏一句话能跑。
> 本期做完：整体提交 + `npm run dist` 出新包。

## 1. 分工

| 项 | 内容 | 归属 | 状态 |
|---|---|---|---|
| P0 | MCP 握手文本指向 `sparo_info` 与技能三件套 | 规划方 | 已完成 |
| P1 | `sparo_info` 技能目录扩到 40 条；新增 prompt `sparo_skills` | 规划方 | 已完成 |
| P2 | `dxm-crawl-prep` 从「说明书」改成「可执行 steps」 | 科sir | 待执行 |
| P3 | 整体提交、打新包、安装包复测 G1/G2/G3 | 科sir | 待执行（P2 之后） |

## 2. 已完成（规划方，本轮）

### 2.1 改动清单

| 文件 | 改了什么 |
|---|---|
| `src/main/agent/agent-guide.ts` | `agentInstructions()` 开头改为「第一次连接先调 `sparo_info`，一次拿到能力边界、全部技能 id 与最快路径」，并写明 `list_skills → get_skill → run_skill`，无技能才用原语 |
| `src/main/skills/runner.ts` | `skillCatalog(configDir, limit = 20)` 增加 `limit` 参数，默认值不变 |
| `src/main/browser.ts` | `sparoInfoTool()` 调 `skillCatalog(configDir, 40)`，不再截断到 20 条 |
| `src/main/mcp-server.ts` | 新增 prompt `sparo_skills`：输出全部技能 `id \| 标题 \| 别名 \| 步数/路线型 \| 意图`，数据取 `handlers.sparo_info()` |
| `strategies/skills/dxm-crawl-prep.json` | 升到 v6：补字段定位、保存两种点法、3 条 pitfall、2 条真机核对 |

### 2.2 已跑验收

```text
npx tsc --noEmit -p tsconfig.json          → 0 error
npx vitest run tests/mcp-agent.test.ts     → 6 passed
```

`agentInstructions()` 仍满足既有硬约束：`< 500` 字、含 `clientId=` / `submit_task` / `get_task` / `navigate` / `支付` / `删除` / `客服` / `pool_full`，不含 `3921` / `价格`。

### 2.3 真机已核事实（P2 直接复用）

- 编辑页 `/web/productCrawl/edit?id=`：标题 `input[placeholder="请填写标题"]`；包装重量 `input[placeholder^="请输入重量"]`（kg）；变种库存是每行第 6 个 `placeholder="请输入"`。
- 保存只点文字恰为「保存」的 `button.btn-orange`；`btn-green`「保存并认领」禁点。
- 窗口可见（视口 1000×827）时，按钮可能在视口外（页面宽约 1506），须先横向滚动再可信点击，落点 `(586, 671)` 命中。
- 窗口最小化（`innerWidth`/`outerWidth` = 0）时可信点击被拒「无效坐标」，`execute` 内 `button.click()` 仍能落库。
- 保存无成功提示，唯一可靠校验是 `reload` 后回读。
- 两条记录已实测：`167842582606445464`（文案商品）、`167842582602436618`（机械键盘，6 变种库存全封顶 2000）。

## 3. 科sir 任务 P2：把 `dxm-crawl-prep` 变成可执行

### 3.1 现状

`strategies/skills/dxm-crawl-prep.json` 的 `steps` 是空数组，只有 `route`。本机 40 个技能里 38 个有 `steps`，只有它和另一个是纯说明书。所以侧栏说「编辑第 2 条并保存」只会拿到路线，不会动手。

### 3.2 要做的

给该技能补 `steps`，`route` / `pitfalls` / `contract` 全部保留，不要删。步骤按下面顺序，`params` 用 `buildVars` 已支持的 `{{key}}` 替换：

1. `navigate` → `{{editUrl}}`
2. `fill` 标题：`selector: input[placeholder="请填写标题"]`，`value: {{title}}`，`optional: true`（标题已有值时调用方不传）
3. `fill` 包装重量：`selector: input[placeholder^="请输入重量"]`，`value: {{weight}}`，`optional: true`
4. `execute` 打库存标记：把 `placeholder="请输入"` 且纯数字且 `> {{stock}}` 的输入框依次打 `data-sparo-stock="1..n"`，把 n 写进 `window.__sparoStockCount`
5. `fill` × 8，`selector: [data-sparo-stock="N"]`，`value: {{stock}}`，全部 `optional: true`（数量不定，多余的会 skipped）
6. `execute` 点保存：只对文字恰为「保存」的 `button.btn-orange` 调用 `button.click()`（不要点 `btn-green`）
7. `reload`
8. `execute` 回读：返回 `{title, weight, stocks, ok}`，`ok` 要求标题与重量等于入参、库存全部等于 `{{stock}}`

### 3.3 验收（必须真机，不接受只看代码）

1. 在采集箱第 2 条上跑：`run_skill({ query: "编辑采集箱第2条并保存", params: { editUrl, title, weight: "0.05", stock: "2000" } })`。
2. 跑完 `reload`，第 8 步回读三项与入参一致。
3. 列表页该行仍在「数据采集」，状态未变成已认领。
4. 窗口最小化状态下跑一遍，必须同样成功（走 `button.click()` 分支）。
5. 反向用例：`title` 传空且页面标题原本为空时，必须如实报「标题为空，未保存」，不能假 done。

### 3.4 红线

- 不许点「保存并认领」。
- 不许把 `route` 删掉换成 steps；两样都要在。
- 不许在 steps 里写死某条记录的 `id` 或商品名。
- 单测绿不算验收，第 3.3 的四条必须真机跑过。

## 4. P3：提交与打包（科sir）

```text
git add -A
git commit -m "feat(agent): 新 agent 接入自述指向技能目录；dxm-crawl-prep 可执行化"
npm run typecheck
npm test
npm run dist        → release\Sparo-Setup.exe
```

安装包出来后在真机复测 G1、G2、G3（见 `docs/QA-GOLDEN-SCENARIOS.md`），并额外验一条：新开一个没有记忆的 MCP 客户端，只调 `sparo_info` + prompt `sparo_skills`，能报出「店小秘上品」「发小红书」两条技能 id。

## 5. 红线（全期）

- instructions / `sparo_info` / prompt 里不写端口、Token、价格、点数。
- 不放宽 `agentInstructions()` 的 `< 500` 字测试；要装更多内容走 `sparo_skills` 通道。
- 不动 `docs/listings/`。
- 主进程不热更：改 `src/main/**` 后必须重启或重打包才生效，真机验收前先确认跑的是新代码。
