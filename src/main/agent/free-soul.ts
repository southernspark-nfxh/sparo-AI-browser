import type { ToolResult } from "../../shared/types.js";
import {
  beginPaidConfirmRun,
  endPaidConfirmRun,
  peekPaidConfirmHandoff,
  registerPaidConfirmFromArgs,
} from "../workflows/dxm-smt-images.js";
import { CAPTURE_PROMPT, CAPTURE_RUN_LIMIT, RUN_CAPTURE_FULL } from "../captures.js";
import { pageTextGrowthNote } from "./deepseek.js";
import { traceArgs, type SoulRunTrace, type SoulTraceStep } from "./distill.js";
import { chatCompletionsUrl } from "../settings/llm-url.js";
import { finishViewDataReply, viewDataNeedsAsk, viewDataPauseHint } from "./intent-router.js";
import { noteConfirmRequest, noteUserReply } from "./publish-gate.js";

export type FreeSoulToolName =
  | "navigate"
  | "get_url"
  | "get_title"
  | "page_text"
  | "snapshot"
  | "click"
  | "fill"
  | "press"
  | "click_text"
  | "scroll"
  | "go_back"
  | "request_confirm"
  | "search_site"
  | "set_file"
  | "reload"
  | "save_shot"
  | "save_image"
  | "list_captures"
  | "match_skill"
  | "run_skill"
  | "run_workflow"
  | "save_skill"
  | "save_doc"
  | "list_envs"
  | "list_tabs"
  | "switch_tab"
  | "close_tab"
  | "close_tabs"
  | "new_tab";

export type FreeSoulToolRunner = (
  name: FreeSoulToolName,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

/** 单轮没有任何响应头时的上限。接到首字后不再用这只计时掐断正文。 */
export const FIRST_BYTE_TIMEOUT_MS = 180_000;
export const SILENT_LLM_TEXT = "模型长时间无响应，已停止。可重试。";

export type freeSoulConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  mode?: "byok" | "cloud";
  taskId?: string;
  fetchImpl?: typeof fetch;
  maxRounds?: number;
  requestTimeoutMs?: number;
  firstByteTimeoutMs?: number;
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

type NormalizedToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** 发给模型前的副本：tool_calls 后面的连续 tool 消息必须盖住每个 id。 */
export function sanitize(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    out.push(message);
    index += 1;
    const calls = message.role === "assistant" ? message.tool_calls : undefined;
    if (!calls?.length) continue;
    const covered = new Set<string>();
    while (index < messages.length && messages[index].role === "tool") {
      const toolMessage = messages[index];
      out.push(toolMessage);
      if (toolMessage.tool_call_id) covered.add(toolMessage.tool_call_id);
      index += 1;
    }
    for (const call of calls) {
      if (!call.id || covered.has(call.id)) continue;
      out.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function?.name,
        content: "（该工具调用未执行）",
      });
      covered.add(call.id);
    }
  }
  return out;
}

function normalizeToolCall(
  call: NonNullable<ChatMessage["tool_calls"]>[number],
  round: number,
  index: number,
): NormalizedToolCall {
  const id = call.id?.trim() || `${round}-${index}`;
  return {
    id,
    type: "function",
    function: {
      name: call.function?.name || "",
      arguments: call.function?.arguments || "{}",
    },
  };
}

