# 安装 Sparo

两种装法，选一个就行。

## 自己装（一分钟）

1. 下载 Windows 安装包（`Sparo-Setup.exe`）：
   - 官网产品页：https://southernspark.dev/zh/products/sparo （点「免费下载」）
   - GitHub 直链：https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe
2. 双击安装包，按提示装完。装到自己的用户目录就好，不用动系统权限。
3. 从桌面或开始菜单打开 Sparo。

安装包只有 Setup 一种，没有便携版，也不需要命令行。

## 让 AI 帮你装

把下面这段原样复制给 Cursor / Claude：

```text
请帮我安装 Sparo，一款装在 Windows 上的 AI 浏览器。
1. 下载最新安装包：https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe
2. 运行该安装包完成安装（用户目录即可，不要改系统盘权限）。
3. 安装结束后从桌面或开始菜单打开 Sparo。不要用 npm run start。
4. 打开后到设置：可贴自己的模型 Key，或登录体验云端模型。
```

也可只复制这一行下载地址：

```text
https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe
```

## 装好之后

1. 打开 Sparo
2. 设置里贴自己的 Key，或登录用可选云端模型（密钥不进这台电脑）
3. 打开网页，点总结 / 填表 / 回复 / 发布，或直接说话
4. 要把这扇窗交给别的 Agent：点侧栏 **复制给 Agent**

开发者从源码跑：本仓库 `npm install` 后 `npm run start`。打包：`npm run dist`，产物在 `release\`。

## 校验

想确认下载的是原版：SHA256 校验和随每次 GitHub Release 公布：

https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest

| 文件 | SHA256 |
|---|---|
| `Sparo-Setup.exe` | `3C29E2580D02B970DEB0886129DAE032B420B6EE33C1A69D36824B6678A7FC61` |
