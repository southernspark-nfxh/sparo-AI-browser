# 任务书：R11 Part B 旧断言口径对齐

> 依据：[R11 任务书 §11](./ECOMMERCE-PHASE1-FIX-R11-CURSOR-TASKBOOK.md#L188-L276)（Part B 执行细则）。
> 状态：Part B 实现已写完、未提交；定向 / 全量各红 3 条，全部落在「接口先执行」改变了执行计数语义，不是判定回归。

---

## 一、规划方复核结论

`lookupDraft` 的拆分通过：顺序、域名校验、空标题跳过、不传 `shopId`、`source` 出口、`lookupViaDom` 搬运范围，均符合 §11。

三处红灯（外加一处会被带红的回归锁）不是实现错误，是 §11.7.9「既有断言一字不改」与「接口先请求一次」在产品行为上不能同时成立。**本单批准变更四处断言口径，判定语义一个字不动。**

---

## 二、四处改法（只改断言与测试桩，不改 `src/`）

### T-1 `tests/dxm-smt-r7.test.ts`「当前标签是采集编辑页时，判重另开标签，不导航编辑页」

现状问题：靠 `expect(script).toContain("sparo-box-list")` 对接口脚本抛错，才"制造"出接口失败。测试不能靠异常兜底。

`execute` 桩按脚本分流：

```ts
execute: async (script: string, tabId?: string) => {
  executed.push(tabId || "");
  if (script.includes("pageList.json")) {
    return { ok: true, data: { result: { status: 404, ok: false, json: null } } };
  }
  expect(script).toContain("sparo-box-list");
  return { ok: true, data: { result: { marker: "sparo-box-list", loaded: true, emptyRendered: true, rows: [], searchValue: "" } } };
},
```

- `executed` 断言改为 `["edit", "box-tab", "box-tab", "box-tab"]`：第一下是接口在编辑页上执行，后三下是页面读表。
- `opened`、`closed`、`navigated` 三条**原样保留**，它们才是这条用例的本意（编辑页不导航、另开标签）。

### T-2 `tests/dxm-smt-r10.test.ts`「稳定空表三次一致后判 absent」

不许把 3 直接改成 4。拆成两个计数：

```ts
let domReads = 0;
let apiCalls = 0;
execute: async (script) => {
  if (script.includes("pageList.json")) {
    apiCalls += 1;
    return { ok: true, data: { result: { status: 404, ok: false, json: null } } };
  }
  domReads += 1;
  return { ok: true, data: { result: empty } };
},
```

断言：`absent`、`apiCalls === 1`、`domReads === 3`。保留"稳定窗三次"的原意，并新增"接口只问一次"。

### T-3 同文件「预算内反复翻转且出现过表体时停 unknown」

`flipping` 不能再喂给接口脚本（当前 parity 是被接口调用带偏的）。同样按脚本分流，接口返回 404，`reads` 只数页面读取。

reason 断言由全等改为分段：

```ts
expect(result?.reason).toContain("接口：");
expect(result?.reason).toContain(boxPollExhausted(["ready"]).reason);
```

保留 `not.toBe("absent")` 与 `not.toMatch(/absent|没有草稿/)`。

### T-4 `tests/dxm-smt-r11b.test.ts`「既有判重测试文件里的原断言还在」

这条回归锁现在锁的正是要被改掉的旧字符串，改完 T-1～T-3 必红。改为锁新口径：

- `["edit", "box-tab", "box-tab", "box-tab"]`
- `domReads` / `apiCalls`
- `接口：`

R9B 那条断言（`activate:box-tab …`）与 R11 那条（`shapeOk`）**原样保留**。

---

## 三、白名单

只许改 / 新建：

- `tests/dxm-smt-r7.test.ts`
- `tests/dxm-smt-r10.test.ts`
- `tests/dxm-smt-r11b.test.ts`（未跟踪新文件，随本单入库）
- `src/main/workflows/dxm-smt-live.ts`（Part B 实现，本轮只提交不再改）
- `docs/ECOMMERCE-PHASE1-FIX-R11-CURSOR-TASKBOOK.md` 末尾「Part B 完成记录」追加一句放行说明

**不许动**：`dxm-smt-api.ts`、`dxm-smt-box.ts`、`dxm-smt-listing.ts`、`dxm-smt-contract.ts`、`browser.ts`、`mcp-server.ts`、`tools/index.ts`、`docs/DECISION-POINTS.md`、`.workbuddy/`。

---

## 四、红线

- 不许为了让测试变绿而改计数之外的断言，不许放宽 `absent` 条件。
- 不许改 R7 / R10 里与本次无关的用例；不许整文件格式化。
- 不许改实现逻辑（`lookupViaApi` / `lookupViaDom` / `apiFetcher` 已复核）。
- 不许 `git stash` / `reset` / `checkout --` / `clean` / `git add -A`。
- 不跑真机、不打包、不改版本号。
- 完成记录里必须写：§11.7.9 由规划方 2026-11-10 批准变更为上述四处，理由为「接口先执行改变了执行计数语义」。

---

## 五、验收

按顺序全过：

```text
npx vitest run tests/dxm-smt-r11b.test.ts tests/dxm-smt-r11.test.ts tests/dxm-smt-r10.test.ts tests/dxm-smt-r9b.test.ts tests/dxm-smt-r7.test.ts
npm test
npm run typecheck
npm run lint
npm run build
```

- 定向 5 文件全绿；全量无新增失败；typecheck 0；lint 0 error。
- `tests/mcp-task.test.ts` 的 100ms 计时抖动属既有慢测试，单独复跑一次并写明。
- 交证据：五条命令结果、`git status --short`、`git diff --stat`。
- 一个 commit：`feat(dxm): R11-B 判重改走采集箱接口，页面读表降级`

---

## 六、真机

仍归规划方，执行方不跑：

1. 现存草稿标题 → `ambiguous`；
2. 编造标题 → `absent`；
3. 窗口最小化重复 1、2 → 结论不变；
4. 断网或登录失效 → `unknown`，文案能区分接口与页面。

零 `openTab` / 零 `activateTab` 由运行日志核对。
