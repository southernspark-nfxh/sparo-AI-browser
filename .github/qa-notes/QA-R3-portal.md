# QA 第三轮 · Portal 下拉修复说明

## 根因（已确认）

`click` 在 trusted mouse 之后又执行了合成 `CLICK_SCRIPT` DOM click。  
对 Ant Design `<Dropdown>` 等于 **点两次 = 打开又立刻关掉**，所以：

- `click` 返回 OK
- 1.5s 后 `snapshot` / `execute('.ant-dropdown li')` 仍为空

## 修复

1. **去掉 click 的 DOM backup**；下拉触发器先 hover 再 trusted click，并轮询 `list_portals`
2. **snapshot** 显式扫描 `.ant-dropdown` / `.ant-select-dropdown` / `.el-popper`，元素带 `inPortal`，ref 形如 `p.e1`
3. **新工具**
   - `menu_click({ trigger, item })` — 打开 Portal 菜单并点项
   - `click_text` — 按可见文本 trusted 点击（`withinPortal` / `caret`）
   - `list_portals` / `dismiss_overlays`
4. **录制 → 妙招**：`start_recording` / `stop_recording`（可选 title）→ traces + `%APPDATA%/sparo/skills/*.json`；`list_skills` 可列
5. **垂直包**：店小蜜等工作流默认关闭（`SPARO_ENABLE_DXM=1` 开启）

## 复测

```powershell
# 重启 npm run dev 后，在已登录的 SMT 编辑页上：
node scripts/verify-portal-menu.mjs
```
