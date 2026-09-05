# 安装 Sparo

两种方式，选一种即可。都是同一份 Windows 安装包。

## 1. 官网直接下载

1. 打开 [southernspark.dev/zh/products/sparo](https://southernspark.dev/zh/products/sparo)
2. 点 **免费下载**，保存 `Sparo-Setup.exe`
3. 双击安装，完成后从桌面或开始菜单打开 Sparo

便携版：同一页也可下 `Sparo-Portable.exe`，不用安装。

不要让使用者跑 `npm run start`。那是开发调试。

## 2. 复制给 AI 自动安装

把下面整段发给 Cursor / Claude / 任何能下文件并运行本机程序的 Agent：

```text
请帮我安装 Sparo（Windows 人机同窗浏览器）。
1. 下载最新安装包：
   https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe
2. 运行该安装包完成安装（用户目录，不要改系统盘权限）。
3. 安装结束后从桌面或开始菜单打开 Sparo。不要用 npm run start。
4. 打开后到设置：可贴自己的模型 Key，或登录体验云端模型。
校验与发布说明：
   https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest
```

也可只复制这一行下载地址：

```text
https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe
```

PowerShell 一键下载（仍要你双击安装包，Agent 不应静默改系统）：

```powershell
$out = Join-Path $env:USERPROFILE "Downloads\Sparo-Setup.exe"
Invoke-WebRequest -Uri "https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe" -OutFile $out
Start-Process $out
```

## 装好之后

1. 打开 Sparo
2. 设置里贴自己的 Key，或登录用可选云端模型（密钥不进这台电脑）
3. 打开网页，点总结 / 填表 / 回复 / 发布，或直接说话
4. 要把这扇窗交给别的 Agent：点侧栏 **复制给 Agent**

开发者从源码跑：本仓库 `npm install` 后 `npm run start`。打包：`npm run dist`，产物在 `release\`。

## 校验（0.1.15）

| 文件 | SHA256 |
|---|---|
| `Sparo-Setup.exe` | `3C29E2580D02B970DEB0886129DAE032B420B6EE33C1A69D36824B6678A7FC61` |
| `Sparo-Portable.exe` | `BAA506C5C3C664E16F9D17C290E3413087900DA875B30E64553EDE5D25C077E6` |
