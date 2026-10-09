# 图片识别（Vision）

侧栏能粘贴 / 拖入截图；MCP 的 `screenshot` 返回 base64。主线在本仓库（商店版），不是原版 `D:\download\Sparo`。

## 用法

侧栏：粘贴或拖入最多 3 张图，再说要做什么。说「截个图看看现在页面长什么样」会先截当前页再问模型。

外部 Agent：

```text
screenshot()                          # data.base64 = PNG/JPEG
screenshot({ selector: ".chart" })    # 裁元素
screenshot({ fullPage: true })        # 尽量整页
describe_page({ question: "标题是什么" })
```

## 模型

能识图：GPT-4o / Claude 3.5+ / Gemini 1.5+ / Qwen-VL / DeepSeek-VL。  
`deepseek-chat` 一类纯文本模型会降级为「附图已省略」，不报错。

图片费 token。设置里模型名旁边有是否识图的提示。截图可能含隐私，发送前看一眼。

## 文件

- `src/main/agent/vision.ts` — 模型检测、附图清洗
- `src/main/agent/deepseek.ts` — `image_url` 多模态消息
- `src/main/browser.ts` — `screenshot` / `describePage` / 侧栏附图
- `src/main/mcp-server.ts` — MCP 工具
- `src/renderer/shell.html` — 粘贴 / 拖入 / 预览
