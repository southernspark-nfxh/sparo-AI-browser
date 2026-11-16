# 打包通知书 — 微信公众号发布能力（2026-11-16）

## 一、这次打进去什么

新增「微信公众号图文发布（存草稿）」能力，走 Sparo 本机 MCP 通道，与头条/百家号/大鱼号/搜狐号同一套 `publish.mjs`。

已提交：`c427c27 feat(发布): 接入微信公众号发布适配器并沉淀新平台接入流程`

| 文件 | 状态 | 说明 |
|---|---|---|
| `strategies/skills/social-media-publish/scripts/adapters/weixin.mjs` | 新增 | 微信公众号适配器 |
| `strategies/skills/social-media-publish/platforms/weixin.json` | 新增 | 平台规则表（`--plan` 用） |
| `strategies/skills/weixin-publish/SKILL.md` | 新增 | 微信发布技能说明 |
| `strategies/skills/social-media-publish/scripts/ONBOARDING_NEW_PLATFORM.md` | 新增 | 新平台接入流程与踩坑 |
| `social-media-publish/scripts/engine.mjs` | 修改 | 注册 `weixin` 适配器 |
| `social-media-publish/scripts/publish.mjs` | 修改 | `PLATFORMS` 加入 `weixin` |
| `social-media-publish/SKILL.md` | 修改 | 平台清单与用法 |

无新增 npm 依赖，不需要额外 `npm install`。

## 二、打包命令

```powershell
npm run dist
```

产物：`release\Sparo-Setup.exe`

## 三、打包时必须核对（electron-builder.yml）

1. `extraResources`：`strategies/skills/social-media-publish/scripts` → `resources/social-publish-scripts`
   - 打包后 `resources\social-publish-scripts\adapters\weixin.mjs` 必须存在
2. `extraResources`：`strategies/skills/social-media-publish/platforms`（`--plan` 依赖）
   - 打包后 `platforms\weixin.json` 必须存在
3. `files`：`strategies/skills/**/*`
   - 打包后要能找到 `weixin-publish/SKILL.md`

以上 3 条都在现有配置里，不需要改 `electron-builder.yml`，但要确认没被漏掉。

## 四、打包后自检（3 条，缺一不可）

1. 解包或安装后检查 `resources\social-publish-scripts\adapters\weixin.mjs` 存在，且里面有 `export const weixin`。
2. 检查 `weixin.json` 在打包产物里。
3. 起 Sparo（已登录 mp.weixin.qq.com），在技能目录跑：

```powershell
cd resources\social-publish-scripts   # 或仓库 strategies\skills\social-media-publish\scripts
node publish.mjs --platform weixin --probe
```

期望：`{"ok":true,...,"detail":"PROBE_OK"}`

## 五、这次没做、不要对外宣称

- **群发发表**：只做存草稿，发表由人点（不可逆操作）
- **定时发布**：未接入
- **正文插图**：未接入（`insertImages` 仍跳过）

## 六、注意事项

- 版本号未改，仍是 `0.6.8`。若要发新版，请在打包窗口自行改 `package.json` 版本并同步 `CHANGELOG.md`。
- 不要动 `docs/listings/`（提审前另做一轮）。
- 主进程不热更；安装包不会自动更新。
- 本地已提交，但未推送 GitHub（当前环境没有凭据）。打包请直接用本地工作区，不要依赖远程。
- 工作区还有其它未提交改动（`src/`、`docs/`、`CHANGELOG.md`、`package.json`、`electron-builder.yml` 等），不是本次微信功能引入的，打包前请按你们既有流程决定是否一并纳入。

## 七、验收口径（人能看见的）

1. 界面里能发出微信稿：标题、正文、封面都进编辑器。
2. 存草稿后，公众号后台「草稿箱」列表能看到这篇，且**缩略图有封面**。
3. 全程不抢焦点，不弹登录框（已登录状态下）。
