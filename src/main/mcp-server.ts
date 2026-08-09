import http from "node:http";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ToolHandlers } from "./tools/index.js";

const DEFAULT_PORT = Number(process.env.SPARO_MCP_PORT || process.env.SPARK_MCP_PORT || 3920);

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
    "FIRST TOOL for new agents: what Sparo is + fastest way to open a URL. Call this once before exploring.",
    {},
    async () =>
      textResult({
        ok: true,
        name: "sparo",
        what: "Sparo Agent Browser — local Electron Chromium controlled via MCP. Shared window with the human. The browser built for AI agents — humans stay in control.",
        product: {
          en: "Sparo Agent Browser",
          tagline: "The browser built for AI agents — humans stay in control.",
          zh: "Sparo 人机同窗浏览器",
          zh_tagline: "AI 驾驭网页，你驾驭 AI",
        },
        fast_path: [
          "If Sparo is running, call navigate then get_url.",
          "If not running: from repo root run `npm run start`, wait for GET /health.",
          "Or one shot: `npm run open -- https://weibo.com`",
          "Auth file: %APPDATA%/sparo/mcp-auth.json",
          "Read AGENTS.md — do not scan the whole codebase.",
        ],
        health: `http://127.0.0.1:${DEFAULT_PORT}/health`,
        core_tools: [
          "navigate",
          "get_url",
          "get_title",
          "snapshot",
          "click",
          "fill",
          "click_text",
          "pause",
          "resume",
        ],
      }),
  );

  server.tool(
    "navigate",
    "Open a URL and return confirmed {url, title} after load settles. Always check data.confirmed/url before continuing.",
    { url: z.string().min(1).describe("URL to open") },
    async ({ url }) => textResult(await handlers.navigate(url)),
  );

  server.tool(
    "snapshot",
    "Capture interactive elements with refs. Always re-snapshot after navigation or DOM changes. Refs expire after nav.",
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
    "P0: Run JavaScript in the page and return a JSON-serializable result. Use for CKEditor, React internals, modal probing. Example: document.querySelectorAll('iframe').length",
    {
      script: z
        .string()
        .min(1)
        .describe("JS expression or statements; return value is JSON-cloned back"),
    },
    async ({ script }) => textResult(await handlers.execute(script)),
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
    "P0: Trusted click by visible text. Set withinPortal=true for Ant Design / Element portal menu items.",
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
    "List currently visible Portal dropdowns/menus and their item texts.",
    {},
    async () => textResult(await handlers.list_portals()),
  );

  server.tool(
    "start_recording",
    "Start recording human DOM click/fill/change into a skill trace. Can also be started via chat: 开始录制",
    {
      platform: z.string().optional(),
      task: z.string().optional(),
    },
    async ({ platform, task }) =>
      textResult(await handlers.start_recording({ platform, task })),
  );

  server.tool(
    "stop_recording",
    "Stop recording, save trace, and create a named 妙招 (skill). Optional title becomes the skill name.",
    { title: z.string().optional() },
    async ({ title }) => textResult(await handlers.stop_recording(title)),
  );

  server.tool(
    "list_skills",
    "List saved 妙招 (skills) distilled from recordings.",
    {},
    async () => textResult(await handlers.list_skills()),
  );

  server.tool(
    "new_tab",
    "Open a new browser tab (optional URL). Tools always act on the active tab.",
    { url: z.string().optional() },
    async ({ url }) => textResult(await handlers.new_tab(url)),
  );

  server.tool(
    "close_tab",
    "Close a tab by id (cannot close the last tab).",
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
    },
    async ({ selector, text, ref, timeoutMs }) =>
      textResult(await handlers.wait_for({ selector, text, ref, timeoutMs })),
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

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${DEFAULT_PORT}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          name: "sparo",
          product: "Sparo Agent Browser",
          tagline: "The browser built for AI agents — humans stay in control.",
          endpoint: "/mcp",
          agent: {
            read: "AGENTS.md",
            open_example: "npm run open -- https://weibo.com",
            auth: "%APPDATA%/sparo/mcp-auth.json",
          },
        }),
      );
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404).end("Not found");
      return;
    }

    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${token}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
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
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
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
