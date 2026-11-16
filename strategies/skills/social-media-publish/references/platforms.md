# 五平台适配锚点

> 选择器以 2026-11 实测为准。平台改版频繁，**每次发布先跑一遍探针**，不要盲信本文档。
> 标记「MCP 实测」的为本轮在 Sparo MCP 通道下验证通过；标记「CDP 时代」的来自旧脚本，首次使用需复核。

## 通用铁律（先看这个）

1. 今日头条：**必须勾选「投放广告赚收益」**。
2. 百度百家号：**绝不勾选「采用 AI 生成内容」**。
3. 所有平台：**不勾任何「AI 生成 / AI 创作」类声明**。
4. 多平台分发同一篇时：头条**不勾「头条首发」**（否则会被判非独家）。
5. 大鱼号：信息来源选 **「无需标注」**。
6. 填表只认回执：以列表页实际状态、公开链接、图片实测数量为准，不以按钮点击为准。
7. 遇验证码 / 滑块 / 短信验证：立即停手交给用户，不要模拟。

---

## 1. 今日头条（mp.toutiao.com）

- 编辑器：`https://mp.toutiao.com/profile_v4/graphic/publish`
- 列表：`https://mp.toutiao.com/profile_v4/graphic/articles`（**只显示已发布，定时稿不在这里**）
- 作品管理：`https://mp.toutiao.com/profile_v4/manage/content/all?enter_from=left_menu`（定时稿在这里，状态先「审核中」后「定时发布中」，带「将于 11-13 12:00 发布」）
- 标题：`textarea[placeholder*="请输入文章标题"]`（React 受控，必须 native setter + input/change）
- 正文：`.ProseMirror`，整篇 `ClipboardEvent("paste")`（text/html + text/plain）
- 正文图：渲染为 `.pgc-img` 块，**计数只数 `.pgc-img`**（每块内 2 个 img）
- 插图：先关闭 `.ai-assistant-drawer` 及遮罩；真实点击目标段落（`caret:true`）并回读 selection，再真实点击工具栏图片按钮。2026-11-11 实测 `Ctrl+P` 不再打开抽屉，不能当唯一入口；自定义段落标记后不要等待，避免 ProseMirror 清掉
- 图片抽屉 `.mp-ic-img-drawer`：**默认只有「本地上传 / 扫码上传」，没有 `input[type=file]`**。必须先点抽屉里的「上传图片」页签，文件框才挂出来（`ensureUploadEntry`），否则 `NO_FILE_INPUT`
- 上传后必须等「已上传 N 张图片」、缩略图加载、确定可用；disabled 时点最后一张新上传缩略图。确认后同时断言抽屉关闭、`.pgc-img` 增加；抽屉重渲染时下一拍重读，不重复上传
- 封面：**硬校验，无封面会静默失败**；入口 `.article-cover-add`，单图 radio `value="2"`。上传预览可能是 `.img-span` 背景图而不是 `img`，等待与确认必须两种都认，不能因 `NO_THUMB` 重复上传（2026-11-11 罗大佑稿实测）。原图像素达标但上传区为空时，重编码为 1500×1000 JPEG 后只重试一次（2026-11-11 实测通过）
- 发布：`预览并发布` → `确认发布` → 跳列表页且出现新条目才算成功
- 公开地址：`https://www.toutiao.com/article/<pgc_id>/`
- 头条定时（2026-11-11 实测，**两步**）：
  1. 编辑页点 `button.publish-btn`（文案「定时发布」）→ 弹层 `.common-timing-picker`
  2. 三个 byte 下拉：`.day-select` / `.hour-select` / `.minute-select`，选项在 `.byte-select-popup` 里**全量渲染**（11月11日～11月18日，小时 0–23，分钟 0–59），直接按文本精确点即可，不用滚动估算
  3. 弹层里读「本文将于北京时间 YYYY-MM-DD HH:mm 发布」回读比对；时间窗口是**当前 +2 小时 ～ 7 天**
  4. 点弹层「预览并定时发布」→ **只是进预览页，还没提交**；预览页底栏（`button.publish-btn`，文案「定时发布」）再点一次才真正提交，随后跳 `/graphic/articles`
  5. 核验去 **作品管理** `/manage/content/all`，按标题找行：刚提交是「审核中」+「将于 MM-DD HH:mm 发布」，审核过变「定时发布中」；两种都算成功，**时间必须对上**
