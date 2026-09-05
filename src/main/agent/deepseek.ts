/**
 * OpenAI-compatible chat + tool loop (DeepSeek / OpenAI / custom).
 */
import type { ToolResult } from "../../shared/types.js";
import { dxmEnabled } from "../features.js";
import { chatCompletionsUrl } from "../settings/llm-url.js";
import { tx } from "../../shared/i18n.js";
import { agentCapabilityBrief } from "./intent-router.js";

export type AgentToolName =
  | "navigate"
  | "get_url"
  | "get_title"
  | "page_text"
  | "snapshot"
  | "click"
  | "fill"
  | "fill_suggest"
  | "press"
  | "pick_calendar"
  | "click_text"
  | "menu_click"
  | "dismiss_overlays"
  | "qa_check"
  | "pause"
  | "resume"
  | "list_skills"
  | "get_skill"
  | "match_skill"
  | "run_skill"
  | "cs_one_click_reply"
  | "feishu_work"
  | "list_workflows"
  | "run_workflow";

export type AgentToolRunner = (
  name: AgentToolName,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

export type DeepSeekConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  mode?: "byok" | "cloud";
  taskId?: string;
  fetchImpl?: typeof fetch;
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Open a URL in the active tab",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_url",
      description: "Get current page URL",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_title",
      description: "Get current page title",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "page_text",
      description:
        "Read visible text on the current page (and iframes). Use this to translate, explain, or summarize what the user is looking at. Snapshot is NOT a substitute.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "snapshot",
      description: "Interactive element refs for click/fill — not page prose",
      parameters: {
        type: "object",
        properties: { selector: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "click",
      description: "Click by CSS selector or snapshot ref",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          ref: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fill",
      description: "Fill an input by selector or ref",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          ref: { type: "string" },
          value: { type: "string" },
        },
        required: ["value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fill_suggest",
      description:
        "Type a destination/city and click the autocomplete hit. Use for Ctrip/amap city pickers. Do not click 热门城市 grids in a loop.",
      parameters: {
        type: "object",
        properties: {
          value: { type: "string" },
          ref: { type: "string" },
          selector: { type: "string" },
        },
        required: ["value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "press",
      description: "Press Enter or Escape",
      parameters: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pick_calendar",
      description:
        "Set a date on a custom calendar popover. Prefer this over clicking bare day numbers.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string" },
          value: { type: "string" },
          triggerRef: { type: "string" },
          triggerText: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "click_text",
      description: "Click visible text; withinPortal for menus and calendars. Day numbers must uniquely match an in-month gridcell.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          withinPortal: { type: "boolean" },
          caret: { type: "boolean" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "menu_click",
      description: "Open a text trigger menu then click an item (Portal-safe)",
      parameters: {
        type: "object",
        properties: {
          trigger: { type: "string" },
          item: { type: "string" },
        },
        required: ["trigger", "item"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dismiss_overlays",
      description: "Close stuck modals / overlays",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "qa_check",
      description: "Run Dianxiaomi SMT QA checks",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "pause",
      description: "Pause Agent so human can take over",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "resume",
      description: "Resume Agent control after pause",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_skills",
      description: "List built-in skills (e.g. 发小红书, 通用填表). Recording new skills is not available.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "match_skill",
      description:
        "Match user intent to a saved skill. Query must keep the user's site (发知乎 ≠ 小红书).",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_skill",
      description: "Get full skill steps by id or query",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          query: { type: "string" },
        },
      },
    },
  },
    {
      type: "function",
      function: {
        name: "cs_one_click_reply",
        description:
          "Scan current page chat/comments and draft a reply. Never sends. Use when user wants 回复/一键回复.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "feishu_work",
        description:
          "Feishu web: open messenger, find a contact, inject chat/journal draft. Never clicks 发送. Use when user says 飞书/给谁发/写日报.",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", description: "open | chat | journal | doc | calendar" },
            to: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
          },
        },
      },
    },
  {
    type: "function",
    function: {
      name: "run_skill",
      description:
        "FAST PATH: run a saved 妙招 end-to-end in the shared browser. Prefer this over manual click/fill for known flows (小红书发布, etc). Pass id or query; optional params.title/body/topics/mdPath.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          query: { type: "string" },
          params: { type: "object" },
          dryRun: { type: "boolean" },
        },
      },
    },
  },
  ...(dxmEnabled()
    ? ([
        {
          type: "function",
          function: {
            name: "list_workflows",
            description: "List optional vertical workflows",
            parameters: { type: "object", properties: {} },
          },
        },
        {
          type: "function",
          function: {
            name: "run_workflow",
            description: "Run optional vertical workflow by id",
            parameters: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
          },
        },
      ] as const)
    : ([] as const)),
];

