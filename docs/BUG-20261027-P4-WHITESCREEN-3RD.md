# P4 白屏第三次复发：页面视图盖住壳层，守卫烧完预算撒手

> 2026-10-27 用户日常使用中截图报障。只登记，不在第三轮里修。
> 严重度：高。壳层（标签栏/地址栏/侧栏）整块消失，用户连侧栏都看不见，可用性事故。
> 前科：首发 `archive/2026-10/BUG-20261024-COLLECT-LOOP-WHITESCREEN.md`（10-24）；第二次在 0.1.18 打包验收复发两次（`archive/2026-10/TASK-20261026-采集闭环与白屏四修任务书.md`，证据 `qa-screenshots/accept-packed/2-chrome-vanished.png`）；`d8d5199` 补过触发时机并进了 0.1.19。这是**第三次**。

## 证据

`qa-screenshots/p4-3rd/1-ctrip-whitescreen.png`（2026-10-27 用户提供）。

窗口内容：携程机票列表页（北京→南京，2026-10-31，往返）。关键特征：

1. 右上系统按钮下方**直接就是携程自己的页头**（汉堡菜单 + 「携程旅行」logo + 搜索框 + 登录/注册）——中间没有 Sparo 的标签栏和地址栏；
2. 窗口里看不到聊天侧栏；
3. 页面内容只占左侧约一半，右侧约 45–50% 纯白。

判读：页面视图（WebContentsView）被拉成整窗，把壳层整块盖住——P4 白屏同一形态。右侧大白边是携程机票页自己的左锚布局（站点行为，修好守卫后它仍会在，不是本单缺陷）；要修的是壳层被盖。

待补信息（修 F3 时向用户要，不阻塞开工）：当时用的是安装包 0.1.19 还是开发版 HEAD；触发前在做什么（侧栏查机票 / 自己浏览 / 窗口最小化过）。

## 为什么又没兜住

- 现行守卫是**事件触发清单 + 预算**：`armChromeGuard` 只在少数时机排 4 个延迟重排（启动、壳假死恢复）；`page-bounds.ts` 的 `takeChromeCoverFix` 是「3 秒内最多修 8 次，**返回 allow=false 时调用方不再重排**」，烧完预算就撒手，等下一次 restore/resize 才有机会救。
- [browser.ts L2239 注释](../src/main/browser.ts)自己写着：`addChildView` 之后、阅读页首屏绘制时，Chromium 会把子视图拉成整窗。触发面不止这两个，靠列清单补一轮漏一轮——前两轮已经验证过这条路走不通。
- `d8d5199` 的修法（补 restore/resize 触发 + 清预算）在 0.1.19 里已被这次复发证伪。

## 修向（第四轮 F3 采纳）

从「补触发时机」换成「常驻断言 + 自愈 + 诊断」，不再猜触发面：

1. 常驻低频断言：活跃页视图 bounds 与 #pageHole 最近一次上报值持续比对（约 2 秒粒度；窗口销毁/全部后台标签除外），发现盖住壳层立刻拉回。
2. 删除「修 N 次就放弃」的语义：预算只做限频去抖，永不永久放弃；restore/resize 清预算保留。
3. 诊断落盘：每次自愈与活跃视图 bounds-changed 记主进程日志（old/new bounds、窗口最小化/最大化态、activeTab、时间），再复现时有账可查。
4. 靠诊断日志抓「谁把视图拉成整窗」的调用方，源头能防就防（检查哪些挂载路径没走 `pinViewBeforeMount`）。

---

# 第五轮（2026-11-12）：不是页面盖壳层，是壳层自己停帧

## 症状（与 P4 不同）

网页区域正常显示，**上方标签栏/地址栏和右侧侧栏整块发白**；同时开三扇窗口，三扇一起白；只能最小化再最大化才恢复。P4 的形态是「壳层被页面盖住，露出的是站点自己的页头」，这一轮是「壳层位置什么都没有，纯白」——判读为壳层渲染表面（frame sink）停帧，网页视图是另一条合成链，所以它还在画。

## 修法

1. 壳层每秒报一次「这一秒新画了几帧」（`shell.html` 里的 rAF 计数器 + `shellHtmlPreload` 的 `shellHeartbeat`）。
2. 主进程 `onShellHeartbeat` 用 `page-bounds.ts` 的 `shellPaintStalled` 判定：**只在前台、可见、未最小化的窗口**，连续 3 拍 0 帧才算停帧，冷却 3 秒最多打一枪；停帧时 `webContents.invalidate()` 强制整窗重绘——等于替人做那次最小化/最大化。满 9 拍还没好就落盘一次 `[shell-paint] stalled`。
3. show / restore / 显示器变化 / 解锁 / 休眠恢复都补一次 `invalidateShell`（这几种时机 DWM 会重建合成表面，不主动重绘就停在白屏）。
4. `assertChromeHole` 从「只查当前窗口」改成遍历所有窗口各查各的洞；heal / remount 日志一并落盘（`chrome-hole-heal`、`chrome-hole-action`）。
5. `openWindow` 出来的窗口补齐原先只有主窗口才挂的 `render-process-gone`（重载）与 `unresponsive`（拉回），多开时壳层崩掉不会留下一扇死白。

## 复发时怎么查

`%APPDATA%\sparo-store\diag\crash.log`：

- `[shell-paint] heartbeat online win=…` 有 → 心跳通了；
- `[shell-paint] repaint …` → 判定停帧并已主动重绘；`[shell-paint] stalled …` 连着出现说明 invalidate 也压不住，下一轮得往 GPU 合成器方向查；
- 一条 `[shell-paint]` 都没有、壳层却白 → 壳层自己的定时器也停了（渲染进程挂起），看 `render-process-gone` / `unresponsive`。
