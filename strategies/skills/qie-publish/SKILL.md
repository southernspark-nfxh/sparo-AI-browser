---
name: qie-publish
description: 通过本机 Sparo 浏览器 MCP 通道，在企鹅号（腾讯内容开放平台 om.qq.com）后台完成「导入 docx 正文 → 填标题 → 选分类 → 加标签（≥5）→ 内容自主声明 → 过 AI 生成声明 → 存草稿 / 发布 → 核验」。脚本只做机械步骤，审稿与异常判断交给 AI。Use when the user asks to publish / 发稿 / 存草稿 / 导入稿子 to 企鹅号 / 腾讯内容开放平台 / om.qq.com, or mentions sparo 发企鹅号.
---

# 企鹅号发布（潜意识脚本 + 意识审稿）

企鹅号后台有一个别的平台没有的入口：编辑器工具栏的 **插入文档**，吃 docx/pdf/txt，把正文连同**图片**一起灌进编辑器。这是整条链路里最省事的一步，也是本 skill 的主干。

2026-11-16 已端到端实测：导入（4 图 / 2209 字）→ 标题 → 分类 → 8 个标签 → 自主声明 → 发布成功（作品管理出现该篇，随后被判「未通过：文章内容不符合安全相关规定」，属内容审核，不是链路问题）→ 第二篇同流程存草稿，草稿箱可见。

## 两套系统怎么分工

| 阶段 | 谁做 | 做什么 |
|---|---|---|
| 生成 docx | 潜意识（脚本） | markdown/文章目录 → docx，标题从小标题层级里剥离 |
| 导入正文 | 潜意识（脚本） | 点「插入文档」→ `#fileInput` 上传 → 等到字数变长 |
| 填标题 | 潜意识（脚本） | 标题框是 contenteditable，一次 `fill` + 回读比对 |
| 选分类 | 潜意识（脚本） | 分类必填，虚拟列表要滚到可见再点 |
| 加标签 | 潜意识（脚本）+ **意识** | **每篇 ≥5 个**；AI 负责挑「高流量 + 相关」的词，脚本负责落成 chip |
| 自主声明 | 潜意识（脚本）+ **意识** | 发布 **和存草稿** 都必填；选项由 AI 按稿件性质定（虚构/转载/个人观点/时政…） |
| AI 生成声明 | 潜意识（脚本） | 合规弹窗，无 AI 素材直接「提交」 |
| 审稿 | **意识（AI）** | 读回正文、核对标题/图/顺序，改稿、换标题 |
| 异常兜底 | **意识（AI）** | 脚本某步 `ok:false` 就停手，由 AI 看页面判断，不要硬重试 |
| 发布 / 定时 | 意识拍板，脚本执行 | `publish` 必须显式 `--yes`，且发布后必须核对作品管理 |

**铁律**：
1. 发布前必须把人审过的稿子交给 AI（意识）过一遍，不允许脚本直接点到发布。
2. 每篇必须 **≥5 个标签**，`publish` 自检不通过直接拒发。
3. 「点完发布」不等于发出去：只有跳到 `/management/articleManage` 或出现成功提示才算，编辑器里的「已保存」是假信号。

## 用法

前提：Sparo 已启动（`http://127.0.0.1:3921/health` 为 ok），企鹅号已登录（账号：东望观察），`python-docx` 可用。

```bash
cd C:\Users\60914\.trae-cn\skills\qie-publish\scripts

node qie.mjs probe                                # 状态：标题/字数/分类/标签/声明/封面
node qie.mjs import  --article <目录|md>          # 只导入正文（生成 docx 并上传）
node qie.mjs title   --title "标题"
node qie.mjs category --name 财经
node qie.mjs tags    --tags "标签1,标签2,..."      # 不带 --tags 则只读当前标签
node qie.mjs declaration --name "虚构演绎，仅供娱乐"
node qie.mjs reset                                 # 清空正文/标题/标签（导入是追加！）
node qie.mjs draft   --article <目录|md> --tags "..." --declaration "虚构演绎，仅供娱乐" [--category 财经] [--reset]
node qie.mjs publish --article <目录|md> --tags "..." --declaration "..." --yes
```

