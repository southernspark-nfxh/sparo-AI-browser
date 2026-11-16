# 企鹅号发布 Skill 同步报告

- 日期：2026-11-16
- Skill：`qie-publish`（企鹅号 / 腾讯内容开放平台 om.qq.com）
- 状态：**已同步并实测通过**（发布链路 + 存草稿链路 + 标签 + 自主声明）
- 用途：给打包侧确认「要带哪些文件、依赖什么、跑到什么程度算合格」

---

## 1. 同步位置

| 位置 | 作用 |
|---|---|
| `C:\Users\<用户名>\.trae-cn\skills\qie-publish\` | 本机运行副本（AI 实际调用） |
| `d:\download\sparo上架应用商店版\strategies\skills\qie-publish\` | **仓库内副本（打包以这份为准）** |

两份文件大小、修改时间、SHA256 完全一致。

## 2. 文件清单与校验值

| 文件 | 字节 | SHA256 |
|---|---|---|
| `SKILL.md` | 11165 | `4B3353811037435ECE10499F57EB7E63459C230EF50955C81983BE874E6BC8B0` |
| `scripts/qie.mjs` | 35412 | `83FB2914BE921145EAC4114212CDEA0FF34494758A650BC42F74E3C51C4EE291` |
| `scripts/make_docx.py` | 6248 | `68FDE3B3C07F3F418CAA8C9808C2ECD40CDB1525F4AD2C0A11D55C2FD2931AE1` |
| `scripts/sparo.mjs` | 16277 | `BF85281193DA400BF30589CAA524E6834AF4A5686C35126C6C314BB5C3FE5232` |

`sparo.mjs` 与 `social-media-publish` 里的同名客户端一致，可共用一份（打包时别重复改名）。

## 3. 这版新增/修好的能力

1. **标签（新）**：`setTags` / `clearTags`，按平台多选控件（`.omui-suggestion__input.is--multi`）落 chip；**发布自检强制 ≥5 个**，不足直接拒发。支持文章目录里的 `tags.txt`，也支持 CLI `--tags "a,b,c"`。标签读回缺项会自动清空重加一轮。
2. **内容自主声明（新）**：`setDeclaration`，覆盖「添加内容自主声明 → 选单选项 → 确认」。**发布和存草稿都必填**，缺了平台只在表单下留一行红字，页面不跳转。
3. **清空编辑器（新）**：`reset`，正文 / 标题 / 标签一起清。企鹅号导入是**追加**，批量发稿不清理会串稿。
4. **发布核验（重写）**：以跳到 `/management/articleManage` 为唯一成功信号；再按标题读作品管理卡片取状态（审核中 / 未通过 / 已发布）。编辑器里的「已保存」不算。
5. **存草稿核验（重写）**：另开标签页去「内容管理 → 草稿」按标题核对，不再拿自动保存提示当成功。
6. **兼容发布包占位符**：正文支持 `@@IMG1@@`（按 `images/` 文件名排序取第 N 张）、`@@IMG path`、`![alt](path)` 三种写法。
7. **健壮性**：分类已是目标值就跳过；连续 `execute` 回空串自动重试；底部按钮轮询等待渲染；`close_tab` 参数修正为 `id`。

## 4. 实测记录（2026-11-16）

| 稿件 | 流程 | 结果 |
|---|---|---|
| `黄仁勋回归_发布包_2026-11-16\baijiahao` | 导入 4 图 / 2209 字 → 标题「还在等黄仁勋回来拉股价？别做梦了」→ 分类财经 → 8 个标签 → 虚构演绎声明 → 发布 | **发布链路成功**，作品管理出现该篇；随后平台审核判「未通过：文章内容不符合安全相关规定」 |
| 同包 `toutiao` | 同上，标题「抄底英伟达的人，先别高兴太早」→ 存草稿 | **成功**，草稿箱可见（状态：草稿） |

标签实测 8 个：`黄仁勋 / 英伟达 / 人工智能 / 芯片 / 美股 / 科技 / 财经 / 半导体`。

> 审核未通过是内容层（稿件把虚构事件写成真实新闻），不是脚本问题。链路本身两篇都跑通了。

## 5. 打包侧要做什么

1. 把整个 `strategies\skills\qie-publish\` 目录原样带入安装包，**不要拍平目录结构**。
2. 运行依赖：
   - Node.js ≥ 18（脚本用 ESM + top-level await）
   - Python 3 + `python-docx`（生成导入用的 docx；没装则只能在 CLI 层用 `--docx` 传现成文件）
   - 本机 Sparo 运行中且 MCP 可用：`GET http://127.0.0.1:3921/health`
3. 不含任何密钥、不含云端模型配置；只走本机 127.0.0.1 的 MCP。
4. 不改主进程、不做热更；安装包不会自动更新这个 skill，换版要重新打包。

## 6. CLI 参考（给上层多平台 skill 对接）

```text
node qie.mjs probe                                     # 读状态：标题/字数/分类/标签/声明
node qie.mjs import  --article <目录|md>
node qie.mjs title   --title "标题"
node qie.mjs category --name 财经
node qie.mjs tags    --tags "标签1,标签2,..."
node qie.mjs declaration --name "虚构演绎，仅供娱乐"
node qie.mjs reset
node qie.mjs draft   --article <目录|md> --tags "..." --declaration "..." [--category 财经] [--reset]
node qie.mjs publish --article <目录|md> --tags "..." --declaration "..." --yes
```

- 所有命令输出 JSON，`ok:false` 必带 `error`，`steps[]` 逐步留痕；上层直接读 JSON。
- `publish` 必须显式 `--yes`（这道闸留给 AI/人确认）。
- 文章目录约定：`title.txt` / `body.md` / `images/` / 可选 `tags.txt` / 可选 `cover.jpg`。

## 7. 已知边界（不是缺陷，但要写进验收预期）

1. **发布成功 ≠ 审核通过**。审核异步，几分钟内可能变「未通过」，要回读作品管理状态。
2. 账号有每日发布条数限制（实测提示「今天还能发布5条」）。
3. docx / pdf / txt 单文件 ≤ 10MB，一次一个。
4. 企鹅号编辑器会自动恢复上次草稿；批量发稿前先 `probe`，必要时 `reset`。
5. Sparo 侧两个已知限制（脚本已绕开，打包不受影响）：`press` 只认单键（无 Ctrl+A）；`screenshot` 只截当前活动标签。

## 8. 打包验收清单

- [ ] `strategies\skills\qie-publish\` 四个文件齐全，SHA256 与第 2 节一致
- [ ] 安装后 `node qie.mjs probe` 能在已登录企鹅号的 Sparo 上返回 `editorReady:true`
- [ ] 导入 + `tags` 能落 chip，`probe` 的 `tags` 数量 = 传入数量
- [ ] `draft` 返回 `steps` 含「草稿箱 found:true」
- [ ] `publish --yes` 返回「核验发布 ok」且「作品管理 found:true」
