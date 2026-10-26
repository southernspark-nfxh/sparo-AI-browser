# NOTICE — 技能系统修复任务书（2026-09-13）

**来源:** QA-SKILLS-SYSTEM-20260913.md  
**优先级:** P0（必须修复）  
**预计工作量:** 1.5天  
**影响范围:** 提示词系统、任务路由逻辑

> **复核（2026-09-14）：不要按 5 个任务整包执行。**  
> 只做了任务 1 的真修复（删重复句）+ 任务 2 的正确写法（说明本机先拆，而不是让模型调用 intent-router）。  
> 任务 3 引用错了 `deepseek.ts` 行号，执行会删掉小红书/飞书运行时规则。任务 4、5 是社区格式愿望，会破坏现有 `agentPlaybook` 数组。

---

## 任务 1：删除重复提示词（P0）

### 问题
`agentCapabilityBrief` 函数有重复内容，模型看到会困惑。

### 位置
`src/main/agent/intent-router.ts` L366-370

### 修改前
```typescript
// L366-367
"用户明确说「发 / 发布 / 发三条」= 已授权发帖，应当填写并点击发送。付款、删号、客服点发送仍必须等人。做完用短句报进度，不要编造已发送。",
"你越用越懂这个用户：参考「你对用户的了解」个性化回复，但别生硬复述、别泄露原始字段。",

// L369-370（重复）
"用户明确说「发 / 发布 / 发三条」= 已授权发帖，应当填写并点击发送。",
"你越用越懂这个用户：参考「你对用户的了解」个性化回复，但别生硬复述。",
```

### 修改后
```typescript
// 只保留 L366-367，删除 L369-370
"用户明确说「发 / 发布 / 发三条」= 已授权发帖，应当填写并点击发送。付款、删号、客服点发送仍必须等人。做完用短句报进度，不要编造已发送。",
"你越用越懂这个用户：参考「你对用户的了解」个性化回复，但别生硬复述、别泄露原始字段。",
```

### 验收标准
- 删除 L369-370 两行
- 保留 L366-367 两行（更完整）
- 运行 `npm test` 通过

---

## 任务 2：明确技能包调用逻辑（P0）

### 问题
模型不知道什么时候该调用技能包，什么时候用 `match_skill` vs `run_skill`。

### 位置
`src/main/agent/intent-router.ts` L350-385

### 修改前
```typescript
"run_skill 仅当妙招站点与用户说的站点一致。",
```

### 修改后
```typescript
"任务路由优先级：\n" +
"1. intent-router 先判断（行程规划、查机票/酒店、比价等）\n" +
"2. 如果 intent-router 没匹配，用 match_skill 找技能包\n" +
"3. 找到技能包后，用 run_skill 执行\n" +
"4. 没有匹配的技能包，自己 snapshot → click → fill\n" +
"run_skill 仅当技能包站点与用户说的站点一致。",
```

### 验收标准
- 在 `agentCapabilityBrief` 的中文版本（L352-371）中添加任务路由优先级说明
- 在英文版本（L373-384）中也添加对应说明
- 运行 `npm test` 通过

---

## 任务 3：明确 intent-router 和 systemPrompt 职责边界（P1）

### 问题
两者都提到了"比价、选品、筛选、对比、研报等多种信息调研，最终必须写成报告页"，职责重叠。

### 位置
- `src/main/agent/intent-router.ts` L360
- `src/main/agent/deepseek.ts` L375

### 修改前
```typescript
// intent-router.ts L360
"死规则：比价、选品、筛选、对比、研报等多种信息调研，最终必须写成报告页并在窗口打开。禁止把对照表、商品清单堆在侧栏聊天里。读完列表即可，不要点进一堆详情循环。",

// deepseek.ts L375
"If the current URL is xiaohongshu.com: NEVER fill title/body character-by-character or loop fill. Pass pre-baked text into xhs_inject_compose / xhs_inject_publish (or run_skill params). Detect stage with xhs_page_stage and click Next / auto-layout.",
```

### 修改后
```typescript
// intent-router.ts L360（保留，这是任务路由规则）
"死规则：比价、选品、筛选、对比、研报等多种信息调研，最终必须写成报告页并在窗口打开。禁止把对照表、商品清单堆在侧栏聊天里。读完列表即可，不要点进一堆详情循环。",

// deepseek.ts L375（改为运行时规则，不重复任务路由）
"运行时规则：根据当前页面执行特定逻辑（小红书不循环 fill、飞书不代发等）。",
```

### 验收标准
- `intent-router.ts` 保留完整的任务路由规则
- `deepseek.ts` 只保留运行时规则，不重复任务路由
- 运行 `npm test` 通过

---