function systemPrompt(ctx: {
  url: string;
  title: string;
  skills?: string;
  profileBrief?: string;
  locale?: string;
  pageText?: string;
}): string {
  const lines = [
    agentCapabilityBrief(ctx.locale),
    "Prefer tools over talk. No feature brochure, no customer-service filler, no menu lists.",
    "Reply in the same language as the user's latest message. Chinese question → Chinese answer, even if the UI or page is English.",
    "SKILL FIRST only when the skill's site matches. No matching skill → snapshot/click/fill yourself. Never ask the user to record a skill instead of acting.",
    "Do not name Xiaohongshu, RedNote, Weibo, Zhihu, or any social network, and do not offer to publish or post, unless the user already named that site or action.",
    "If the current URL is xiaohongshu.com: NEVER fill title/body character-by-character or loop fill. Pass pre-baked text into xhs_inject_compose / xhs_inject_publish (or run_skill params). Detect stage with xhs_page_stage and click Next / auto-layout.",
    "FEISHU RULE: Use feishu_work or run_skill query 飞书. Inject draft once. NEVER click 发送. Login wall → pause for the human.",
    "User said publish/post/发/发布/发三条 = permission to click send. Pause only for payment or customer-service send.",
    `Current page: ${ctx.title || "—"}`,
    `URL: ${ctx.url || "about:blank"}`,
  ];
  if (ctx.pageText) {
    lines.push("Visible page text (source of truth; do not invent beyond this):");
    lines.push(ctx.pageText.slice(0, 6000));
  } else {
    lines.push("No page text was attached. Call page_text before describing or translating this page.");
  }
  if (ctx.skills) {
    lines.push(`Saved skills:\n${ctx.skills}`);
  }
  if (ctx.profileBrief) {
    lines.push(ctx.profileBrief);
    lines.push(tx(ctx.locale, "llm.profileUse"));
  }
  if (dxmEnabled()) {
    lines.splice(
      3,
      0,
      "Optional Dianxiaomi vertical tools may be available (list_workflows / run_workflow / qa_check).",
    );
  }
  return lines.join("\n");
}