`draft` 和 `publish` 都要求 `--declaration`（企鹅号存草稿也要自主声明，缺了只会留一行红字、草稿不落库）。

文章目录约定与 `social-media-publish` 一致：`title.txt` / `body.md` / `images/`；
也接受单个 `.md`（第一行 `# 标题` 当标题，其余当正文），或直接 `--docx 文件` 跳过生成。
可选 `tags.txt`（换行 / 逗号 / 顿号分隔），目录里有时 `draft`/`publish` 自动带上，CLI 的 `--tags` 优先。

图片占位符支持三种：`![说明](images/x.jpg)`、`@@IMG images/x.jpg`、`@@IMG1@@`（按 `images/` 文件名排序取第 N 张，发布包常用这种）。

全部命令输出 JSON，`ok:false` 必带 `error`，`steps[]` 逐步留痕——**给上层的多平台 skill 直接读这个 JSON 就行**，不要解析中文日志。

## 页面锚点（改了要同步这里）

| 目标 | 选择器 / 判定 |
|---|---|
| 编辑器 | `https://om.qq.com/main/creation/article` |
| 作品管理 | `https://om.qq.com/main/management/articleManage`（发布成功的唯一硬信号） |
| 插入文档按钮 | `button.exeditor-menu-basic-file` |
| 文档上传框 | `#fileInput`（点按钮后动态生成，accept = pdf/txt/docx） |
| 解析中 | 弹窗文案含「文件解析进行中」 |
| 标题 | `.omui-articletitle__input1 .omui-inputautogrowing__inner` |
| 正文字数 | 页面文本 `正文字数：N` |
| 分类 | `.omui-suggestion`（宽度 >300 的那个）→ `input`；值在 `.omui-suggestion__value-single` |
| 分类选项 | `.omui-suggestion__option`（绝对定位虚拟列表） |
| 标签框 | `.omui-suggestion__input.is--multi`（全页唯一 multi）→ `input`；chip 是 `.omui-suggestion__choselabel` |
| 自主声明入口 | 虚线按钮「添加内容自主声明」 |
| 自主声明面板 | 弹窗含「发布内容自主声明」，单选项 `label.omui-radio`，确认按钮「确认」 |
| 发布后状态 | 弹窗提示 / 当前错误 `.omui-form__help-error`（如「请选择自主声明」） |
| AI 声明 | `.omui-dialog` 含「生成声明」，按钮「提交」 |
| 底部按钮 | `发布` / `定时发布` / `存草稿` / `预览` |
| 封面 | 正文有图时自动取一张单图，无需干预（`coverPicked`） |

## 已踩过的坑

