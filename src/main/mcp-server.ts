import http from "node:http";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ToolHandlers } from "./tools/index.js";
import {
  applyCors,
  checkRateLimit,
  jsonError,
  logMcpRequest,
} from "./mcp-security.js";

const DEFAULT_PORT = Number(process.env.SPARO_MCP_PORT || process.env.SPARK_MCP_PORT || 3921);

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function registerTools(server: McpServer, handlers: ToolHandlers): void {
  server.tool(
    "sparo_info",
    "FIRST TOOL for new agents: what Sparo is, skill catalog, and fastest paths. Call once before exploring. Prefer run_skill only when the skill site matches the user (发小红书 ≠ 发知乎).",
    {},
    async () => textResult(await handlers.sparo_info()),
  );

  server.tool(
    "navigate",
    "Open a URL and return confirmed {url, title} after load settles. Always check data.confirmed/url before continuing.",
    { url: z.string().min(1).describe("URL to open") },
    async ({ url }) => textResult(await handlers.navigate(url)),
  );

  server.tool(
    "snapshot",
    "Capture interactive elements with refs, including role=grid / gridcell / spinbutton in open calendars. Always re-snapshot after navigation or DOM changes. After opening End time, snapshot the popover — do not fill the closed button. Refs expire after nav.",
    {
      selector: z
        .string()
        .optional()
        .describe("Optional filter substring for name/selector/ref/placeholder"),
    },
    async ({ selector }) => textResult(await handlers.snapshot(selector)),
  );

  server.tool(
    "click",
    "Trusted mouse click by ref/selector. For Ant Design Dropdown: do NOT double-click; returns data.portals when menu opens. Use caret=true for split-button right edge.",
    {
      ref: z.string().optional().describe("Element ref from snapshot, e.g. e3"),
      selector: z.string().optional().describe("CSS selector fallback"),
      caret: z
        .boolean()
        .optional()
        .describe("Click near right edge (dropdown caret on split buttons)"),
    },
    async ({ ref, selector, caret }) =>
      textResult(await handlers.click({ ref, selector, caret })),
  );

  server.tool(
    "fill",
    "Fill input/textarea/contenteditable, then read back actual value (data.matched must be true).",
    {
      ref: z.string().optional(),
      selector: z.string().optional(),
      value: z.string().describe("Text to fill"),
    },
    async ({ ref, selector, value }) =>
      textResult(await handlers.fill({ ref, selector }, value)),
  );

  server.tool(
    "execute",
    "P0: Run JavaScript in the page (or a cross-origin iframe via frame index) and return a JSON-serializable result. Example: document.querySelectorAll('iframe').length. For CDP frames from snapshot, pass frame: 0 for x0.* refs.",
    {
      script: z
        .string()
        .min(1)
        .describe("JS expression or statements; return value is JSON-cloned back"),
      frame: z
        .union([z.number(), z.string()])
        .optional()
        .describe("CDP frame index (0 for x0) or frameId — required for cross-origin iframe DOM"),
    },
    async ({ script, frame }) =>
      textResult(await handlers.execute(script, frame !== undefined ? { frame } : undefined)),
  );

  server.tool(
    "select",
    "P1: Select a native <select> option or combobox/listbox option by visible text or value.",
    {
      ref: z.string().optional().describe("Element ref from snapshot"),
      selector: z.string().optional().describe("CSS selector fallback"),
      value: z.string().min(1).describe("Option label or value to select"),
    },
    async ({ ref, selector, value }) =>
      textResult(await handlers.select({ ref, selector }, value)),
  );

  server.tool(
    "upload",
    "P1: Set files on <input type=file> via CDP. Pass absolute local file paths.",
    {
      ref: z.string().optional().describe("Ref near the upload control"),
      selector: z.string().optional().describe("CSS selector for input[type=file] or parent"),
      files: z
        .array(z.string().min(1))
        .min(1)
        .describe("Absolute file path(s) to upload"),
    },
    async ({ ref, selector, files }) =>
      textResult(await handlers.upload({ ref, selector }, files)),
  );

  server.tool(
    "click_text",
    "P0: Trusted click by visible text. Set withinPortal=true for dropdowns AND calendar popovers. Day numbers (1–31) only match a unique in-month gridcell (aria-label), never ghosted next-month days or the month chevron.",
    {
      text: z.string().min(1),
      exact: z.boolean().optional(),
      withinPortal: z.boolean().optional(),
      caret: z.boolean().optional(),
    },
    async ({ text, exact, withinPortal, caret }) =>
      textResult(await handlers.click_text(text, { exact, withinPortal, caret })),
  );

  server.tool(
    "menu_click",
    "P0: Open a dropdown by trigger text, wait for Portal menu, then click item text. Use for 编辑图片→图片翻译 etc.",
    {
      trigger: z.string().min(1).describe("Trigger button text, e.g. 编辑图片"),
      item: z.string().min(1).describe("Menu item text, e.g. 图片翻译"),
    },
    async ({ trigger, item }) => textResult(await handlers.menu_click(trigger, item)),
  );

  server.tool(
    "dismiss_overlays",
    "Close tip/confirm modals and hide leftover dropdowns that block the next action.",
    {},
    async () => textResult(await handlers.dismiss_overlays()),
  );

  server.tool(
    "list_portals",
    "List visible portal overlays (Ant Design menus AND custom date calendars). Calendar items include gridcell accessible names, not just innerText \"3\".",
    {},
    async () => textResult(await handlers.list_portals()),
  );

  server.tool(
    "list_skills",
    "List built-in skills. For execution use match_skill + run_skill. Recording new skills is not available.",
    {},
    async () => textResult(await handlers.list_skills()),
  );

  server.tool(
    "match_skill",
    "Match a natural-language goal to a saved skill (e.g. 发小红书 → xhs-longform-publish). Call before run_skill when id is unknown.",
    { query: z.string().min(1).describe("User goal or skill name") },
    async ({ query }) => textResult(await handlers.match_skill(query)),
  );

  server.tool(
    "get_skill",
    "Get full skill JSON (steps/params) by id or fuzzy query.",
    {
      id: z.string().optional().describe("Skill id"),
      query: z.string().optional().describe("Fuzzy title/intent if id unknown"),
    },
    async ({ id, query }) =>
      textResult(await handlers.get_skill(String(id || query || ""))),
  );

  server.tool(
    "run_skill",
    "FAST PATH: execute a saved 妙招 in the shared Sparo window (navigate/click/fill/…). Prefer this over inventing click sequences. Pauses before publish. Params: title, body, topics[], mdPath.",
    {
      id: z.string().optional().describe("Skill id, e.g. xhs-longform-publish"),
      query: z
        .string()
        .optional()
        .describe("Fuzzy match, e.g. 小红书发布 / 发小红书"),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Skill params: title, body, topics, mdPath, …"),
      dryRun: z
        .boolean()
        .optional()
        .describe("If true, only resolve skill + list steps"),
    },
    async ({ id, query, params, dryRun }) =>
      textResult(
        await handlers.run_skill({
          id,
          query,
          params: params as Record<string, unknown> | undefined,
          dryRun,
        }),
      ),
  );

  server.tool(
    "xhs_scroll_bottom",
    "Xiaohongshu: scroll long-form editor so 下一步 is on-screen.",
    {},
    async () => textResult(await handlers.xhs_scroll_bottom()),
  );

  server.tool(
    "xhs_ensure_editor",
    "Xiaohongshu: open long-form editor (写长文 → 新的创作 → 空白创作). Do NOT fill content here.",
    {},
    async () => textResult(await handlers.xhs_ensure_editor()),
  );

  server.tool(
    "xhs_page_stage",
    "Xiaohongshu: detect stage only (chooser|compose|layout|publish). AI should route on this — never type into fields.",
    {},
    async () => textResult(await handlers.xhs_page_stage()),
  );

  server.tool(
    "xhs_inject_compose",
    "ATOMIC: inject pre-baked title+body into compose editors ONCE (clears then writes). Prefer this over fill. Pass full title/body in args — do not type character by character.",
    {
      title: z.string().optional(),
      body: z.string().optional(),
      force: z
        .boolean()
        .optional()
        .describe("Overwrite even if fields non-empty (default true)"),
    },
    async ({ title, body, force }) =>
      textResult(await handlers.xhs_inject_compose({ title, body, force })),
  );

  server.tool(
    "xhs_inject_publish",
    "ATOMIC: inject pre-baked summary + topics on publish page ONCE. Prefer over fill/click_text loops for tags.",
    {
      summary: z.string().optional().describe("Short description / 简介"),
      topics: z.array(z.string()).optional(),
    },
    async ({ summary, topics }) =>
      textResult(await handlers.xhs_inject_publish({ summary, topics })),
  );

  server.tool(
    "xhs_layout_next",
    "Xiaohongshu: 一键排版 → wait for template panel (often 10–20s) → pick template → 下一步 → publish page. Prefer over manual click_text loops.",
    {
      template: z
        .string()
        .optional()
        .describe("Template name, default 简约基础"),
      timeoutMs: z.number().optional().describe("Wait for layout panel, default 32000"),
    },
    async ({ template, timeoutMs }) =>
      textResult(await handlers.xhs_layout_next({ template, timeoutMs })),
  );

  server.tool(
    "xhs_add_topics",
    "Xiaohongshu: add topics (prefer xhs_inject_publish which includes topics).",
    {
      topics: z
        .array(z.string())
        .min(1)
        .describe("Topic labels, e.g. ['#ai','#ai浏览器']"),
    },
    async ({ topics }) => textResult(await handlers.xhs_add_topics(topics)),
  );

  server.tool(
    "xhs_pick_cover",
    "Xiaohongshu: pick first cover suggestion card if present.",
    {},
    async () => textResult(await handlers.xhs_pick_cover()),
  );

  server.tool(
    "xhs_click_publish",
    "Xiaohongshu: click content-area 发布 (x>360), NOT sidebar 发布笔记.",
    {},
    async () => textResult(await handlers.xhs_click_publish()),
  );

  server.tool(
    "screenshot",
    "Capture active page PNG under %APPDATA%/sparo/diag/ for debugging.",
    { label: z.string().optional().describe("Filename label") },
    async ({ label }) => textResult(await handlers.screenshot(label)),
  );

  server.tool(
    "diagnose",
    "On failure: url + title + page_text slice + screenshot path. Call after wait_for/fill fails.",
    { label: z.string().optional() },
    async ({ label }) => textResult(await handlers.diagnose(label)),
  );

  server.tool(
    "save_sessions",
    "Flush browser cookies to disk and record login status for sites (xiaohongshu/weibo/zhihu). Call after human logs in — agents then reuse cookies without passwords.",
    {
      sites: z
        .array(z.string())
        .optional()
        .describe("Optional site ids: xiaohongshu, weibo, zhihu"),
    },
    async ({ sites }) => textResult(await handlers.save_sessions(sites)),
  );

  server.tool(
    "list_sessions",
    "List saved login session metadata (cookie counts/names only, no secrets).",
    {},
    async () => textResult(await handlers.list_sessions()),
  );

  server.tool(
    "analyze_page",
    "FIRST step for unknown forms: classify inputs/buttons/date_picker_button, detect required, stamp data-spark-ref. Custom calendars (X Ads End time) are date_picker_button — not text fill. Then execute_primitives or pick_calendar. Do NOT start with blind fill loops.",
    {},
    async () => textResult(await handlers.analyze_page()),
  );

  server.tool(
    "execute_primitives",
    "Fill ANY page from a Chinese/English label→value payload. Fuzzy-matches labels → fill/click/upload/pick_calendar + mini-QA. Date pickers (End time, Run indefinitely) open the calendar grid — never fill a datetime string into a budget box. Xiaohongshu long-form: use xhs_* instead.",
    {
      payload: z
        .record(z.unknown())
        .describe('Map of field labels to values, e.g. {"标题":"hi","正文":"…","话题":["AI"]}'),
      url: z.string().optional().describe("Optional navigate before analyze"),
      includeOptional: z.boolean().optional(),
      maxAttempts: z.number().optional(),
    },
    async ({ payload, url, includeOptional, maxAttempts }) =>
      textResult(
        await handlers.execute_primitives({
          payload: payload as Record<string, unknown>,
          url,
          includeOptional,
          maxAttempts,
        }),
      ),
  );

  server.tool(
    "pick_calendar",
    "Set a custom calendar + hours:minutes popover (X Ads End time). Sequence: open trigger → Next month by aria-label (never click \"<\") → unique in-month gridcell → fill hour and minute spinboxes separately → click outside to commit. Does NOT click Next / Save draft / pay. Prefer this over fill or click_text \"3\".",
    {
      ref: z.string().optional().describe("data-spark-ref of the End time button"),
      trigger: z.string().optional().describe("Visible trigger text, e.g. Run indefinitely"),
      date: z.string().describe("Target date: 2026-09-03 or Sep 3, 2026"),
      hours: z.union([z.string(), z.number()]).optional().describe("24h hours, e.g. 00"),
      minutes: z.union([z.string(), z.number()]).optional().describe("Minutes, e.g. 59 — separate from hours"),
      dismiss: z.enum(["outside", "escape"]).optional(),
    },
    async ({ ref, trigger, date, hours, minutes, dismiss }) =>
      textResult(
        await handlers.pick_calendar({
          triggerRef: ref,
          triggerText: trigger,
          date,
          hours,
          minutes,
          dismiss,
        }),
      ),
  );

  server.tool(
    "cs_scan",
    "Customer-service helper (any site): detect chat-like UI, extract recent messages, locate composer. Does NOT send. Follow with cs_draft_reply.",
    {},
    async () => textResult(await handlers.cs_scan()),
  );

  server.tool(
    "cs_draft_reply",
    "SEMI-AUTO customer reply for ANY open chat page: classify intent → generate draft (LLM if key configured, else template) → fill composer. NEVER clicks Send — human must confirm on page. Optional draft override.",
    {
      draft: z.string().optional().describe("Optional pre-written reply; skips generation"),
      fill: z.boolean().optional().describe("Fill composer (default true)"),
      preferLlm: z.boolean().optional().describe("Try LLM draft when API key set (default true)"),
    },
    async ({ draft, fill, preferLlm }) =>
      textResult(await handlers.cs_draft_reply({ draft, fill, preferLlm })),
  );

  server.tool(
    "cs_one_click_reply",
    "One click on the CURRENT page: scan chat or comments → draft with the configured LLM (template fallback) → fill the reply box. NEVER clicks Send/发布 — human confirms on the page. Use when the user asks 一键回复.",
    {},
    async () => textResult(await handlers.cs_one_click_reply()),
  );

  server.tool(
    "feishu_page_stage",
    "Feishu web: detect stage only (login|messenger|journal|doc|other). AI routes on this — never type into the page.",
    {},
    async () => textResult(await handlers.feishu_page_stage()),
  );

  server.tool(
    "feishu_ensure_messenger",
    "Open Feishu web messenger (https://www.feishu.cn/next/messenger). If login wall, pause for the human. Does not send messages.",
    {},
    async () => textResult(await handlers.feishu_ensure_messenger()),
  );

  server.tool(
    "feishu_open_chat",
    "Feishu web: search a contact/group and open the conversation. Does not type or send.",
    {
      to: z.string().min(1).describe("Contact or group name, e.g. 张三"),
    },
    async ({ to }) => textResult(await handlers.feishu_open_chat({ to })),
  );

  server.tool(
    "feishu_inject_chat",
    "ATOMIC: write a chat draft into the Feishu composer ONCE. NEVER clicks 发送 — human must send.",
    {
      body: z.string().min(1).describe("Pre-baked message text"),
    },
    async ({ body }) => textResult(await handlers.feishu_inject_chat({ body })),
  );

  server.tool(
    "feishu_inject_journal",
    "ATOMIC: write a Feishu report/journal draft ONCE (title+body). NEVER submits. If no report box, caller should fall back to chat draft.",
    {
      title: z.string().optional(),
      body: z.string().optional(),
    },
    async ({ title, body }) =>
      textResult(await handlers.feishu_inject_journal({ title, body })),
  );

  server.tool(
    "feishu_work",
    "FAST PATH Feishu web: open messenger/report, find contact, inject chat or journal draft, then pause. NEVER clicks 发送. Prefer this or run_skill query 飞书.",
    {
      kind: z
        .enum(["open", "chat", "journal", "doc", "calendar"])
        .optional()
        .describe("open | chat | journal | doc | calendar"),
      to: z.string().optional().describe("Contact or group name"),
      title: z.string().optional(),
      body: z.string().optional().describe("Draft text; not sent"),
    },
    async ({ kind, to, title, body }) =>
      textResult(await handlers.feishu_work({ kind, to, title, body })),
  );

  server.tool(
    "new_tab",
    "Open a new browser tab (optional URL). Tools always act on the active tab.",
    { url: z.string().optional() },
    async ({ url }) => textResult(await handlers.new_tab(url)),
  );

  server.tool(
    "close_tab",
    "Close a tab by id. Closing the last tab opens a blank page; the window stays open.",
    { id: z.string().min(1) },
    async ({ id }) => textResult(await handlers.close_tab(id)),
  );

  server.tool(
    "switch_tab",
    "Switch the active tab by id.",
    { id: z.string().min(1) },
    async ({ id }) => textResult(await handlers.switch_tab(id)),
  );

  server.tool("list_tabs", "List tabs and active tab id/url.", {}, async () =>
    textResult(await handlers.list_tabs()),
  );

  server.tool(
    "discard_inactive_tabs",
    "Sleep background tabs to free RAM (destroys Chromium renderers; clicking a tab reloads it). Prefer after opening many heavy tabs.",
    {},
    async () => textResult(await handlers.discard_inactive_tabs()),
  );

  server.tool(
    "request_approval",
    "Ask the human to approve/reject a sensitive action via the sidebar. Blocks until resolved.",
    {
      action: z.string().min(1),
      reason: z.string().min(1),
      risk: z.string().optional(),
    },
    async ({ action, reason, risk }) =>
      textResult(await handlers.request_approval(action, reason, risk)),
  );

  server.tool(
    "wait_for",
    "Wait until a DOM element appears (by selector, text, or ref). This is NOT human approval — Agent waits for page readiness.",
    {
      selector: z.string().optional(),
      text: z.string().optional(),
      ref: z.string().optional(),
      timeoutMs: z.number().optional(),
      all: z
        .boolean()
        .optional()
        .describe("If true with comma selectors, require ALL parts visible (AND)"),
    },
    async ({ selector, text, ref, timeoutMs, all }) =>
      textResult(await handlers.wait_for({ selector, text, ref, timeoutMs, all })),
  );

  server.tool(
    "qa_check",
    "Run Dianxiaomi SMT product-edit QA checklist on the active tab.",
    {},
    async () => textResult(await handlers.qa_check()),
  );

  server.tool(
    "qa_gate",
    "Run QA and block if FAIL. Use before submit/save. Click on 提交 also auto-gates.",
    {},
    async () => textResult(await handlers.qa_gate()),
  );

  server.tool("get_url", "Get current page URL", {}, async () =>
    textResult(await handlers.get_url()),
  );

  server.tool("get_title", "Get current page title", {}, async () =>
    textResult(await handlers.get_title()),
  );

  server.tool(
    "contains_text",
    "Hard check: whether visible page body text contains a needle (use after Weibo send to verify timeline).",
    { text: z.string().min(1) },
    async ({ text }) => textResult(await handlers.contains_text(text)),
  );

  server.tool(
    "page_text",
    "Return a slice of visible document.body.innerText for debugging.",
    {},
    async () => textResult(await handlers.page_text()),
  );

  server.tool("reload", "Reload current page", {}, async () =>
    textResult(await handlers.reload()),
  );

  server.tool("go_back", "Browser back", {}, async () =>
    textResult(await handlers.go_back()),
  );

  server.tool("go_forward", "Browser forward", {}, async () =>
    textResult(await handlers.go_forward()),
  );

  server.tool("pause", "Pause agent control (human takeover)", {}, async () =>
    textResult(await handlers.pause()),
  );

  server.tool("resume", "Resume agent control", {}, async () =>
    textResult(await handlers.resume()),
  );

  server.tool(
    "list_workflows",
    "List optional vertical workflows (disabled in public Sparo unless SPARO_ENABLE_DXM=1)",
    {},
    async () => textResult(await handlers.list_workflows()),
  );

  server.tool(
    "run_workflow",
    "Run optional vertical workflow by id (disabled unless SPARO_ENABLE_DXM=1)",
    {
      id: z.string().min(1).describe("Workflow id"),
    },
    async ({ id }) => textResult(await handlers.run_workflow(id)),
  );
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw);
}

