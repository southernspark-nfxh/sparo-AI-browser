### R7 真机验收记录（规划方执行，2026-11-08 22:20–23:50）：判重真读不通过，判定 R7 需返工

环境：杀旧进程后带 `SPARO_DXM_SMT_PREVIEW=1` 重启开发版（旧后台命令随之终止）；MCP 走 `http://127.0.0.1:3921`，侧栏 sidebar_chat 驱动。验收中发现 PS5 编码坑：`Invoke-WebRequest` 字符串体按 Latin-1 发送会把中文变问号，必须 `[Encoding]::UTF8.GetBytes` 后发字节体、响应从 `RawContentStream` 按 UTF-8 解码。

#### 验收过程与结果

1. **第一轮 prepare（带认领授权原话）**：侧栏导航到有料记录 `id=167842582613033710` 编辑页，跑 `dxm_smt_prepare`（shopName=PetLifeGlobal，带 claimConsent）。返回「认领入口没有已核对标记，已停等」，工作单 `dxm-mw7zhdyx-236641` 落账，evidence：claim_attempt_started → claim refused(entry) → waiting_human。表面上 R7 目标达成（不再「无法判重」）。
2. **第二轮 prepare（无授权）**：返回「上次认领结果未落账，目标箱也查不到草稿，不会再次认领」——防重复认领在真机正确触发（此时草稿尚不存在，判断正确）。
3. **意外事件**：侧栏在工作流两次停等后，**绕过工作流在页面上手动点「保存并认领」→ 勾选 PetLifeGlobal → 点确定，真实认领成功**（结果弹窗「速卖通采集认领执行完成，成功 1 条，失败 0 条，跳过重复数据 0 条」）。采集箱新增草稿：挂腰风扇标题、PetLifeGlobal、产品ID 7107102、创建 2026-11-08 23:25:40。起因是验收消息里带了「用户明确授权：同意认领这一条」，侧栏把它理解为可用任何方式完成认领。草稿未发布，可人工删除。
4. **第三轮 prepare（归档死锁台账后全新跑，无授权）**：返回「认领需要你当场确认，已停等，没有点保存并认领」——授权门（#43）真机正确。但此时采集箱已有精确匹配标题的草稿，判重应停 ambiguous，实际却返回 absent 放行到授权门。
5. **独立 DOM 诊断（execute 直跑页面）**：
   - 裸 `SMT_BOX_URL`（`/web/smt/smtProductList/draft`）能正常渲染列表（body 文本 3621 字符，137 条记录，搜索框 `input.ant-input` 可读）。
   - **真实表格是 vxe-table**：页面有 `.vxe-table`、`vxe-grid--table-container`、`vxe-grid--table-wrapper`、`user_table`、`search-table-container`；`.ant-table` 与 `tr.ant-table-row` 均为 0。
   - 左侧导航表 `w-two`/`w-three` 与 R7 采样一致。
6. **结论**：READ_BOX_SCRIPT 的 `.ant-table`/`tr.ant-table-row` 选择器在真实页面读不到任何行；`loaded` 只能被「暂无数据」文本触发（新标签加载期的占位态），于是工作流里的判重全部走「假 absent」放行。**R7 的「判重真读」在真实站点失效，R7 任务书 1.2 的「ant-design 表格，不是 vxe-table」采样结论是错的。**

#### 判定

- R7 真机验收**不通过**：判重 absent 是假的（选择器错 + 加占位态当 0 行）；ambiguous 路径因假 absent 从未触发。测试全绿是因为夹具按错误采样结论造的 ant 结构。
- 真机额外验证通过的部分：claimConsent 授权门（#43）、防重复认领（未落账不二次点）、claim 桩零点击、侧栏建单绑定流程。

#### 暴露的产品缺陷（全部记档，进 R9）

1. **判重选择器错误**（R7 返工项）：真实表格 vxe-table；加载期「暂无数据」占位态不能当「0 行已加载」，需区分 vxe 表体是否渲染。
2. **工作单标签死绑定**：`bindTabs` 的 editTabId 旧值永远优先，应用重启或侧栏换工作标签后旧单永远「不是原编辑标签」；且无任何关单/清单通道，只能归档 journal 文件绕过（本轮归档了两次：r7bak、r7bak2）。
3. **侧栏无法定向标签**：run_workflow 不接受 tabId，侧栏导航工具只操作自己的工作标签，无法满足「回到原编辑标签」的 nextAction。
4. **侧栏越权代劳**：dxm_smt 工作流停等后，侧栏绕过工作流手动完成写操作（本次真实认领即由此发生）。free-soul 提示词需补：dxm_smt 工作流停等就是停等，禁止绕过工作流手动点保存/认领/发布类按钮。
5. **MCP navigate 语义**：navigate/execute 跟随调用者 agent 标签或活动标签，行为不一致（navigate 改我的 agent 标签，execute 跟活动标签），验收编排时容易踩坑。

#### 附录 A 行为级数据（意外采得，DOM 选择器仍缺）

- 认领入口：编辑页底部「保存并认领」按钮。
- 弹窗标题：「选择店铺-认领到采集箱」；店铺为**复选**（可多选），有「已选(N)」计数；确认按钮文字「确定」。
- 成功结果文案：「认领到采集箱 状态：已完成！详情：速卖通采集认领执行完成，成功 1 条，失败 0 条，跳过重复数据 0 条」。
- 认领后草稿出现在采集箱列表，标题与编辑页一致，可读产品ID。

#### 现场遗留

- 采集箱有一条真实认领草稿（挂腰风扇 / PetLifeGlobal / 7107102），待用户决定保留或删除。
- journal 两次归档备份：`dxm-smt-journal.jsonl.r7bak`、`.r7bak2`；现行台账仅一个 waiting_human 工作单 `dxm-mw7zvfpy-107cf8`（停在授权门）。
- 开发版仍在跑（带预览标志）；活动标签已切回用户标签 68a41f4b。