- 坑（CDP 时代）：后台标签页 rAF 冻结会导致发布链路卡死；需降级 rAF 为 setTimeout

## 2. 百度百家号（baijiahao.baidu.com）

- 编辑器：`https://baijiahao.baidu.com/builder/rc/edit?type=news`
- 标题：Lexical 编辑器 `[data-lexical-editor="true"]`（不是 UEditor）
- 正文：`UE_V2.instants['ueditorInstant0']`，`ue.setContent(html)` **只传 1 个参数**
- 正文图：先写 `@@IMG1@@` 占位，上传后拿 picproxy URL 回填。**占位图不能全塞文末**：单图放正文中段，多图按段落均分（`withImageSlots`），只插在 `<p>` 之前，不插在小标题后面
- 图片弹窗：先 `ue.body.blur()` 再派发 mousedown/mouseup/click，否则弹窗秒关
- 封面：`发文设置` 内联区 →「选择封面」→ 本地上传 → 确定
- AI 声明：**label 文字为「采用AI生成内容」的 checkbox 必须保持未勾选**，点完二次复查
- 公开地址：`https://baijiahao.baidu.com/s?id=<文章ID>`
- 编辑页复用：带 `article_id` / `online_modify` 的是「修改已发布文章」，复用它会改错稿；`openWriteTab` 必须按 `editExisting` 过滤，复用旧页后强制重载一次
- 定时发布（弹层 `.timepublish-wrap`，三个下拉依次是 日期 / 小时 / 分钟，实测 2026-11-11 已跑通）：
  - 小时、分钟都是 `rc-virtual-list` 虚拟列表，只渲染可见的十几项（07点常常不在 DOM）。做法：**先扫当前渲染项，找不到再滚一屏，边滑边找**；不要按行高估算 `scrollTop` 再读，React 没重渲染时读到的是旧项
  - 打开下拉必须用**真实鼠标点击**（CDP 坐标）。JS 合成 `pointerdown/mousedown/click` 在弹层刚出现、或上一个下拉还在淡出时会被吞，表现为"点了没反应"
  - 判断"下拉是否打开"必须带 `aria-hidden !== 'true'` 过滤，否则正在淡出的浮层会被当成已展开，于是不再重试
  - 回读当前值只在 `.timepublish-wrap` 里取三个 `.cheetah-select`。按"含『定时』字样的弹窗"找会抓到页脚按钮条，`widgets=0`，误判成没填
  - 页脚确认按钮文案是「定时发布」，与页面上开弹层的按钮同名，只能用 `.cheetah-modal-confirm-btns button.cheetah-btn-primary` 精确点
  - 续跑时弹层可能还开着，会挡住封面和 AI 选项：进 `publishOrSchedule` 先用页脚「取消」关掉，再按目标时间重填
  - 日期控件只显示「11月12日」，回读要补年份（月份小于当前月时 +1 年）才能和 `--schedule` 的 `YYYY-MM-DD` 比
  - 点完页脚「定时发布」后的收尾报错（`AI_CONTROL_MISSING`、`TITLE_UNREAD`）是**假阴性**：2026-11-11 有两篇报错后，列表里实际已是「定时发布 预计 … 发布」。先去列表只读那一行，确认没提交再重试；已提交只补台账，绝不重发
- 执行层：`execute` 偶发回空串（渲染进程忙），`page()` 必须对空结果重试，别把它当成页面答案

## 3. 网易号（mp.163.com）— MCP 实测

