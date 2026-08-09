/**
 * OpenAI-compatible chat + tool loop (DeepSeek / OpenAI / custom).
 */
import type { ToolResult } from "../../shared/types.js";
import { dxmEnabled } from "../features.js";

export type AgentToolName =
  | "navigate"
  | "get_url"
  | "get_title"
  | "snapshot"
  | "click"
  | "fill"
  | "click_text"
  | "menu_click"
  | "dismiss_overlays"
  | "qa_check"
  | "pause"
  | "resume"
  | "start_recording"
  | "stop_recording"
  | "list_skills"
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
      name: "snapshot",
      description: "DOM snapshot with refs for click/fill",
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
      name: "click_text",
      description: "Click visible text; use withinPortal for Ant Design dropdowns",
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
      name: "start_recording",
      description: "Start recording human actions into a skill",
      parameters: {
        type: "object",
        properties: { task: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stop_recording",
      description: "Stop recording and save as 妙招",
      parameters: {
        type: "object",
        properties: { title: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_skills",
      description: "List saved skills",
      parameters: { type: "object", properties: {} },
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

function systemPrompt(ctx: { url: string; title: string }): string {
  const lines = [
    "You are Sparo Agent Browser's built-in agent: you share the Chromium window with the user. You act; the user reviews. Humans stay in control.",
    "Prefer tools over talk. No feature brochure, no customer-service filler, no menu lists.",
    "Never auto-save, claim, submit, or publish without explicit user approval.",
    `Current page: ${ctx.title || "—"}`,
    `URL: ${ctx.url || "about:blank"}`,
  ];
  if (dxmEnabled()) {
    lines.splice(
      2,
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

  constructor(
    private config: DeepSeekConfig,
    private runTool: AgentToolRunner,
  ) {}

  updateConfig(config: DeepSeekConfig): void {
    this.config = config;
  }

  async chat(
    input: string,
    ctx: { url: string; title: string },
  ): Promise<string> {
    if (!this.config.apiKey) {
      return "No API key. Save one in the sidebar (DeepSeek / OpenAI-compatible), or set SPARO_API_KEY.";
    }

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(ctx) },
      { role: "user", content: input },
    ];

    const toolNotes: string[] = [];
    const recentFingerprints: string[] = [];
    // No artificial round cap for personal use. Only break on identical-tool loops.
    for (;;) {
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
          content: "你陷入了重复工具调用。请停止操作，用中文说明进度与建议。",
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
    const url = `${this.config.baseUrl}/chat/completions`;
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

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
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
