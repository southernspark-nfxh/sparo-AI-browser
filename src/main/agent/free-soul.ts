import type { ToolResult } from "../../shared/types.js";
import { CAPTURE_PROMPT, CAPTURE_RUN_LIMIT, RUN_CAPTURE_FULL } from "../captures.js";
import { pageTextGrowthNote } from "./deepseek.js";
import { chatCompletionsUrl } from "../settings/llm-url.js";

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
  | "run_skill";

export type FreeSoulToolRunner = (
  name: FreeSoulToolName,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

export type freeSoulConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  mode?: "byok" | "cloud";
  taskId?: string;
  fetchImpl?: typeof fetch;
  maxRounds?: number;
  requestTimeoutMs?: number;
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

const TOOLS = [
  tool("navigate", "在当前有头浏览器标签打开完整 URL，并返回实际落地地址和标题。", {
    url: { type: "string" },
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
    "发布、发送、支付、删除之前必须先调用。调用后本次任务会停下，等用户下一条消息明确同意。不要用于普通点击、翻页或搜索。客服回复不要用它去点发送。",
    {
      action: { type: "string", description: "准备做的不可逆动作" },
      detail: { type: "string", description: "让用户确认的具体内容" },
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
];

const STUCK_HINT =
  "同一操作已连续 3 次无效果。这条路径大概率没反应：换入口、直接构造结果 URL、换选择器，或如实向用户汇报当前障碍。禁止继续重复同一操作。也可以整页重载（reload 工具）后重试一次再下结论。";

const PAGE_SAME_HINT =
  "page_text 连续 3 次读到同样内容，页面已无新信息。基于已读内容立即汇报，或明确说明障碍，不要继续滚动或重复读取。";

const TOOL_NAMES = new Set<string>(TOOLS.map((item) => item.function.name));

function systemPrompt(url: string, title: string, execMode?: "step" | "auto"): string {
  const lines = [
    "你是 Sparo 有头浏览器里的 Pi Agent。用户通过浏览器侧栏把任务交给你，你直接操作当前真实浏览器，而不是只给操作建议。",
    "你负责理解目标、自主安排和修改步骤。每轮都根据完整对话、此前的工具调用和真实工具结果决定下一步；不要机械重复固定流程。",
    "需要搜索时，打开搜索引擎结果页或用户指定网站，再读取真实结果。需要多步操作时持续调用工具，直到任务完成或确实需要用户处理。",
    "page_text 用来读事实，snapshot 用来找交互元素。点击、填写后根据实际页面继续判断，不要假定操作已经成功。",
    "滚动翻页采集时注意 page_text 消息里的「较上次 +N 字」：+0 表示这一屏没有新内容，立即基于已读内容汇报或换浏览方式，不要继续滚动。",
    "回答所需信息已经读到时立即汇总汇报，宁可注明局限（如「截至第 N 条」），不要为追求完整耗尽轮次。",
    "最终回复必须基于已经看到的页面和工具结果，给出用户需要的答案及关键来源 URL。没有读到的事实不要编造，没有完成的步骤不要宣称完成。",
    "只在任务完成、无法继续或必须向用户提问时输出最终文字；执行过程中优先调用工具，不要播报空泛计划。",
    "同一元素或同一路径连续两次没有引起页面变化就换策略：换入口、直接构造结果 URL、换交互方式；禁止对同一目标连点超过两次。",
    "页面点按全部失效、疑似弹窗残留遮罩时，用 reload 整页重载一次再重试，不要把遮罩当成这条路没反应。",
    "页面需要登录或出现验证码时，如实告知用户并停在该处等用户处理，不要反复尝试绕过。",
    "无法完成时如实汇报卡在哪一步，不要空转。",
    "发布、发送、支付、删除等不可逆动作：先用 request_confirm 向用户确认，得到用户明确同意后才执行。用户此前下过的命令不算同意，必须经过一次确认往返。客服回复只把草稿填进输入框，发送仍由用户在页面上点。",
    "用户说「直接」「以后」「全部」「别让我看了」等全量授权措辞时，同类批量操作（归档、清理、翻页处理）自主连续执行到做完或真卡住，不中途问「要不要继续」；跨到新的操作类型（改账号设置、订阅、付费、删除不可恢复内容）仍必须先确认。",
    "批量清理长列表时：优先找「选择所有/全部匹配…会话」类横幅链接一次全选；snapshot 里没有但按理该出现的动态元素（如全选后新出现的横幅），用 click_text 按可见文字再试一次，别急着下「取不到」的结论；Gmail 键盘全选是连按 * 和 a；批与批之间沿用同一搜索结果页，不要每批重新构造搜索。",
    "查询火车、机票、酒店时优先用 search_site 拿结果页 URL 再 navigate，不要硬刚这些站点的首页。",
    "发布到微博、知乎、小红书等社交平台的正文要用自然的口语段落：不用 markdown 标题、加粗、编号列表、分割线和序号 emoji（如 1️⃣）；需要分点时用『一、二、三』或自然过渡衔接。在侧栏里直接回复用户的总结不受此限。",
    "用户给出本地文件路径让你上传（视频、图片、附件）时，用 set_file 把文件放进文件选择框，不要试图用 fill 填路径或用 file:// 打开本地目录。",
    CAPTURE_PROMPT,
    "带站点语义的多步任务（发布、上品、采集、生活规划）先 match_skill；命中即优先 run_skill 按剧本走，未命中或剧本执行失败自动回落通用工具路径，不因技能问题中断任务。",
    "历史对话里的工具结果都是当时真实读回的，是可信的。浏览器或应用重启后页面状态会重置，当前标签页在哪、显示什么，都不能用来否定历史里已完成的动作。需要核实历史发布是否生效时，去对应平台实际查看（例如打开微博个人主页看时间线），不要凭当前页面状态下结论。",
    "使用用户最新一条消息的语言回复。",
    `当前页面标题：${title || "（无）"}`,
    `当前页面 URL：${url || "about:blank"}`,
  ];
  if (execMode === "auto") {
    const at = lines.findIndex((line) => line.startsWith("发布、发送、支付、删除等不可逆动作"));
    if (at >= 0) {
      lines.splice(
        at,
        1,
        "当前是自动执行模式：发布、发送类动作直接执行，不调用 request_confirm——用户下达的任务指令本身就是授权（用户说『发小红书』就是授权发到发出为止）。支付、删除仍必须先用 request_confirm 向用户确认，得到明确同意后才执行。客服回复只把草稿填进输入框，发送仍由用户在页面上点。",
        "自动模式下不中途询问『要不要继续』『要不要打开』，一口气执行到任务完成、真阻塞（需要登录、出现验证码、页面持续无响应）或缺了无法自决的关键信息才停。停下时如实说明卡在哪。",
        "缺可自决的细节（先看哪个入口、默认当前城市、先展示第一页结果）就自决并在最终汇报里注明假设；缺影响结果的硬信息（出发地、日期、金额、平台账号选择）且无法从对话和历史推断时，才停下来问。",
      );
    }
  }
  return lines.join("\n");
}

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

function serializeResult(result: ToolResult): string {
  const text = JSON.stringify({
    ok: result.ok,
    message: result.message,
    data: result.data ?? undefined,
  });
  if (text.length <= 24000) return text;
  return `${text.slice(0, 16000)}\n…[工具结果过长，中间已省略]…\n${text.slice(-7000)}`;
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

  async run(input: {
    input: string;
    url: string;
    title: string;
    locale?: string;
    history?: Array<{ role: "user" | "assistant"; text: string }>;
    signal?: AbortSignal;
    execMode?: "step" | "auto";
    onRound?: (round: number) => void;
    onSidebar?: (text: string) => void;
  }): Promise<{ ok: boolean; text: string; awaitingConfirm?: boolean; interrupted?: boolean }> {
    if (!this.config.apiKey && this.config.mode !== "cloud") {
      return { ok: false, text: "请先在设置里配置模型 Key。" };
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: systemPrompt(input.url, input.title, input.execMode === "auto" ? "auto" : "step"),
      },
    ];
    for (const turn of input.history || []) {
      if (!turn.text.trim()) continue;
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
    console.log(`[free-soul] run start input=${input.input.slice(0, 80)}`);
    for (let round = 1; round <= safetyCap; round += 1) {
      if (input.signal?.aborted) return interruptedResult();
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
        data = await this.completion(messages, input.signal);
      } catch (error) {
        if (input.signal?.aborted) return interruptedResult();
        return { ok: false, text: modelRequestFailure(error) };
      }
      const choice = data.choices?.[0]?.message;
      if (!choice) return { ok: false, text: "模型没有返回消息，任务尚未完成。" };

      const calls = (choice.tool_calls || []).map((call, index) => normalizeToolCall(call, round, index));
      messages.push({
        role: "assistant",
        content: choice.content ?? null,
        tool_calls: calls.length ? calls : choice.tool_calls,
      });

      if (!calls.length) {
        const text = typeof choice.content === "string" ? choice.content.trim() : "";
        return text
          ? { ok: true, text }
          : { ok: false, text: "模型返回了空回复，任务尚未完成。" };
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
          return { ok: true, text: confirmText(args), awaitingConfirm: true };
        }
        const overCaptureBudget =
          (name === "save_shot" || name === "save_image") && savedCaptures >= CAPTURE_RUN_LIMIT;
        const result = parseError
          ? { ok: false, message: parseError }
          : overCaptureBudget
            ? { ok: false, message: RUN_CAPTURE_FULL }
            : await this.safeRun(name, args);
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
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: serializeResult(reported),
        });
        if (input.signal?.aborted) return interruptedResult();
        if (name === "page_text" && result.ok && samePageCount >= 3) {
          console.log(`[free-soul] r${round} PAGE_SAME_HINT`);
          pendingHints.push(PAGE_SAME_HINT);
          samePageCount = 0;
        }
        const noted = noteStuck(name, args, result, pageUrl, pageTitle);
        pageUrl = noted.pageUrl;
        pageTitle = noted.pageTitle;
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
          ? `已执行 ${round} 轮，任务继续中；可随时停止或发新指令调整`
          : `Executed ${round} rounds; the task continues. You can stop or send a new instruction.`;
        input.onSidebar?.(note);
      }
    }

    return {
      ok: false,
      text: input.locale?.startsWith("zh")
        ? "已达 100 轮安全上限，为防失控已停止；回复继续可接着跑"
        : "Reached the 100-round safety limit and stopped. Reply continue to keep going.",
    };
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

  private async completion(messages: ChatMessage[], signal?: AbortSignal): Promise<{
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
    if (this.config.mode === "cloud" && this.config.taskId) {
      headers["X-Sparo-Task"] = this.config.taskId;
    }

    const doFetch = this.config.fetchImpl || fetch;
    const timeoutMs = this.config.requestTimeoutMs || 120_000;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (signal?.aborted) throw abortError();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort);
      if (signal?.aborted) controller.abort();
      try {
        const response = await doFetch(chatCompletionsUrl(this.config.baseUrl), {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const raw = (await response.json()) as {
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
        lastError = error;
        console.log(`[free-soul] request failed attempt=${attempt + 1} ${requestErrorDetail(error)}`);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

function requestErrorDetail(error: unknown): string {
  if (isAbortError(error)) return "请求超时";
  return error instanceof Error ? error.message : String(error);
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