function truncate(s: string, n = 3500): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function callFingerprint(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(args)}`;
}

export class DeepSeekAgentProvider {
  readonly name = "deepseek";
  lastMutations: Array<{ tool: string; args: Record<string, unknown> }> = [];

  constructor(
    private config: DeepSeekConfig,
    private runTool: AgentToolRunner,
  ) {}

  updateConfig(config: DeepSeekConfig): void {
    this.config = config;
  }

  setTaskId(taskId?: string): void {
    this.config.taskId = taskId;
  }

  takeMutations(): Array<{ tool: string; args: Record<string, unknown> }> {
    const out = this.lastMutations;
    this.lastMutations = [];
    return out;
  }

  /** One-shot completion with no tools — page summaries, not clicking. */
  async completePlain(prompt: string): Promise<string> {
    if (!this.config.apiKey && this.config.mode !== "cloud") {
      return "";
    }
    const data = await this.completion(
      [{ role: "user", content: prompt }],
      "none",
    );
    return (data?.choices?.[0]?.message?.content || "").trim();
  }

  async chat(
    input: string,
    ctx: {
      url: string;
      title: string;
      skills?: string;
      history?: Array<{ role: "user" | "assistant"; text: string }>;
      profileBrief?: string;
      locale?: string;
      pageText?: string;
    },
  ): Promise<string> {
    if (!this.config.apiKey && this.config.mode !== "cloud") {
      return tx(ctx.locale, "llm.needKey");
    }

    this.lastMutations = [];
    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(ctx) }];
    for (const turn of ctx.history || []) {
      if (!turn.text?.trim()) continue;
      messages.push({
        role: turn.role === "assistant" ? "assistant" : "user",
        content: turn.text,
      });
    }
    messages.push({ role: "user", content: input });

    const toolNotes: string[] = [];
    const recentFingerprints: string[] = [];
    let rounds = 0;
    for (;;) {
      rounds += 1;
      if (rounds > 16) {
        return (
          (tx(ctx.locale, "llm.repeatStop") ||
            "这一页的控件连试多轮都没走完（常见是城市联想或日期弹层）。请换一种说法，或先点开目标页再让我读结果。") +
          (toolNotes.length ? "\n\n" + toolNotes.slice(-8).join("\n") : "")
        );
      }
      const data = await this.completion(messages, "auto");
      const choice = data?.choices?.[0]?.message as ChatMessage | undefined;
      if (!choice) {
        return "Model returned no message. Retry.";
      }

      messages.push({
        role: "assistant",
        content: choice.content ?? null,
        tool_calls: choice.tool_calls,
      });

      const calls = choice.tool_calls || [];
      if (!calls.length) {
        const text = (choice.content || "").trim();
        if (toolNotes.length && !text) {
          return toolNotes.slice(-20).join("\n");
        }
        return text || (toolNotes.length ? toolNotes.slice(-20).join("\n") : "（无文本回复）");
      }

      let repeated = false;
      for (const call of calls) {
        const name = call.function?.name as AgentToolName;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }

        const fp = callFingerprint(name, args);
        recentFingerprints.push(fp);
        if (recentFingerprints.length > 8) recentFingerprints.shift();
        if (
          recentFingerprints.length >= 4 &&
          recentFingerprints.slice(-4).every((x) => x === fp)
        ) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name,
            content: JSON.stringify({
              ok: false,
              message: "相同工具连续重复，已中止该调用。请换策略或向用户说明。",
            }),
          });
          toolNotes.push(`${name}: 重复调用已中止`);
          repeated = true;
          break;
        }

        const result = await this.safeRun(name, args);
        if (
          result.ok &&
          (name === "navigate" ||
            name === "click" ||
            name === "fill" ||
            name === "click_text")
        ) {
          this.lastMutations.push({ tool: name, args });
        }
        const payload = truncate(
          JSON.stringify({
            ok: result.ok,
            message: result.message,
            data: result.data ?? undefined,
          }),
        );
        toolNotes.push(`${name}: ${result.message}`);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: payload,
        });
      }

      if (repeated) {
        messages.push({
          role: "user",
          content: tx(ctx.locale, "llm.repeatStop"),
        });
        const final = await this.completion(messages, "none");
        const text = (final?.choices?.[0]?.message?.content || "").trim();
        return text || toolNotes.slice(-20).join("\n");
      }
    }
  }

  private async safeRun(
    name: AgentToolName,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    try {
      if (!TOOLS.some((t) => t.function.name === name)) {
        return { ok: false, message: `未知工具: ${name}` };
      }
      return await this.runTool(name, args);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async completion(
    messages: ChatMessage[],
    toolChoice: "auto" | "none",
  ): Promise<{
    choices?: Array<{ message?: ChatMessage }>;
    error?: { message?: string };
  }> {
    const url = chatCompletionsUrl(this.config.baseUrl);
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: 0.2,
    };
    if (toolChoice === "none") {
      body.tool_choice = "none";
    } else {
      body.tools = TOOLS;
      body.tool_choice = "auto";
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "api-key": this.config.apiKey,
    };
    if (this.config.mode === "cloud" && this.config.taskId) {
      headers["X-Sparo-Task"] = this.config.taskId;
    }
    const doFetch = this.config.fetchImpl || fetch;
    const res = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const raw = (await res.json()) as {
      choices?: Array<{ message?: ChatMessage }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      const msg = raw?.error?.message || `HTTP ${res.status}`;
      throw new Error(`LLM API: ${msg}`);
    }
    return raw;
  }
}