- 入口：`https://mp.163.com/`（**直接开 hash 路由会白屏，必须从根路径进**）
- 发布入口：点「文章」→ `.content__container__publish-item` → `#/article-publish`
- 标题：`textarea.netease-textarea`（React 受控，用 `HTMLTextAreaElement.prototype.value` setter + input/change）
- 正文：Draft.js `div.public-DraftEditor-content`；整篇 `ClipboardEvent("paste")` + `DataTransfer text/plain`
- 插入图片：工具栏 `.rich-editor-panel-item` **数组 index 13 = 图片**；弹窗 `.ne-modal.picture-adder`
- 图片上传：`upload` 选 `input[accept*='image']`（**不要用 `input[type=file]`，会命中 doc 导入框导致白屏**）→ 点弹窗「确定(1)」
- 封面：`.ne-radio` 选「单图」→「上传图片」→「选择封面图」（>336×252）→ 确认
- 校验：`.ql-editor` 不存在，改用 Draft 容器；字数计数显示「共 N 字」，正文图数用 `img` 数量
- 致命坑：
  - **切换标签页 / 重渲染会重置编辑器**；图片不进草稿
  - `execCommand("delete")` 清空会让 Draft 内部状态与 DOM 脱同步（计数不变、再粘贴无效）→ 直接放弃该草稿，新建文章
  - 首次发布若提示「正文无图」，说明草稿没存图，重新走上传→确定再发

## 4. 大鱼号（mp.dayu.com）— MCP 实测

- 编辑器：文章发布页；正文是 UEditor iframe `#ueditor_0`
- 标题：`input.article-write_box-title-input`
- 正文：直接写 `iframe.contentDocument.body.innerHTML`
- 正文图：先塞外链 `<img src="https://...jpg">`，大鱼会自动代理为 `mp.dayu.com/dayu/image?t=...`
- 封面：`.article-write_box-cover` → `设置封面`；**只支持「从正文中选择」**，所以正文必须先有图
  - 只对 `getBoundingClientRect()` 宽高 >10 的 `.cover-item_set` 打标记，再 MCP 真实点击
  - 选「三封面」模式时必须有 3 张不同图，否则报「请完成三图封面设置」
- 信息来源：点「无需标注」label，需确认 `ant-radio-wrapper-checked`
- 发布：`发表` → 「文章预览」弹层 → `确认发表` → 跳 `/dashboard/contents`
- 校验：内容管理列表出现条目，状态「已发布」，封面数「3张」
- 坑：平台可能提示「含有不合规推广内容，可能无法获得平台推荐」，照实登记即可

## 5. 搜狐号（mp.sohu.com）— MCP 实测

- **正确后台路由**：`https://mp.sohu.com/mpfe/v4/contentManagement/first/page`
  - 旧路由 `/mpfe/v4/contentManagement/news` 会白屏（SPA 无匹配路由）
  - 若被拦到 `/mpfe/v4/clientAuth`：账号安全短信验证，交用户处理
- 发布入口：侧栏「发布内容」→ 文章 → `...#/contentManagement/news/addarticle?contentStatus=1`
- 标题：`input[placeholder*="请输入标题"]`（5-72 字，Vue 受控，native setter）
- 正文：Quill `div.ql-editor`；`ClipboardEvent("paste")` + `DataTransfer text/plain`
- 插入图片：工具栏 `.editor-icon.mp-icon-image` → 弹窗 `.win-mask` → 本地上传 → 上传后点弹窗内 `p.button.positive-button`「确定」
  - **弹窗会叠加**：首次漏点确定会留下空弹窗盖在上面；先点顶层「取消」，再点下层「确定」
  - 上传与确定之间**不要 switch_tab**，否则弹窗被关闭、图片丢失
- 封面：`.upload-tip`「上传图片」→ 「本地上传」tab → 上传 → 确定；封面需 >450×300
- 创作声明：`.el-radio` 里选「无需声明」（**不选「含有AI生成内容」**）
- 发布：`li.publish-report-btn.active.positive-button`（文本「发布」）→ 成功后跳回 `contentManagement/first/page`
- 校验：列表出现标题 + 时间 + 「审核中」