export async function startMcpServer(handlers: ToolHandlers): Promise<{
  port: number;
  endpoint: string;
  token: string;
  close: () => Promise<void>;
}> {
  const token = process.env.SPARO_MCP_TOKEN || process.env.SPARK_MCP_TOKEN || randomBytes(24).toString("hex");
  const TOOL_NAMES = Object.keys(handlers).sort();

  const httpServer = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url || "/", `http://127.0.0.1:${DEFAULT_PORT}`);
    const method = req.method || "GET";
    let logged = false;
    const logOnce = () => {
      if (logged) return;
      logged = true;
      logMcpRequest({
        method,
        path: url.pathname,
        status: res.statusCode || 0,
        latencyMs: Date.now() - started,
        clientIp: req.socket.remoteAddress,
      });
    };
    res.on("finish", logOnce);
    res.on("close", logOnce);

    if (applyCors(req, res)) {
      return;
    }

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          name: "sparo",
          product: "Sparo Agent Browser",
          tagline: "The browser built for AI agents — humans stay in control.",
          endpoint: "/mcp",
          toolCount: TOOL_NAMES.length,
          tools: TOOL_NAMES,
          xhs_tools: TOOL_NAMES.filter((t) => t.startsWith("xhs_")),
          agent: {
            read: "AGENTS.md",
            open_example: "npm run open -- https://weibo.com",
            auth: "%APPDATA%/sparo/mcp-auth.json",
          },
        }),
      );
      return;
    }

    if (url.pathname === "/tools") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, count: TOOL_NAMES.length, tools: TOOL_NAMES }));
      return;
    }

    if (url.pathname !== "/mcp") {
      jsonError(res, 404, "Not found");
      return;
    }

    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${token}`) {
      jsonError(res, 401, "Unauthorized", "unauthorized");
      return;
    }

    const limit = checkRateLimit(token);
    if (!limit.ok) {
      if (limit.retryAfterMs !== undefined) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))));
      }
      jsonError(res, 429, "Too Many Requests", "rate_limited");
      return;
    }

    // Stateless mode: one transport + server per request (SDK recommended pattern).
    const server = new McpServer({ name: "sparo", version: "0.1.0" });
    registerTools(server, handlers);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      const parsedBody = req.method === "POST" ? await readJsonBody(req) : undefined;
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      console.error("[sparo-mcp] request error:", error);
      if (!res.headersSent) {
        jsonError(
          res,
          500,
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(DEFAULT_PORT, "127.0.0.1", () => resolve());
  });

  const address = httpServer.address();
  const port = address && typeof address === "object" ? address.port : DEFAULT_PORT;
  const endpoint = `http://127.0.0.1:${port}/mcp`;

  console.log(`[sparo-mcp] listening on ${endpoint}`);
  console.log(`[sparo-mcp] Authorization: Bearer ${token.slice(0, 8)}… (full token in mcp-auth.json)`);

  return {
    port,
    endpoint,
    token,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
