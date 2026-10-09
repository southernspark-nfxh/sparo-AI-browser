# 模型密钥 · 国内与海外

Sparo **免费永远自备 Key**。侧栏 **设置 → 自己的 Key** 贴你自己的密钥，费用走你在那家平台的账号。

也可以选 **云端模型**：邮箱登录后走服务端代理，云端 Key 不进这台电脑。商店应用里没有支付按钮，订阅在官网管理。

协议是 **OpenAI 兼容**：`POST {地址}/chat/completions`，请求头 `Authorization: Bearer …`（同时带 `api-key`，方便部分 Azure 兼容网关）。

原生 Anthropic Messages、Google Gemini 官方 RPC **不能**直接填进来。下拉里的 Claude / Gemini 走的是它们提供的 OpenAI 兼容地址；也可以用 OpenRouter。

---

## 下拉框里的服务商

协议是 **OpenAI 兼容**。选一家会带上默认地址和模型名；模型名以各平台控制台为准，可改。最后一项 **兼容接口** 可自己填地址。

**不要把 A 家的密钥填到 B 家的地址上。**

### 国内

| 服务商 | 默认地址 | 默认模型 |
|---|---|---|
| **DeepSeek**（默认） | `https://api.deepseek.com` | `deepseek-v4-flash` |
| **通义千问** | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| **Kimi** | `https://api.moonshot.cn/v1` | `moonshot-v1-auto` |
| **智谱 GLM** | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| **豆包 / 火山方舟** | `https://ark.cn-beijing.volces.com/api/v3` | 请填方舟控制台的接入点 ID |
| **硅基流动** | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V3` |

### 海外

| 服务商 | 默认地址 | 默认模型 |
|---|---|---|
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4.1-mini` |
| **Claude** | `https://api.anthropic.com/v1` | `claude-sonnet-4-5`（OpenAI 兼容接口） |
| **Gemini** | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` |
| **Grok** | `https://api.x.ai/v1` | `grok-3-mini` |
| **OpenRouter** | `https://openrouter.ai/api/v1` | 一家密钥可接多家模型 |
| **Groq** | `https://api.groq.com/openai/v1` | 以控制台为准 |

### 本机 / 自行填写

| 服务商 | 默认地址 | 说明 |
|---|---|---|
| **Ollama** | `http://127.0.0.1:11434/v1` | 先在本机启动 Ollama，可不填密钥 |
| **兼容接口** | 自己填 | 任何 `POST {地址}/chat/completions` 的网关 |

原生 Anthropic Messages、Gemini 官方 RPC 不能直接填。下拉里的 Claude / Gemini 走的是它们提供的 OpenAI 兼容地址。也可以用 OpenRouter。

环境变量（开发可选，勿提交 `.env`）：`SPARO_API_KEY`、`SPARO_BASE_URL`、`SPARO_MODEL`、`SPARO_PROVIDER`。见仓库 `.env.example`。

密钥只写在这台电脑的 `%APPDATA%\sparo-store\settings.json`，不进云、不进安装包。