const tool = (
  name: FreeSoulToolName,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({
  type: "function" as const,
  function: {
    name,
    description,
    parameters: { type: "object", properties, required },
  },
});

export const LIST_ENVS_DESCRIPTION =
  "列出本机已保存的账号环境（每个环境一套独立 Cookie，可同时登录同站点的多个号）。系统提示里已有名册时直接用那份 id，不必再调。名字对不上就说没有这个环境，不要新建，也不要挑一个最接近的。用户说另一个或第二个账号时，除当前页外只剩一个环境才用它，并且不要回默认登录态；还剩多个就列出名字问，不要自己挑。";

const TOOLS = [
  tool("navigate", "在当前有头浏览器标签打开完整 URL，并返回实际落地地址和标题。用户点名某个账号时，用系统提示名册里的 envId；名册里没有再 list_envs。不传则沿用当前页的环境；当前页没有环境才是默认登录态。", {
    url: { type: "string" },
    envId: { type: "string", description: "可选，账号环境 id。传入后在这个环境的独立 Cookie 里打开，互不干扰。" },
  }, ["url"]),
  tool("get_url", "读取当前标签的真实 URL。"),
  tool("get_title", "读取当前标签的真实标题。"),
  tool("page_text", "读取当前网页及可见 iframe 的正文。总结、提取事实、核对结果前必须用它。"),
  tool("snapshot", "读取当前网页可交互元素及 ref。需要点击或填写时使用；它不能替代正文。", {
    selector: { type: "string", description: "可选，限定 CSS 区域" },
  }),
  tool("click", "按 snapshot 返回的 ref 或 CSS selector 点击元素。", {
    ref: { type: "string" },
    selector: { type: "string" },
  }),
  tool("fill", "按 snapshot 返回的 ref 或 CSS selector 填写输入框，并读回实际值。", {
    ref: { type: "string" },
    selector: { type: "string" },
    value: { type: "string" },
  }, ["value"]),
  tool("press", "向当前页面发送按键，例如 Enter、Escape、End。", {
    key: { type: "string" },
  }, ["key"]),
  tool("click_text", "点击页面上可见且能唯一识别的文字。", {
    text: { type: "string" },
  }, ["text"]),
  tool("scroll", "滚动当前页面。direction 为 down 或 up，amount 为像素，默认 900。", {
    direction: { type: "string", enum: ["down", "up"] },
    amount: { type: "number" },
  }),
  tool("go_back", "返回当前标签的上一个页面。"),
  tool(
    "request_confirm",
    "逐步确认时，发送、发布、保存并认领、保存并发布之前先调用。自动执行时，保存、发送、发布直接做完并通知；保存并认领和保存并发布仍要先调用。支付不要用它代点。删除做完通知即可，不必先问。调用后本次任务会停下，等用户下一条消息明确同意。不要用于普通点击、翻页或搜索。客服回复不要用它去点发送。",
    {
      action: { type: "string", description: "准备做的不可逆动作" },
      detail: { type: "string", description: "让用户确认的具体内容" },
      paid: {
        type: "object",
        description: "只有收费图片才填。feature 是图片翻译或图片白底，另带 workOrderId、group（main、variant 或 description）、srcDigest（该组图片 src 摘要）和 fee。不能用变种图或描述图这几个字代替 group。",
      },
    },
    ["action", "detail"],
  ),
  tool(
    "search_site",
    "构造火车、机票或酒店的结果页 URL。拿到 data.url 后用 navigate 打开，不要从这些站点的首页硬点。",
    {
      site: { type: "string", enum: ["train", "flight", "hotel"] },
      from: { type: "string" },
      to: { type: "string" },
      date: { type: "string", description: "YYYY-MM-DD，或今天/明天/后天" },
      query: { type: "string", description: "酒店城市或补充关键词" },
    },
    ["site"],
  ),
  tool(
    "set_file",
    "把用户给出的本地文件放进页面的文件选择框。不要用 fill 填路径，也不要用 file:// 打开目录。放进去之后不要替用户点投稿或发布。",
    {
      path: { type: "string", description: "本地文件的绝对路径" },
      ref: { type: "string", description: "snapshot 里文件选择框的 ref" },
      selector: { type: "string", description: "文件选择框的 CSS selector" },
    },
    ["path"],
  ),
  tool("reload", "重载当前标签。页面点按全部失效、疑似弹窗残留遮罩时用它恢复交互。"),
  tool(
    "save_shot",
    "把当前页面截图存进本机素材库，供后续 set_file 引用。可传 selector 裁剪，或 fullPage 整页。素材只存本机，不返回图片内容。",
    {
      label: { type: "string", description: "用途标签，写进文件名" },
      selector: { type: "string" },
      clip: { type: "object" },
      fullPage: { type: "boolean" },
      format: { type: "string", enum: ["png", "jpeg"] },
      quality: { type: "number" },
    },
  ),
  tool(
    "save_image",
    "把页面上的一张图片存进本机素材库，供后续 set_file 引用。用 selector 选中 img，或直接给 src。只接受图片，素材只存本机。",
    {
      selector: { type: "string" },
      src: { type: "string" },
      label: { type: "string", description: "用途标签，写进文件名" },
    },
  ),
  tool(
    "list_captures",
    "列出本机素材库最近保存的图片路径（file、kind、src、来源页、时间），供 set_file 引用。素材只存本机。",
  ),
  tool(
    "match_skill",
    "按自然语言匹配本机已有技能，返回候选 id。带站点语义的任务先调用它，不要自己编技能 id。",
    { query: { type: "string" } },
    ["query"],
  ),
  tool(
    "run_skill",
    "按技能 id 执行已有剧本。参数用 params 传入。失败时不要停，改用通用工具继续。",
    {
      id: { type: "string" },
      query: { type: "string" },
      params: { type: "object" },
    },
  ),
  tool(
    "run_workflow",
    "执行店小秘到速卖通上架白名单。id 只能是 dxm_smt_probe、dxm_smt_prepare、dxm_smt_status、dxm_smt_publish、dxm_smt_shops。用户说刷新店铺基线时用 dxm_smt_shops，它没有参数，每次调用都重新抓取店铺列表。dxm_smt_prepare 指定目标店铺用参数 shopName。用户明确说「认领」或「保存并认领」后，才把用户原话放进 claimConsent 再跑 prepare；用户没说就不带。claimConsent 不是店铺名，不能自己编。返回 code 为 waiting_human 或 hard_gate 时才停等。preview_closed、transient_tool_failure、validation_failed 要换变体、换通用页面工具或换策略，不要停死。禁止绕过保存、认领、发布、付费。禁止绕过工作流用 click_text、execute_primitives 或任何页面工具去手动点『保存并认领』『保存』『认领』『发布』类按钮。收费图片和逐步确认模式下的发布，必须先 request_confirm。不要把 tabId 放进参数。其他 id 会拒绝。",
    {
      id: { type: "string" },
      params: { type: "object" },
    },
    ["id"],
  ),
  tool(
    "save_skill",
    "把最近一次成功跑完的任务记成技能。只有用户明确说沉淀成技能、记成技能或生成技能时才调用。不带 route 时先取回轨迹；带上 title、intent、aliases、route、params、pitfalls、contract 后再次调用才会落盘。任务成功后不要主动建议沉淀。",
    {
      title: { type: "string" },
      intent: { type: "string" },
      aliases: { type: "array", items: { type: "string" } },
      route: { type: "array", description: "fixed 段只能是 navigate、page_text、wait_for、report；open 段只写目标" },
      params: { type: "object" },
      pitfalls: { type: "array" },
      contract: { type: "object" },
    },
  ),
  tool(
    "save_doc",
    "把整理好的内容写成本地文档（md / txt / html）。用户要把结果存成文档、写成文件、落成 md 时用它，不要去开网页。写完把路径告诉用户。",
    {
      title: { type: "string", description: "文档标题，也用作默认文件名" },
      body: { type: "string", description: "文档正文全文" },
      format: { type: "string", enum: ["md", "txt", "html"] },
      path: { type: "string", description: "可选，用户给过的绝对路径；不给就存到默认文档目录" },
    },
    ["title", "body"],
  ),
  tool("list_envs", LIST_ENVS_DESCRIPTION),
  tool(
    "list_tabs",
    "列出当前打开的所有标签页（id、标题、地址、是否当前页）。用户要切换、关闭、整理网页时先调用它看清有哪些页，不要靠猜。",
  ),
  tool(
    "switch_tab",
    "切换到指定标签页。参数 id 来自 list_tabs；也可以给 match，匹配地址或标题里的一段文字。切换之后，这一轮的 page_text、get_url、点击和填写都落在这一页。",
    { id: { type: "string" }, match: { type: "string" } },
  ),
  tool(
    "close_tab",
    "关闭一个标签页。参数 id 来自 list_tabs；或给 match，只关闭第一个地址或标题匹配的标签。",
    { id: { type: "string" }, match: { type: "string" } },
  ),
  tool(
    "close_tabs",
    "批量关闭标签页。必须带 match（地址或标题，不区分大小写），或显式 all=true。用户说「关掉所有今日头条相关的网页」就传 match=\"toutiao\"：命中的页全部关掉，包括当前正在看的。用户说「关掉所有网页/标签」时传 all=true，关掉除工作台和阅读页以外的全部标签。只有用户明确说留着当前页、关掉其他页时才传 keepActive=true。不传 match 且不传 all 不会关任何页。",
    {
      match: { type: "string" },
      all: { type: "boolean", description: "用户要关掉所有网页或标签时传 true" },
      keepActive: { type: "boolean", description: "仅当用户要留着当前页时传 true" },
    },
  ),
  tool(
    "new_tab",
    "新开一个标签并打开 url，认领给当前调用方，不抢用户正在看的页面焦点。用来同时留下两个目标页。不限制站点。",
    { url: { type: "string", description: "要打开的完整 URL" } },
    ["url"],
  ),
];

const STUCK_HINT =
  "同一操作已连续 3 次无效果。这条路径大概率没反应：换入口、直接构造结果 URL、换选择器，或如实向用户汇报当前障碍。禁止继续重复同一操作。也可以整页重载（reload 工具）后重试一次再下结论。";

const PAGE_SAME_HINT =
  "page_text 连续 3 次读到同样内容，页面已无新信息。基于已读内容立即汇报，或明确说明障碍，不要继续滚动或重复读取。";

const TOOL_NAMES = new Set<string>(TOOLS.map((item) => item.function.name));

/** 蒸馏技能 declared_actions 必须落在这份名单里。 */
export function freeSoulToolNames(): readonly string[] {
  return TOOLS.map((item) => item.function.name);
}

/** 当前页已经在某个账号环境里时，告诉模型不要漏传 envId 退回默认登录态。 */
export function currentPageEnvLine(envId?: string, envName?: string): string {
  const id = String(envId || "").trim();
  if (!id) return "";
  const name = String(envName || "").trim() || id;
  return `当前页在账号环境 ${name}（envId=${id}）。用户让打开同站点页面、继续该站任务或发布、且没点名别的账号时，navigate / run_skill 默认带 envId=${id}，禁止回默认登录态（那是另一个账号）。`;
}

export type EnvRosterItem = { id: string; name: string };

/** 把本机环境的 id 和名字写进提示。本地不按「另一个」或数字写法挑环境。 */
export function envRosterLine(
  envs: EnvRosterItem[] | undefined,
  page?: { envId?: string; envName?: string },
): string {
  const items = (envs || [])
    .map((env) => {
      const id = String(env?.id || "").trim();
      const name = String(env?.name || "").trim() || id;
      return id ? { id, name } : null;
    })
    .filter((env): env is { id: string; name: string } => Boolean(env));
  if (!items.length) return "";
  const list = items.map((env) => `${env.name}（id=${env.id}）`).join("、");
  const curId = String(page?.envId || "").trim();
  const curName = String(page?.envName || "").trim() || items.find((env) => env.id === curId)?.name || curId;
  const here = curId ? `当前页在${curName}（id=${curId}）。` : "当前页在默认登录态。";
  return `本机账号环境：${list}。${here}`;
}

/** 名册在场时才交给模型的挑选规则。缺了 envId 时，唯一对上的名字由 namedEnvId 补上。 */
export const ENV_PICK_RULES =
  "对账号时只用上面这份名册里的 id，不要另猜，也不要新建环境。名字对得上才用那个 id；阿拉伯数字和汉字数字视为同一个，例如「3」和「三」、「2」和「二」。完全对不上（名册里没有用户说的那个名字）就如实说没有这个环境，禁止硬挑最接近的，禁止新建环境。用户说「另一个」或「第二个账号」时：除当前页环境外只剩一个，就用那一个，并且不要回默认登录态；还剩两个或更多，列出名字问用户，不要自己挑。";

const CN_DIGIT: Record<string, string> = {
  零: "0",
  一: "1",
  二: "2",
  两: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  七: "7",
  八: "8",
  九: "9",
};

/** 比较账号名时去掉引号和空白，汉字数字看成阿拉伯数字。 */
export function foldEnvName(value: string): string {
  return String(value || "")
    .replace(/[「」"'“”‘’]/g, "")
    .replace(/\s+/g, "")
    .replace(/[零一二两三四五六七八九]/g, (ch) => CN_DIGIT[ch] || ch)
    .toLowerCase();
}

const SITE_ENV_NAMES = new Set(["微博", "知乎", "头条", "今日头条", "百家号", "京东", "淘宝", "百度"]);

/**
 * 用户原句里点名的账号。名字能唯一对上名册才返回 id。
 * 对不上、对上多个、或只是站名（「打开微博」对上名叫「微博」的环境）都不猜。
 * 「另一个账号」只有除当前页外只剩一个环境时才用它。
 */
export function namedEnvId(
  text: string,
  envs: Array<{ id: string; name: string }>,
  currentEnvId = "",
): string {
  const raw = String(text || "");
  const folded = foldEnvName(raw);
  const roster = (envs || [])
    .map((env) => ({ id: String(env?.id || "").trim(), name: String(env?.name || "").trim() }))
    .filter((env) => env.id && env.name);
  const hits = roster.filter((env) => {
    if (SITE_ENV_NAMES.has(env.name) && !/账号|环境/.test(raw)) return false;
    const name = foldEnvName(env.name);
    return name.length >= 2 && folded.includes(name);
  });
  hits.sort((a, b) => foldEnvName(b.name).length - foldEnvName(a.name).length);
  const best = hits[0];
  if (best) {
    const bestLen = foldEnvName(best.name).length;
    const tied = hits.some((env) => env.id !== best.id && foldEnvName(env.name).length === bestLen);
    return tied ? "" : best.id;
  }
  if (/另一个账号|另一个环境|别的账号|别的环境|第二个账号/.test(raw)) {
    const others = roster.filter((env) => env.id !== String(currentEnvId || "").trim());
    if (others.length === 1 && others[0]) return others[0].id;
  }
  return "";
}

export function systemPrompt(
  url: string,
  title: string,
  execMode?: "step" | "auto",
  pageEnv?: { envId?: string; envName?: string },
  envs?: EnvRosterItem[],
): string {
  const envLine = currentPageEnvLine(pageEnv?.envId, pageEnv?.envName);
  const roster = envRosterLine(envs, pageEnv);
  const lines = [
    "你是 Sparo。用户通过浏览器侧栏把任务交给你，你直接操作当前这扇真实浏览器，而不是只给操作建议。对用户只称自己为 Sparo。不要说 Pi、Pi Agent，也不要提内部实现名称。",
    "用户已经停在某张网页上发问，又没有说打开别的网站、另开窗口或给出网址时，就读眼前这一页，并在这一页的侧栏回答。不要为此打开百度首页，也不要把答复写到另一张标签上。",
    "需要搜索时，打开搜索引擎结果页或用户指定网站，再读取真实结果。需要多步操作时持续调用工具，直到任务完成或确实需要用户处理。",
    "page_text 用来读事实，snapshot 用来找交互元素。点击、填写后根据实际页面继续判断，不要假定操作已经成功。",
    "滚动翻页采集时注意 page_text 消息里的「较上次 +N 字」：+0 表示这一屏没有新内容，立即基于已读内容汇报或换浏览方式，不要继续滚动。",
    "回答所需信息已经读到时立即汇总汇报，宁可注明局限（如「截至第 N 条」），不要为追求完整耗尽轮次。",
    "写诗、写故事、写文案这类纯创作，先用两三句说出思路，并问要不要按这个写。用户确认之前，不要把完整作品贴出来当成已经做完。",
    "用户要逐条再复制、另存一份时，用 save_doc 写成新文件。不要改上一份文档，不要只把全文贴在对话里。",
    "店小秘采集箱编辑：标题按直译改完能改的文字字段。没有弹出图片翻译费用，就继续改文字，不要停下来让用户选方向。保存和保存并认领仍要先确认。看到费用就停，不要授权扣费。",
    "用户说查看、看看某站的数据、最近或最新，但没有说总结、整理、列出来、读出来或汇报时：先打开对应页面，然后立刻停下来问「已经打开了《页面标题》。需要我帮你总结吗？」。问之前不要继续点筛选、翻页或换数据页。用户回答要、好、总结、帮我看之后，再读页并总结。用户明确说了总结或整理时，直接读完再汇报，不用先问。",
    "最终回复必须基于已经看到的页面和工具结果，给出用户需要的答案及关键来源 URL。没有读到的事实不要编造，没有完成的步骤不要宣称完成。",
    "只在任务完成、无法继续或必须向用户提问时输出最终文字；执行过程中优先调用工具，不要播报空泛计划。",
    "同一元素或同一路径连续两次没有引起页面变化就换策略：换入口、直接构造结果 URL、换交互方式；禁止对同一目标连点超过两次。",
    "页面点按全部失效、疑似弹窗残留遮罩时，用 reload 整页重载一次再重试，不要把遮罩当成这条路没反应。",
    "页面需要登录或出现验证码时，如实告知用户并停在该处等用户处理，不要反复尝试绕过。",
    "人已经在微博、知乎、头条或百家号页面上，要去同站的某个人或某条内容时：在当前标签里搜索或打开，不要 new_tab。只有人在指挥室，或明确说新窗口、另开，才新开标签。",
    "当前页写评论或转发：先 match_skill「微博评论」。命中就 run_skill，params 里 text 是要写的话，mode 为 comment、repost 或 both，anchor 是那条微博里的一段原文。不要自己循环点发送。脚本失败再判断下一步。",
    "不要说用户的消息被截断，也不要自己编一个用户没发过的问题再回答。指挥室派到某一页的任务只做这一页，结果交给指挥室。",
    "提问分三档：可逆可推断的（标题草案、已有属性的语言转换、模板选择）先做，并在汇报里写明假设；页面事实（重量、尺寸、库存）页面上有可靠值就提取换算，读不到不编造，可以问；用户或法律事实（品牌授权、HS 编码、责任人、资质）无法推断才问。保存、认领、发布、付费不在字段自决范围内。",
    "无法完成时如实汇报卡在哪一步，不要空转。",
    "当前是逐步确认：保存直接做，做完通知已保存到哪里。发送、发布、保存并认领、保存并发布先 request_confirm 一次，确认后执行，再通知结果。登录和验证码自己处理；真过不去就告诉用户需要人手动过一下。支付必须用户亲自完成，不要代点。删除允许执行，做完通知可在 7 天内恢复。客服回复只把草稿填进输入框，发送仍由用户在页面上点。",
    "用户说「直接」「以后」「全部」「别让我看了」等全量授权措辞时，同类批量操作（归档、清理、翻页处理）自主连续执行到做完或真卡住，不中途问「要不要继续」；跨到改账号设置、订阅时仍停下来。付费必须用户亲自完成。删除做完通知即可。",
    "批量清理长列表时：优先找「选择所有/全部匹配…会话」类横幅链接一次全选；snapshot 里没有但按理该出现的动态元素（如全选后新出现的横幅），用 click_text 按可见文字再试一次，别急着下「取不到」的结论；Gmail 键盘全选是连按 * 和 a；批与批之间沿用同一搜索结果页，不要每批重新构造搜索。",
    "用户要求关闭、整理或切换标签页时：先 list_tabs 看清有哪些页。关掉某一类网页用 close_tabs，match 传站点或标题关键字（「关掉所有今日头条的网页」= toutiao），命中的页全部关掉，包括当前正在看的。用户说「关掉所有网页/标签」时传 all=true。只有用户明确说留着当前页时才传 keepActive=true。不传 match 且不传 all 不会关页面，不要回答做不到，也不要一个一个点开页面去关。关掉当前这一个用 close_tab。切换用 switch_tab。",
    "查询火车、机票、酒店时优先用 search_site 拿结果页 URL 再 navigate，不要硬刚这些站点的首页。",
    "发布到微博、知乎、小红书等社交平台的正文要用自然的口语段落：不用 markdown 标题、加粗、编号列表、分割线和序号 emoji（如 1️⃣）；需要分点时用『一、二、三』或自然过渡衔接。在侧栏里直接回复用户的总结不受此限。",
    "用户给出本地文件路径让你上传（视频、图片、附件）时，用 set_file 把文件放进文件选择框，不要试图用 fill 填路径或用 file:// 打开本地目录。",
    CAPTURE_PROMPT,
    "带站点语义的多步任务（发布、上品、采集、生活规划）先 match_skill；命中即优先 run_skill 按剧本走，未命中或剧本执行失败自动回落通用工具路径，不因技能问题中断任务。",
    "发稿先确认平台。缺稿件目录只问一次，并给出三条走法：给目录（title.txt/body.md，可选 cover.jpg、images/）、直接把标题正文贴进对话走通用填稿、或先打开编辑器再贴。用户已经贴了正文就不要再要目录；重复说平台时按已有信息往下走一步，不要复读同一段追问。目录齐了才 run_skill：四站 social-media-publish + { platform, articleDir }，公众号 weixin-publish + { articleDir }（只存草稿）。不确定技能先 match_skill，不得声称技能库没有。",
    "只有用户明确说「沉淀成技能 / 记成技能 / 生成技能」时才调 save_skill；任务成功后不要主动建议沉淀。",
    "用户要把整理好的内容存成本地文档（md / txt / html）时用 save_doc，不要去开网页；写完把路径告诉用户。",
    "历史对话里的工具结果都是当时真实读回的，是可信的。浏览器或应用重启后页面状态会重置，当前标签页在哪、显示什么，都不能用来否定历史里已完成的动作。需要核实历史发布是否生效时，去对应平台实际查看（例如打开微博个人主页看时间线），不要凭当前页面状态下结论。",
    "使用用户最新一条消息的语言回复。",
    "多窗口协作：你只操作自己绑定的那一扇窗口和它名下的标签。别的窗口有人在看，或有别的 agent 在干活时，不要把那扇窗口还原到前台，也不要抢它的焦点。",
    roster
      ? "账号隔离：本机可以存多个「账号环境」，每个环境是一套独立的 Cookie 和本地存储，同一个网站能同时登录多个号、互不干扰。名册已经写在下面，点名某个账号时用名册里的 id 传给 navigate 的 envId（run_skill 则放在 params.envId）。没点名别的账号时沿用当前页的环境，不要回默认登录态，也不要自己挑一个。环境里还没登录过时，页面会要求登录，如实告诉用户「这个环境还没登录，需要手动登一次」，不要反复重试。一个账号打开一个站只留一张页，跳到登录或首页时停在这张页，不要再开标签。"
      : envLine
        ? "账号隔离：本机可以存多个「账号环境」，每个环境是一套独立的 Cookie 和本地存储，同一个网站能同时登录多个号、互不干扰。用户点名别的账号时，先调用 list_envs 拿到那个 id，再传给 navigate 的 envId（run_skill 则放在 params.envId）。没点名别的账号时沿用当前页的环境，不要回默认登录态。环境里还没登录过时，页面会要求登录，如实告诉用户「这个环境还没登录，需要手动登一次」，不要反复重试。一个账号打开一个站只留一张页，跳到登录或首页时停在这张页，不要再开标签。"
        : "账号隔离：本机可以存多个「账号环境」，每个环境是一套独立的 Cookie 和本地存储，同一个网站能同时登录多个号、互不干扰。用户点名「用 A 号」「发到第二个账号」「另一个百家号」时，先调用 list_envs 拿到 id，再把 id 传给 navigate 的 envId（run_skill 则放在 params.envId）。不点名就保持默认登录态，不要自己挑环境。环境里还没登录过时，页面会要求登录，如实告诉用户「这个环境还没登录，需要手动登一次」，不要反复重试。一个账号打开一个站只留一张页，跳到登录或首页时停在这张页，不要再开标签。",
    envLine,
    roster,
    roster ? ENV_PICK_RULES : "",
    "需要继续干活时留在自己的窗口里静默做完。做完只闪任务栏，不把别人的窗口拉到最前。多个 agent 同时在线时各做各的任务，不改别人的标签，不替别人点确认。",
    `当前页面标题：${title || "（无）"}`,
    `当前页面 URL：${url || "about:blank"}`,
  ];
  if (execMode === "auto") {
    const at = lines.findIndex((line) => line.startsWith("当前是逐步确认"));
    if (at >= 0) {
      lines.splice(
        at,
        1,
        "当前是自动执行模式：任务指令授权的是执行过程，发布、发送、保存也一并授权；做完通知就行。保存并认领、保存并发布仍要先 request_confirm。支付硬拦。删除走软边界：允许执行，做完通知可在 7 天内恢复。客服回复只把草稿填进输入框，发送仍由用户在页面上点。",
        "自动模式下不中途询问『要不要继续』『要不要打开』，一口气执行到任务完成、真阻塞（需要登录、出现验证码、页面持续无响应）或缺了无法自决的关键信息才停。停下时如实说明卡在哪。",
        "「查看数据但没说总结」仍要先问要不要总结。这不是「要不要继续」。",
        "缺可自决的细节（先看哪个入口、默认当前城市、先展示第一页结果）就自决并在最终汇报里注明假设；缺影响结果的硬信息（出发地、日期、金额、平台账号选择）且无法从对话和历史推断时，才停下来问。",
      );
    }
  }
  return lines.filter(Boolean).join("\n");
}

export type FreeSoulRunInput = {
  input: string;
  url: string;
  title: string;
  locale?: string;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  signal?: AbortSignal;
  execMode?: "step" | "auto";
  taskId?: string;
  /** 当前工具标签所属账号环境。没点名别的账号时，navigate / run_skill 应带上它。 */
  envId?: string;
  envName?: string;
  /** 本机账号环境名册。只交给模型对照名字，本地不按这句话挑环境。 */
  envs?: EnvRosterItem[];
  onRound?: (round: number) => void;
  onSidebar?: (text: string) => void;
  onTrace?: (trace: SoulRunTrace) => void;
};

function pageTextBody(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const text = (data as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function confirmText(args: Record<string, unknown>): string {
  const action = String(args.action || "").trim() || "这个动作";
  const detail = String(args.detail || "").trim();
  return detail ? `我准备执行：${action}。${detail} 确认吗？` : `我准备执行：${action}。确认吗？`;
}

function stableArgs(args: Record<string, unknown>): string {
  const preferred = ["ref", "selector", "text", "url", "value", "key", "direction", "amount", "site", "from", "to", "date", "query", "path"];
  const picked: Record<string, unknown> = {};
  for (const key of preferred) {
    if (args[key] !== undefined && args[key] !== "") picked[key] = args[key];
  }
  const source = Object.keys(picked).length ? picked : args;
  const keys = Object.keys(source)
    .filter((key) => !/^(timestamp|time|capturedAt|id)$/i.test(key))
    .sort();
  return JSON.stringify(keys.map((key) => [key, source[key]]));
}

function noteStuck(
  name: string,
  args: Record<string, unknown>,
  result: ToolResult,
  pageUrl: string,
  pageTitle: string,
): { finger: string; unchanged: boolean; pageUrl: string; pageTitle: string } {
  const data = result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : null;
  const afterUrl = typeof data?.url === "string" ? data.url : "";
  const afterTitle = typeof data?.title === "string" ? data.title : "";
  let before = "";
  let after = "";
  let unchanged = false;
  let nextUrl = pageUrl;
  let nextTitle = pageTitle;
  if (afterUrl || afterTitle) {
    before = `${pageUrl}|${pageTitle}`;
    after = `${afterUrl || pageUrl}|${afterTitle || pageTitle}`;
    unchanged = before === after;
    if (afterUrl) nextUrl = afterUrl;
    if (afterTitle) nextTitle = afterTitle;
  } else {
    const msg = String(result.message || "").slice(0, 200);
    before = msg;
    after = msg;
    unchanged = true;
  }
  return {
    finger: `${name}|${stableArgs(args)}|${before}|${after}`,
    unchanged,
    pageUrl: nextUrl,
    pageTitle: nextTitle,
  };
}

const TRACE_CAP = 60;
const TRACE_HEAD_TOOLS = new Set(["navigate", "search_site"]);

function capSoulTrace(steps: SoulTraceStep[]): SoulTraceStep[] {
  if (steps.length <= TRACE_CAP) return steps;
  let head = 0;
  while (head < steps.length && TRACE_HEAD_TOOLS.has(steps[head].tool)) head += 1;
  if (head === 0) head = 1;
  if (head > TRACE_CAP - 1) head = TRACE_CAP - 1;
  return [...steps.slice(0, head), ...steps.slice(steps.length - (TRACE_CAP - head))];
}

function serializeResult(result: ToolResult): string {
  const text = JSON.stringify({
    ok: result.ok,
    message: result.message,
    data: result.data ?? undefined,
  });
  if (text.length <= 24000) return text;
  return `${text.slice(0, 16000)}\n…[工具结果过长，中间已省略]…\n${text.slice(-7000)}`;
}

/** 一轮任务里全部 tool 结果的字符上限。超了从最老的大结果开始折叠。要改只改这个数，不做设置项。 */
export const TOOL_RESULT_BUDGET = 150_000;
/** 带进本轮的历史对话字符上限。每条都要落在预算内，超长的只保留末尾。 */
export const HISTORY_CHAR_BUDGET = 32_000;

const toolRounds = new WeakMap<ChatMessage, number>();
const FOLDABLE_TOOLS = new Set(["page_text", "save_shot", "save_image"]);

export function noteToolRound(message: ChatMessage, round: number): void {
  toolRounds.set(message, round);
}

function capHistoryText(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return text.slice(text.length - budget);
}

export function limitHistory<T extends { text: string }>(history: T[], budget = HISTORY_CHAR_BUDGET): T[] {
  const kept: T[] = [];
  let used = 0;
  let dropped = 0;
  let clipped = false;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (!turn?.text.trim()) continue;
    let text = turn.text;
    if (text.length > budget - used) {
      if (kept.length === 0 && budget > 0) {
        text = capHistoryText(text, budget);
        clipped = text.length !== turn.text.length;
        kept.push(text === turn.text ? turn : { ...turn, text });
        used = text.length;
        continue;
      }
      dropped += 1;
      continue;
    }
    kept.push(turn);
    used += text.length;
  }
  if (dropped > 0 || clipped) {
    console.log(`[free-soul] history trim kept=${kept.length} dropped=${dropped} chars=${used}/${budget}`);
  }
  return kept.reverse();
}

/** 只折叠 page_text / save_shot / save_image，而且折叠后必须更短。不删消息。 */
export function foldToolResults(
  messages: ChatMessage[],
  budget = TOOL_RESULT_BUDGET,
  rounds: WeakMap<ChatMessage, number> = toolRounds,
): void {
  const lengthOf = (message: ChatMessage) => (typeof message.content === "string" ? message.content.length : 0);
  const used = () => messages.reduce((sum, message) => sum + (message.role === "tool" ? lengthOf(message) : 0), 0);
  let total = used();
  if (total <= budget) return;
  for (const message of messages) {
    if (total <= budget) break;
    if (message.role !== "tool") continue;
    const name = message.name || "";
    if (!FOLDABLE_TOOLS.has(name)) continue;
    const content = typeof message.content === "string" ? message.content : "";
    if (!content || content.startsWith("[早期工具结果已折叠")) continue;
    const round = rounds.get(message) ?? 0;
    const next = `[早期工具结果已折叠 r${round} ${name} 原 ${content.length} 字符]\n${content.slice(0, 200)}`;
    if (next.length >= content.length) continue;
    message.content = next;
    total = used();
    console.log(`[free-soul] fold r${round} ${name} ${content.length}→${next.length} chars budget=${total}/${budget}`);
  }
  if (total > budget) {
    console.log(`[free-soul] fold stop chars budget=${total}/${budget}`);
  }
}

export class FreeSoul {
  constructor(
    private config: freeSoulConfig,
    private runTool: FreeSoulToolRunner,
  ) {}

  updateConfig(config: freeSoulConfig): void {
    this.config = config;
  }

  setTaskId(taskId?: string): void {
    this.config.taskId = taskId;
  }

  async run(input: FreeSoulRunInput): Promise<{ ok: boolean; text: string; awaitingConfirm?: boolean; interrupted?: boolean; data?: Record<string, unknown> }> {
    if (!this.config.apiKey && this.config.mode !== "cloud") {
      return { ok: false, text: "请先在设置里配置模型 Key。" };
    }

    const confirmRunId = beginPaidConfirmRun();
    let confirmRunClosed = false;
    const closeConfirmRun = () => {
      if (confirmRunClosed) return;
      confirmRunClosed = true;
      endPaidConfirmRun(confirmRunId);
    };
    const handed = peekPaidConfirmHandoff();
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          systemPrompt(
            input.url,
            input.title,
            input.execMode === "auto" ? "auto" : "step",
            {
              envId: input.envId,
              envName: input.envName,
            },
            input.envs,
          ),
          handed
            ? `内部收费确认句柄是 ${handed}。只有用户这一条是明确同意时，调用 dxm_smt_prepare 才把这个句柄原样放进 paidConsent.confirmId，并带上同一张请求里的 group 和 srcDigest。不要把句柄写给用户。`
            : "",
        ].filter(Boolean).join("\n"),
      },
    ];
    for (const turn of limitHistory(input.history || [])) {
      messages.push({ role: turn.role, content: turn.text });
    }
    messages.push({ role: "user", content: input.input });

    const softAt = Math.max(1, Math.min(99, this.config.maxRounds || 32));
    const safetyCap = 100;
    const budgetAt = Math.max(1, Math.floor(softAt * 0.75));
    let streak = 0;
    let lastFinger = "";
    let pageUrl = input.url || "";
    let pageTitle = input.title || "";
    let lastPageText: string | undefined;
    let samePageText = "";
    let samePageCount = 0;
    let budgetSent = false;
    let savedCaptures = 0;
    const trace: SoulTraceStep[] = [];
    let openedViewPage = false;
    let viewAskHinted = false;
    const end = (result: { ok: boolean; text: string; awaitingConfirm?: boolean; interrupted?: boolean; data?: Record<string, unknown> }) => {
      closeConfirmRun();
      const finished =
        result.ok && !result.awaitingConfirm && !result.interrupted
          ? { ...result, text: finishViewDataReply(input.input, result.text, pageTitle) }
          : result;
      if (finished.ok && !finished.awaitingConfirm && !finished.interrupted) {
        input.onTrace?.({ input: input.input, trace: trace.slice() });
      }
      return finished;
    };
    console.log(`[free-soul] run start input=${input.input.slice(0, 80)}`);
    if (input.signal?.aborted) return end(interruptedResult());
    noteUserReply(input.input);
    for (let round = 1; round <= safetyCap; round += 1) {
      if (input.signal?.aborted) return end(interruptedResult());
      if (viewDataNeedsAsk(input.input) && openedViewPage && !viewAskHinted) {
        viewAskHinted = true;
        messages.push({ role: "user", content: viewDataPauseHint(pageTitle) });
      }
      input.onRound?.(round);
      if (!budgetSent && round >= budgetAt) {
        budgetSent = true;
        console.log(`[free-soul] r${round} BUDGET_HINT ${budgetAt}/${softAt}`);
        messages.push({
          role: "user",
          content: `已执行 ${budgetAt}/${softAt} 轮。已有信息足够回答用户就立即汇总汇报；不够就明确说还缺什么、卡在哪。不要再开新路径。`,
        });
      }
      let data: Awaited<ReturnType<FreeSoul["completion"]>>;
      try {
        data = await this.completion(messages, input.signal, input.taskId);
      } catch (error) {
        if (input.signal?.aborted) return end(interruptedResult());
        if (isSilentTimeout(error)) {
          console.log("[free-soul] llm silent timeout");
          return end({ ok: false, text: SILENT_LLM_TEXT });
        }
        return end({ ok: false, text: modelRequestFailure(error) });
      }
      const choice = data.choices?.[0]?.message;
      if (!choice) return end({ ok: false, text: "模型没有返回消息，任务尚未完成。" });

      const calls = (choice.tool_calls || []).map((call, index) => normalizeToolCall(call, round, index));
      messages.push({
        role: "assistant",
        content: choice.content ?? null,
        tool_calls: calls.length ? calls : choice.tool_calls,
      });

      if (!calls.length) {
        const text = typeof choice.content === "string" ? choice.content.trim() : "";
        return text
          ? end({ ok: true, text })
          : end({ ok: false, text: "模型返回了空回复，任务尚未完成。" });
      }

      const pendingHints: string[] = [];
      for (const call of calls) {
        const name = call.function.name as FreeSoulToolName;
        let args: Record<string, unknown> = {};
        let parseError = "";
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          parseError = "工具参数不是合法 JSON，请修正后重试。";
        }
        if (name === "request_confirm") {
          noteConfirmRequest(String(args.action || ""), String(args.detail || ""));
          const confirmId = registerPaidConfirmFromArgs(args);
          return end({
            ok: true,
            text: confirmText(args),
            awaitingConfirm: true,
            data: confirmId ? { confirmId, pending: true } : undefined,
          });
        }
        const overCaptureBudget =
          (name === "save_shot" || name === "save_image") && savedCaptures >= CAPTURE_RUN_LIMIT;
        const ranTool = !parseError && !overCaptureBudget;
        const result = parseError
          ? { ok: false, message: parseError }
          : overCaptureBudget
            ? { ok: false, message: RUN_CAPTURE_FULL }
            : await this.safeRun(name, args);
        if (ranTool) {
          trace.push({ tool: name, args: traceArgs(args), ok: Boolean(result.ok), round });
          if (trace.length > TRACE_CAP) {
            const capped = capSoulTrace(trace);
            trace.length = 0;
            trace.push(...capped);
          }
        }
        if (name === "match_skill" || name === "run_skill") {
          console.log(`[free-soul] ${name} ok=${result.ok} ${String(result.message || "").slice(0, 160)}`);
        }
        if (
          !parseError &&
          !overCaptureBudget &&
          result.ok &&
          (name === "save_shot" || name === "save_image")
        ) {
          savedCaptures += 1;
        }
        let reported = result;
        if (name === "page_text" && result.ok) {
          const text = pageTextBody(result.data);
          const note = pageTextGrowthNote(lastPageText, text);
          lastPageText = text;
          if (note) {
            reported = {
              ...result,
              message: result.message ? `${result.message}（${note}）` : note,
            };
          }
          if (text === samePageText) samePageCount += 1;
          else {
            samePageText = text;
            samePageCount = 1;
          }
        }
        console.log(
          `[free-soul] r${round} ${name} ok=${reported.ok} ${(reported.message || "").slice(0, 120).replace(/\s+/g, " ")}`,
        );
        const toolMessage: ChatMessage = {
          role: "tool",
          tool_call_id: call.id,
          name,
          content: serializeResult(reported),
        };
        toolRounds.set(toolMessage, round);
        messages.push(toolMessage);
        foldToolResults(messages);
        if (input.signal?.aborted) return end(interruptedResult());
        if (name === "page_text" && result.ok && samePageCount >= 3) {
          console.log(`[free-soul] r${round} PAGE_SAME_HINT`);
          pendingHints.push(PAGE_SAME_HINT);
          samePageCount = 0;
        }
        const noted = noteStuck(name, args, result, pageUrl, pageTitle);
        pageUrl = noted.pageUrl;
        pageTitle = noted.pageTitle;
        if (result.ok && (name === "navigate" || name === "switch_tab" || name === "new_tab")) {
          const titled = String(result.message || "").match(/页面标题：(.+)$/)
            || String(result.message || "").match(/已切换到：(.+)$/);
          if (titled?.[1]) pageTitle = titled[1].replace(/\s+/g, " ").trim();
          if (viewDataNeedsAsk(input.input)) openedViewPage = true;
        }
        if (!noted.unchanged) {
          streak = 0;
          lastFinger = "";
          continue;
        }
        if (noted.finger === lastFinger) streak += 1;
        else {
          lastFinger = noted.finger;
          streak = 1;
        }
        if (streak >= 3) {
          console.log(`[free-soul] r${round} STUCK_HINT ${name}`);
          pendingHints.push(STUCK_HINT);
          streak = 0;
          lastFinger = "";
        }
      }
      for (const hint of pendingHints) {
        messages.push({ role: "user", content: hint });
      }
      if (round === softAt || (round > softAt && (round - softAt) % 8 === 0)) {
        const note = input.locale?.startsWith("zh")
          ? `已执行 ${round} 轮，任务继续中；要换一件事先点停止`
          : `Executed ${round} rounds; the task continues. You can stop or send a new instruction.`;
        input.onSidebar?.(note);
      }
    }

    return end({
      ok: false,
      text: input.locale?.startsWith("zh")
        ? "已达 100 轮安全上限，为防失控已停止；回复继续可接着跑"
        : "Reached the 100-round safety limit and stopped. Reply continue to keep going.",
    });
  }

  private async safeRun(name: FreeSoulToolName, args: Record<string, unknown>): Promise<ToolResult> {
    if (!TOOL_NAMES.has(name)) return { ok: false, message: `未知工具：${name}` };
    try {
      return await this.runTool(name, args);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async completion(messages: ChatMessage[], signal?: AbortSignal, taskId?: string): Promise<{
    choices?: Array<{ message?: ChatMessage }>;
    error?: { message?: string } | string;
  }> {
    const body: Record<string, unknown> = {
      messages: sanitize(messages),
      temperature: 0.2,
      tools: TOOLS,
      tool_choice: "auto",
    };
    if (this.config.model.trim()) body.model = this.config.model.trim();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "api-key": this.config.apiKey,
    };
    if (/anthropic\.com/i.test(this.config.baseUrl)) {
      headers["anthropic-version"] = "2023-06-01";
    }
    const billedTask = taskId || this.config.taskId;
    if (this.config.mode === "cloud" && billedTask) {
      headers["X-Sparo-Task"] = billedTask;
    }

    const doFetch = this.config.fetchImpl || fetch;
    const timeoutMs = this.config.firstByteTimeoutMs || this.config.requestTimeoutMs || FIRST_BYTE_TIMEOUT_MS;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (signal?.aborted) throw abortError();
      const timed = AbortSignal.timeout(timeoutMs);
      const merged = signal ? mergeSignals([signal, timed]) : timed;
      const silentRace = rejectWhen(timed, silentTimeoutError());
      const stopRace = signal ? rejectWhen(signal, abortError()) : undefined;
      void silentRace.catch(() => undefined);
      void stopRace?.catch(() => undefined);
      try {
        const response = await Promise.race([
          doFetch(chatCompletionsUrl(this.config.baseUrl), {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: merged,
          }),
          silentRace,
          ...(stopRace ? [stopRace] : []),
        ]);
        const raw = (await readJson(response, signal)) as {
          choices?: Array<{ message?: ChatMessage }>;
          error?: { message?: string } | string;
        };
        if (!response.ok) {
          const message = typeof raw.error === "string"
            ? raw.error
            : raw.error?.message || `HTTP ${response.status}`;
          throw new Error(`LLM API: ${message}`);
        }
        return raw;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = timed.aborted || isSilentTimeout(error) ? silentTimeoutError() : error;
        console.log(`[free-soul] request failed attempt=${attempt + 1} ${requestErrorDetail(lastError)}`);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

function mergeSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const item of signals) {
    if (item.aborted) {
      controller.abort();
      return controller.signal;
    }
    item.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

function rejectWhen(signal: AbortSignal, error: Error): Promise<never> {
  if (signal.aborted) return Promise.reject(error);
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(error), { once: true });
  });
}

async function readJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  const body = response.json();
  if (!signal) return body;
  const stop = rejectWhen(signal, abortError());
  void stop.catch(() => undefined);
  return Promise.race([body, stop]);
}

function requestErrorDetail(error: unknown): string {
  if (isAbortError(error)) return "请求超时";
  return error instanceof Error ? error.message : String(error);
}

function silentTimeoutError(): Error {
  const error = new Error(SILENT_LLM_TEXT);
  error.name = "SilentTimeoutError";
  return error;
}

function isSilentTimeout(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && String((error as { name?: string }).name) === "SilentTimeoutError");
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name === "AbortError" || /aborted|abort/i.test(message);
}

function modelRequestFailure(error: unknown): string {
  return `模型请求超时/失败：${requestErrorDetail(error)}（可重试）`;
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function interruptedResult(): { ok: true; text: string; interrupted: true } {
  return {
    ok: true,
    text: "（任务被用户打断，未完成的步骤不做宣称。已做的操作以工具记录为准。）",
    interrupted: true,
  };
}