1. **标题不会跟着 docx 进来**。docx 的一级标题只会变成正文第一行加粗大字，标题框仍是空的。所以生成 docx 时会把与 title 相同的一级标题跳过，标题单独 fill。
2. **分类是虚拟列表**：选项绝对定位、会被裁切。必须先滚到完整可见；并且**只认页面内事件**（`mousedown/mouseup/click`），Sparo 的真实点击在虚拟列表上会点偏、值不变。脚本已按此实现，别再改回 `click`。分类已经是目标值就直接跳过，别重复展开。
3. **Sparo 的 `press` 只认单键，没有修饰键**。`press("Control+A")` 会被当成文本打出 `"Co"`（曾把标题污染成「…样稿Co」）。要全选就在页面内用 Range：`range.selectNodeContents(ed)` 再 `press("Backspace")`，最后补一下 `document.execCommand('delete')`。`press("Space")` 是可用的单键。
4. **标签框不能用 placeholder 找**：空的时候有 `.placeholder`（「最多9个标签…」），一旦有 chip 这个节点就消失。稳定锚点是 `.omui-suggestion__input.is--multi`（分类是 `value-single`）。加标签 = `fill` + `press("Space")`。
5. **`click` 会把声明弹窗的「提交」拦下**：QA 门误判成「速卖通产品编辑页」→ `QA FAIL`。脚本走页面内点击。这是 Sparo 侧缺陷，已记录。
6. **`screenshot` 只截当前活动标签**，不认 `tabId`。要截图先 `switch_tab`，否则截到别的页面。
7. **导入是追加，不是替换**。批量发稿必须先 `reset`（正文/标题/标签都清），否则上一篇会串进来。
8. **发布和存草稿都必填「内容自主声明」**（不是只有定时发布才要）。不选就点：页面不跳转、只在表单下留一行红字「请选择自主声明」，而编辑器仍显示「已保存」——极易误判成功；草稿也不会落到草稿箱。可选值：无需标注 / 该文章由AI生成 / 该文章由AI辅助创作 / 个人观点，仅供参考 / 虚构演绎，仅供娱乐 / 内容为转载 / 内容包含营销广告信息 / 健康医疗分享，仅供参考 / 危险行为，请勿模仿 / 事件时间地点可考证。
9. **作品管理列表是 div 卡片不是 table**，按 `tr` 找不到行；按标题 + 状态词找最小容器。
10. **「已保存」不是保存成功的证据**，它只是自动保存提示。`draft` 现在会另开标签页去 内容管理 → 草稿 按标题核对（`verifyDraft`），`publish` 以跳到 `/management/articleManage` 为准。
11. **发布成功 ≠ 审核通过**。2026-11-16 实测：链路成功、作品管理出现该篇，几分钟后状态从「审核中」变「未通过 / 文章内容不符合安全相关规定」。定稿后要回读状态，别只看发布那一下。虚构新闻、编造人物事件这类内容企鹅号会按安全规定拒稿。
12. **标签不能重复输入**：对已有 chip 再 `fill` + Space 会把它顶掉。`setTags` 先读已有 chip 再补；万一读回缺项，会自动清空重加一轮（`repaired:true`）。
13. **Sparo 连续 `execute` 偶尔回空串**（页面重渲染/跳转时）。`probe` / 底部按钮都带重试；看到 `execute 无结果` 先等一秒重试，不要判定元素不存在。另：`close_tab` 参数名是 `id`，不是 `tabId`。
14. **限制**：docx/pdf/txt ≤10MB，一次一个文件；账号有每日发布条数（实测提示「今天还能发布5条」）。
15. 编辑器会自动恢复上一次草稿：反复打开 `creation/article` 可能带着旧内容。批量发稿前先 `probe` 看 `words`，必要时 `reset`。

## 标签怎么挑（意识部分）

`publish` 前 AI 自己给 6–9 个，规则：

- **≥5 个，宁多勿少**；每个 ≤8 字（平台限制）。
- 三类混搭：`主体词`（黄仁勋、英伟达）+ `行业词`（人工智能、芯片、半导体）+ `流量词`（美股、科技、财经）。
- 只挑正文真能对上的，不要硬蹭无关热点；蹭错会被判标题党/降低推荐。
- 已有 `tags.txt` 就沿用，别覆盖人工挑的词。

## 意识（AI）审稿清单

导入并填完后，AI 必须自己读回来核对，不能只看脚本 `ok:true`：

1. `probe` 的 `words` 与源稿字数是否量级相符（差一倍说明重复导入）
2. 正文里图片张数 = 源稿图片数；封面 `coverPicked` = true
3. 标题没有被截断（≤64 字），且与账号调性一致
4. 小标题没有变成正文大段落、段落没被并成一段
5. 标签 ≥5，且与正文对得上
6. 自主声明与稿件性质一致（虚构/转载/个人观点）
7. 敏感表述（领导人姓名、死亡/崩盘类词）已过滤——企鹅号同样审违规
8. 一切通过才 `publish --yes`；发布后必须看到 `作品管理` 步骤 `found:true` 与状态（审核中/已发布），否则按失败处理
9. 有任何不确定，停在草稿并回报人

## 与多平台 skill 的关系

`qie.mjs` 是纯执行层，不做排版决定、不做平台风格适配。上层「多平台发布」skill 负责：
按平台风格产出 `title.txt` / `body.md` / `images/` / `tags.txt`，再分别调用 `qie.mjs` / 头条 / 百家号 / 公众号的脚本。
