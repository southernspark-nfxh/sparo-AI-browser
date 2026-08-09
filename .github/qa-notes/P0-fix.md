# P0 修复说明（对 QA报告_Phase1）

> 2026-08-08

## 已修（P0）

| 项 | 行为 |
|---|---|
| `navigate` | 加载 settle 后返回 `已打开 {url}，页面标题：{title}`，`data.confirmed=true`，含 `loadMs` |
| `fill` | 写入后回读 `actual`，`data.matched` 必须为 true 才 `ok`；支持 input/textarea/contenteditable |
| `click` | 返回 before/after 的 url/title/bodyLen，以及 `urlChanged`/`titleChanged`/`domChanged`/`changed` |

## 验收命令

```powershell
npm run accept:p0      # 百度：三项确认
npm run accept:weibo   # 微博：连续发 3 条（需已登录）
```

## 结果

- `accept:p0`：**PASS**（navigate 确认 / fill 回读 / click urlChanged）
- `accept:weibo`：工具层 3× fill.matched + send click ok（同页 SPA 可能 `changed=false`，需人目视时间线）

## 仍属 P1（QA 已列，本次未做）

- snapshot `include_hidden` / 预激活
- 可靠「回首页」路径
- `wait_for`
