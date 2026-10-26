# 任务书 · 官网产品页和下载安装包一起更新到 0.1.18

> 交给另一个窗口执行。本窗口只核对事实，没有改官网，也没有替换线上 exe。
> 工作根目录：`D:\download\sparo上架应用商店版`
> 日期：2026-10-23

## 结论

线上产品页还是 **v0.1.15**，截图是旧界面。「免费下载」下到的 exe 是 **2026-09-09** 的文件。本机 2026-10-22 打出来的 **0.1.18** 安装包没有传到官网。

源码已经在 GitHub：`https://github.com/southernspark-nfxh/sparo-AI-browser`，分支 `master`，提交 `3f8a08f`。官网工程不在本仓库，本机 `D:\download`、文档、source、code、projects 里也没有 `hero-carousel.png`。部署窗口需要自己找到那个 Astro 站点（页面引用 `/_astro/*.css`）。

## 要换上去的安装包

| 项 | 值 |
|---|---|
| 文件 | `D:\download\sparo上架应用商店版\release\Sparo-Setup.exe` |
| 版本 | `0.1.18`（`D:\download\sparo上架应用商店版\package.json` 的 `version`） |
| 大小 | 92222281 字节 |
| 本机写入时间 | 2026-10-22 18:50:14 |
| SHA256 | `4EB07FBF4E6CAD2218FA76341C9BF817FE978B37970189344148E469C734E9D9` |
| 打包命令 | 在上面的根目录执行 `npm run dist`。不要改文件名。 |

线上现在这个地址：

- 页面按钮：`https://southernspark.dev/downloads/Sparo-Setup.exe`（相对路径 `/downloads/Sparo-Setup.exe`，中文页三处、页头一处）
- 响应：`Content-Length: 91738886`，`Last-Modified: Wed, 09 Sep 2026 03:44:34 GMT`

用本机这个 exe **覆盖**该下载文件，文件名仍是 `Sparo-Setup.exe`。不要另起一个带版本号的文件名，否则现有按钮会继续下到旧包。

## 要改的线上页面

中文：https://southernspark.dev/zh/products/sparo

英文：https://southernspark.dev/products/sparo （页头语言开关指向这里，两份一起改）

页面上现在写死的内容：

| 位置 | 现在 | 改成 |
|---|---|---|
| 角标 | `版本 v0.1.15` | `版本 v0.1.18` |
| 主图 | `/products/sparo/hero-carousel.png`，也是 `og:image` | 换成现在的浅色 Studio 窗口。可用本机 `D:\download\sparo上架应用商店版\sparo-uiux-qa\screens\t16-light.png` |
| 下方左图 | `/products/sparo/hero.png` | 两行地址栏 + 侧栏的当前窗口。可用 `...\sparo-uiux-qa\screens\t16-light.png` 或 `t18-go-row.png` |
| 下方右图 | `/products/sparo/gallery-02.png` | 多标签时顶栏仍在的窗口。可用 `...\sparo-uiux-qa\screens\t17-dense.png` |
| 「复制给 AI 帮你装」 | 指向 `https://github.com/southernspark-nfxh/sparo-agent-browser` | 安装包直链可以继续写官网 `/downloads/Sparo-Setup.exe` 的绝对地址。源码仓库改成 `https://github.com/southernspark-nfxh/sparo-AI-browser` |
| 「GitHub 源码」 | `https://github.com/southernspark-nfxh/sparo-agent-browser` | `https://github.com/southernspark-nfxh/sparo-AI-browser` |

截图必须能看出：浅色底、两行顶栏（标签一行、地址栏一行）、右侧栏。现在线上那三张是单行旧界面，不能留。

文案里的「发不发，你说了算」「自己的 Key / 云端模型」可以留。不要在这一页加价格或付款按钮。

## 本仓库里要一起改的文档

部署窗口改完线上文件后，回到本仓库改校验和，使文档和刚传上去的 exe 一致：

| 文件 | 改什么 |
|---|---|
| `D:\download\sparo上架应用商店版\docs\INSTALL.md` | 表里的 SHA256 从 `A0D9061D268B4F6EF9841634DBD0EFEE9DC918E976C45F7B1D420B6D29B4AECE` 换成 `4EB07FBF4E6CAD2218FA76341C9BF817FE978B37970189344148E469C734E9D9`。给人的下载说明仍是官网产品页。给 AI 的直链若仍指向 `sparo-agent-browser` 的 Release，而那个 Release 没有这个新包，就改成官网绝对地址 `https://southernspark.dev/downloads/Sparo-Setup.exe` |
| `D:\download\sparo上架应用商店版\README.md` | 同样的下载地址和仓库名，和 INSTALL 保持一致 |
| `D:\download\sparo上架应用商店版\CHANGELOG.md` | 开头「未发布」各节就是 0.1.18 相对旧官网包多出来的行为：浅色 Studio / 夜间 Glacier、标签多开顶栏不长高、网页不再盖住顶栏和侧栏、纸飞机发送按钮、只说打开某站就收工。版本行仍是商店版 0.1.18，不要另写一个版本号 |

说明这次界面对用户可见的文档：

- `D:\download\sparo上架应用商店版\docs\ARCHITECTURE.md`（页面洞不能盖住顶栏）
- `D:\download\sparo上架应用商店版\docs\PRODUCT-TASKBOOK.md`（v0.3.6，2026-10-22 已落地）
- `D:\download\sparo上架应用商店版\sparo-agent-upgrade\PLAN.md`
- `D:\download\sparo上架应用商店版\sparo-uiux-qa\tasks\00-修改总计划.md`

这些已经在 `3f8a08f` 里。不要改 `D:\download\sparo上架应用商店版\docs\listings\`。

## 不要做

- 不要把 `release\Sparo-Setup.exe` 提交进 git。`release\` 在 `.gitignore` 里。
- 不要改 `package.json` 的版本号。这次对外就是已经打进安装包的 0.1.18。
- 不要用 `D:\download\Sparo` 那份源码打包。商店版只认本目录。
- 不要在产品页写价格、付款、套餐金额。

## 验收

1. 中文页和英文页角标都是 `版本 v0.1.18`。
2. 三张产品图是两行顶栏的当前窗口，不是旧的单行地址栏。
3. `curl -sI https://southernspark.dev/downloads/Sparo-Setup.exe` 的 `Content-Length` 为 `92222281`，`Last-Modified` 晚于 2026-10-22。
4. 下载下来的文件 SHA256 等于 `4EB07FBF4E6CAD2218FA76341C9BF817FE978B37970189344148E469C734E9D9`。
5. 页上「GitHub 源码」打开的是 `sparo-AI-browser`。
6. `docs/INSTALL.md` 里的 SHA256 与这个文件一致，并已推到 `sparo-AI-browser` 的 `master`。
