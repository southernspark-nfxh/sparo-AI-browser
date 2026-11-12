# 推送打包任务书 — social-media-publish 技能 v0.3.6 冻结

> 面向窗口：打包窗口、QA 窗口、技能同步窗口
> 作者：Trae 发布窗口
> 日期：2026-11-12
> **本通知书不执行打包，只冻结本次技能改动并给出打包前置条件。**

---

## 0. 改了什么（本次冻结范围）

social-media-publish 技能本轮共 3 条核心改动 + 1 条同步修正。**只动了脚本层**，不涉及 Sparo 主进程（QA gate 没改）。

| # | 改动 | 文件 | 状态 |
|---|---|---|---|
| 1 | **头条立即发布**：「预览并发布」和「确认发布」从 page.mjs 的 clickLabeled（JS 合成 click）改成 Sparo CDP 真实点击。封面没回读到之前不点；空回执不重试，看页面结果 | `adapters/toutiao.mjs` | ✅ 已审 |
| 2 | **百家号续跑**：编辑器里已不存在的 @@IMG 标记不再重传；每张确认成功立刻 setUeContent 整篇写回，不等全部传完 | `adapters/baijiahao.mjs` | ✅ 已审 |
| 3 | **发布前质量门**：两个平台 publishOrSchedule 入口加 assertPublishReady，MARKERS_LEFT / IMAGE_COUNT_MISMATCH / COVER_REQUIRED / OPTIONS_MISMATCH 任何一项不过就不点按钮 | `adapters/toutiao.mjs` + `adapters/baijiahao.mjs` | ✅ 已审 |
| 4 | **同步流程补 platforms/**：Cursor 同步时只拷了 `scripts/*` 漏了 `platforms/` 4 个 JSON 配置目录 | 安装副本已手动补过；SKILL.md 已更新同步命令 | ✅ 已修 |

**没改的东西**（明确留在外面）：

- page.mjs 的 clickExact / clickLabeled（头条立即发布不再用它，其他平台不受影响）
- 头条定时发布路径（仍走 b.click()，两步走没动）
- 百家号定时发布路径（RC 虚拟列表滚动没动）
- Sparo 主进程 QA gate（这属于 Sparo 本体，不是技能范围）
- package.json 版本号

**上一轮修补（仍在，没被盖掉）**：头条创作助手遮罩关闭、真实 caret 光标断言、背景图缩略图 `.img-span` 识别、空包兜底、百家号行内状态限定、waitUploaded ≥1 张、台账 report.ok 守卫、verifyScheduled images null——全部保留。

---

## 1. 代码清单（需要打包的）

```
strategies/skills/social-media-publish/
├── SKILL.md                              ← 已更新（头条六条 + 同步命令 + 质量门）
├── references/
│   └── platforms.md                      ← 已更新（头条立即发布真 click + 百家号续跑）
├── platforms/
│   ├── toutiao.json                      ← 没改，但必须同步过去
│   ├── baijiahao.json                    ← 没改，但必须同步过去
│   ├── dayu.json                         ← 没改
│   └── sohu.json                         ← 没改
├── scripts/
│   ├── publish.mjs                       ← self-check 新断言
│   ├── engine.mjs                        ← 台账 report.ok 守卫
│   ├── page.mjs                          ← [class*="preview"] 选择器（保留）
│   ├── sparo.mjs                         ← 没改（真实 click 本来就在）
│   └── adapters/
│       ├── toutiao.mjs                   ← 本轮核心改造
│       ├── baijiahao.mjs                 ← 本轮核心改造
│       ├── dayu.mjs                      ← 没改
│       └── sohu.mjs                      ← 没改
└── ledger/                               ← 运行时台账，打包时排除
```

---

## 2. 打包前置条件（**必须满足才能跑 npm run dist**）

### 2.1 双份 self-check 过

```powershell
# 工作区
cd D:\download\sparo上架应用商店版\strategies\skills\social-media-publish\scripts
node publish.mjs --self-check
# → SELF_CHECK_OK

# 安装副本（当前正在用的）
cd C:\Users\60914\.trae-cn\skills\social-media-publish\scripts
node publish.mjs --self-check
# → SELF_CHECK_OK
```

### 2.2 两边 hash 全 match

```powershell
$ws = "D:\download\sparo上架应用商店版\strategies\skills\social-media-publish\scripts"
$ins = "C:\Users\60914\.trae-cn\skills\social-media-publish\scripts"
foreach ($f in @("adapters\toutiao.mjs","adapters\baijiahao.mjs","page.mjs","publish.mjs","engine.mjs")) {
  $a = (Get-FileHash "$ws\$f" -Algorithm SHA256).Hash
  $b = (Get-FileHash "$ins\$f" -Algorithm SHA256).Hash
  Write-Host "$f  match=$($a -eq $b)"
}
# → 5 个全 match=True
```

**如果有不 match**：先手动用整目录同步命令修，再跑 self-check：

```powershell
Copy-Item -Path "D:\download\sparo上架应用商店版\strategies\skills\social-media-publish" `
  -Destination "C:\Users\60914\.trae-cn\skills\social-media-publish" `
  -Recurse -Force
# 不要只拷 scripts/*——会漏 platforms/ 和 SKILL.md / references/
```

### 2.3 探针残留清空

```powershell
Get-ChildItem "D:\download\sparo上架应用商店版\strategies\skills\social-media-publish\scripts" `
  -Filter "_probe_*" | Remove-Item -Force
Get-ChildItem "D:\download\sparo上架应用商店版" `
  -Filter "CURSOR_*" -File | Remove-Item -Force
# 根目录下的 CURSOR_FIX_TASK.md / CURSOR_FIX_P0_V2.md / CURSOR_TEST_TASK.md / CURSOR_FIX_TASK_v0.3.5.md 都删
```

### 2.4 CHANGELOG.md 追加一行

在 CHANGELOG.md 顶部加一行：

```
## 0.5.3 — 2026-11-12

- [social-media-publish] 头条立即发布改为 Sparo 真实点击；百家号续跑只补编辑器里还在的 @@IMG；两个平台加 assertPublishReady 质量门（MARKERS_LEFT / IMAGE_COUNT_MISMATCH / COVER_REQUIRED / OPTIONS_MISMATCH）
```

---

## 3. 打包后 QA（发布窗口跑）

**不跑真发布**，只做静态验证 + 现有三条定时稿件回读：

```powershell
# 头条作品管理回读（3 条定时）
node publish.mjs --platform toutiao --article "<任意已有定时稿目录>" --verify

# 百家号内容管理回读（Cursor 发的两条）
node publish.mjs --platform baijiahao --article "<任意 Cursor 已发布目录>" --verify
```

回读对照：

| 稿子 | 平台 | 状态 | 时间 |
|---|---|---|---|
| 显卡降价 | 头条 | 审核中 / 定时发布中 | 将于 11-12 07:00 发布 |
| Token 科普 | 头条 | 审核中 / 定时发布中 | 将于 11-12 11:30 发布 |
| 罗大佑评论 | 头条 | 审核中 / 定时发布中 | 将于 11-12 18:30 发布 |
| 张永新笨功夫 | 百家号 | 已发布 / 审核中 | 11-12 11:43 发布 |
| 年轻人追 | 百家号 | 审核中 | 预计 2026-11-13 10:00 发布 |
| 伟大的长征 Day5 | 头条 | 审核中 / 定时发布中 | 将于 11-12 08:00 发布 |
| 伟大的长征 Day4 | 头条 | 定时发布中 | 将于 11-13 12:00 发布 |

**任何一条没对上 → 停打包，先查台账和脚本日志。**

---

## 4. 同步到已安装副本（技能同步窗口跑）

打包后重新同步一次，确保最终安装包和本机正在用的副本一致：

```powershell
# 1. 关掉 Sparo（释放文件锁）
Stop-Process -Name Sparo -Force

# 2. 整目录同步（不要只拷 scripts/*）
Copy-Item -Path "D:\download\sparo上架应用商店版\strategies\skills\social-media-publish" `
  -Destination "C:\Users\60914\.trae-cn\skills\social-media-publish" `
  -Recurse -Force

# 3. 自检
cd C:\Users\60914\.trae-cn\skills\social-media-publish\scripts
node publish.mjs --self-check
# → SELF_CHECK_OK
```

---

## 5. 禁止事项

1. **不要在打包窗口跑真发布**。QA 阶段只回读，不新增稿件。
2. **不要改 package.json**。版本号这次没提，保持 0.5.3。
3. **不要只拷 scripts/** 同步安装副本。必须整目录 `Copy-Item -Recurse -Force`。
4. **不要碰 platforms/dayu.json / sohu.json**。这两个平台本轮没动，同步时原样带走即可。
5. **不要删除 ledger/** 下的运行台账。打包时排除，但本机运行的副本需要它。

---

## 6. 交接信号

打包完成 + 同步完成 + 双份 self-check OK + 七条定时/发布稿回读全对 → 在 `docs/archive/2026-11/` 下写一份 RELEASE-CLOSEOUT-0.5.3.md，然后通知。