## 任务 4：统一技能包格式（P1）

### 问题
技能包格式不统一，有的缺少关键字段。

### 位置
`strategies/skills/*.json`（35个技能包）

### 修改前
`universal-form-fill.json` 缺少：
- `declared_domains`
- `declared_actions`
- `human_gates`

### 修改后
所有技能包必须包含以下字段：
```json
{
  "id": "universal-form-fill",
  "title": "通用填表：analyze_page → execute_primitives",
  "kind": "life",
  "version": 1,
  "distilled": true,
  "shareable": true,
  "platform": "any",
  "aliases": ["通用填表", "自动填表", "填表单"],
  "createdAt": "2026-08-11T12:00:00.000Z",
  "updatedAt": "2026-09-13T00:00:00.000Z",
  "intent": "未知站点或多字段表单：先分析题型再按 payload 一次填入",
  "declared_domains": ["*"],
  "declared_actions": ["analyze_page", "execute_primitives"],
  "human_gates": ["login", "pay", "captcha"],
  "params": {
    "payload": {
      "type": "object",
      "required": true,
      "example": { "标题": "示例", "正文": "内容" }
    }
  },
  "steps": [
    { "tool": "analyze_page", "optional": true, "hint": "题型分析" },
    { "tool": "execute_primitives", "args": {}, "hint": "按 payload 填入" }
  ],
  "fallbacks": ["登录墙 pause，等人后再填"],
  "knownGaps": ["日期选择器用 pick_calendar，不要 fill"],
  "notes": ["Do NOT loop fill/click for multi-field forms."],
  "agentPlaybook": [
    "run_skill({ query: '通用填表', params: { payload: {...} } })",
    "Or call analyze_page then execute_primitives directly"
  ]
}
```

### 验收标准
- 所有 35 个技能包都包含 `declared_domains`, `declared_actions`, `human_gates`
- 所有技能包的 `agentPlaybook` 都是数组格式
- 运行 `npm test` 通过

---

## 任务 5：统一 agentPlaybook 格式（P2）

### 问题
`agentPlaybook` 格式不统一，有的数组，有的字符串。

### 位置
`strategies/skills/*.json`（35个技能包）

### 修改前
```json
"agentPlaybook": [
  "run_skill({ query: '比价', params: { query: '索尼WH-1000XM5' } })",
  "读三页 page_text，出对照表"
]
```

### 修改后
```json
"agentPlaybook": {
  "callExample": "run_skill({ query: '比价', params: { query: '索尼WH-1000XM5' } })",
  "executionSteps": [
    "打开京东搜索结果页",
    "打开淘宝搜索结果页",
    "打开拼多多搜索结果页",
    "读三页 page_text，出对照表"
  ]
}
```

### 验收标准
- 所有技能包的 `agentPlaybook` 都是对象格式，包含 `callExample` 和 `executionSteps`
- 运行 `npm test` 通过

---

## 验收流程

### 1. 代码审查
- 检查 `intent-router.ts` 是否删除了重复提示词
- 检查 `intent-router.ts` 是否添加了任务路由优先级说明
- 检查 `deepseek.ts` 是否只保留运行时规则

### 2. 技能包检查
- 检查所有 35 个技能包是否包含必需字段
- 检查所有技能包的 `agentPlaybook` 格式是否统一

### 3. 功能测试
- 运行 `npm test` 通过
- 手动测试任务路由：
  - 用户说"帮我比价索尼耳机" → 应该调用 `life-compare-shop`
  - 用户说"帮我查论文" → 应该调用 `research-papers`
  - 用户说"帮我填表" → 应该调用 `universal-form-fill`

### 4. 提示词检查
- 检查 `agentCapabilityBrief` 是否包含任务路由优先级说明
- 检查是否有重复内容

---

## 交付物

1. 修改后的代码文件：
   - `src/main/agent/intent-router.ts`
   - `src/main/agent/deepseek.ts`
   - `strategies/skills/*.json`（35个技能包）

2. 测试报告：
   - `npm test` 输出
   - 手动测试结果

3. 更新文档：
   - `strategies/skills/README.md`（如果需要）
   - `docs/SKILL-FORMAT.md`（如果需要）

---

## 注意事项

1. **不要破坏现有功能** - 修改提示词时要确保现有任务路由逻辑不受影响
2. **保持向后兼容** - 技能包格式修改要确保旧版本也能运行
3. **测试覆盖** - 修改后要运行完整的测试套件
4. **文档更新** - 如果修改了技能包格式，要更新 `SKILL-FORMAT.md`

---

**任务书生成时间：** 2026-09-13 20:00  
**预计完成时间：** 2026-09-15  
**验收人：** 方沫
