# 模型密钥 · 国内与海外

Sparo **免费永远自备 Key**。侧栏 **设置 → 自己的 Key** 贴你自己的密钥，费用走你在那家平台的账号。

也可以选 **云端模型**：邮箱登录后走服务端代理，云端 Key 不进这台电脑。商店应用里没有支付按钮，订阅在官网管理。

协议是 **OpenAI 兼容**：`POST {地址}/chat/completions`，请求头 `Authorization: Bearer …`（同时带 `api-key`，方便部分 Azure 兼容网关）。

原生 Anthropic Messages、Google Gemini 官方 RPC **不能**直接填进来。要用它们，请走带兼容层的网关（例如 OpenRouter），或对方提供的 OpenAI 兼容地址。

---

## 三种品牌（下拉框）

| 品牌 | 默认地址 | 默认模型 | 密钥从哪来 |
|---|---|---|---|
| **DeepSeek**（默认） | `https://api.deepseek.com` | `deepseek-v4-flash` | [platform.deepseek.com](https://platform.deepseek.com) |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4.1-mini` | [platform.openai.com](https://platform.openai.com) |
| **兼容接口** | 你选或手改 | 随网关 | 见下表 |

**不要把 GPT 密钥填到 DeepSeek 地址上。** 换品牌会带上该品牌的默认地址，保存前请核对。

选 **兼容接口** 后，可先点 **网关** 选一家，地址和模型会填好；再贴密钥、点保存。不对的话直接改地址和模型。

---

## 常用兼容网关（示例）

模型名以各平台控制台为准，下表是侧栏预填，可改。

### 海外 / 全球

| 网关 | 地址 | 说明 |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | 一家钥匙接多家模型 |
| Groq | `https://api.groq.com/openai/v1` | 快，模型列表看控制台 |
| xAI Grok | `https://api.x.ai/v1` | Grok |
| Mistral | `https://api.mistral.ai/v1` | 欧洲常用 |
| Together | `https://api.together.xyz/v1` | 开源模型托管 |

### 国内常见

| 网关 | 地址 | 说明 |
|---|---|---|
| 硅基流动 | `https://api.siliconflow.cn/v1` | 国内 OpenAI 兼容聚合 |
| 通义 compatible | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 阿里云百炼兼容模式 |
| Kimi | `https://api.moonshot.cn/v1` | 月之暗面 |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | 智谱开放平台 |
| 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | 模型 ID 以方舟控制台为准 |

### 本机

| 网关 | 地址 | 说明 |
|---|---|---|
| Ollama | `http://127.0.0.1:11434/v1` | 先在本机跑起 Ollama |

环境变量（开发可选，勿提交 `.env`）：`SPARO_API_KEY`、`SPARO_BASE_URL`、`SPARO_MODEL`、`SPARO_PROVIDER`。见仓库 `.env.example`。

密钥只写在这台电脑的 `%APPDATA%\sparo-store\settings.json`，不进云、不进安装包。
