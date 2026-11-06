/**
 * T72：连续提交 5 个任务，看壳层渲染进程会不会 crashed。
 * 默认打 3922，避免撞上正在用的 3921。
 *
 *   $env:SPARO_CONFIG_DIR = "$env:TEMP\sparo-t72"
 *   $env:SPARO_MCP_PORT = "3922"
 *   $env:SPARO_MCP_TOKEN = "t72-repro"
 *   npm run start
 *   node scripts/repro-shell-gone.mjs
 */
const port = Number(process.env.SPARO_MCP_PORT || 3922);
const token = process.env.SPARO_MCP_TOKEN || "";
const rounds = Number(process.env.SPARO_REPRO_ROUNDS || 5);
const timeoutMs = Number(process.env.SPARO_REPRO_TIMEOUT_MS || 90_000);
const text = process.env.SPARO_REPRO_TEXT || "打开百度首页，用一句话说出页面标题";
if (port === 3921 && process.env.SPARO_REPRO_ALLOW_LIVE !== "1") {
  console.error("拒绝打 3921。要打正在用的实例请设 SPARO_REPRO_ALLOW_LIVE=1");
  process.exit(2);
}
if (!token) {
  console.error("缺少 SPARO_MCP_TOKEN");
  process.exit(2);
}

const endpoint = `http://127.0.0.1:${port}/mcp`;
let clientId = "";
let rpcId = 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpc(method, params) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(clientId ? { "x-sparo-client": clientId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
  });
  const next = res.headers.get("x-sparo-client");
  if (next) clientId = next;
  const body = await res.text();
  if (!res.ok) throw new Error(`${method} HTTP ${res.status} ${body.slice(0, 300)}`);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`${method} 不是 JSON：${body.slice(0, 300)}`);
  }
  const content = parsed?.result?.content;
  const raw = Array.isArray(content) ? content.map((item) => item?.text || "").join("\n") : body;
  let data = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    /* 文本结果 */
  }
  return data;
}

function taskIdOf(data) {
  if (data && typeof data === "object" && data.taskId) return String(data.taskId);
  const match = String(data).match(/"taskId"\s*:\s*"([^"]+)"/);
  return match ? match[1] : "";
}

const started = new Date().toISOString();
console.log(`[repro] start ${started} port=${port} rounds=${rounds}`);
await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "t72-repro", version: "1" },
});
await rpc("notifications/initialized", {});

const report = [];
for (let i = 1; i <= rounds; i += 1) {
  const t0 = Date.now();
  let status = "submit-failed";
  let taskId = "";
  try {
    const submitted = await rpc("tools/call", {
      name: "submit_task",
      arguments: { text, execMode: "auto" },
    });
    taskId = taskIdOf(submitted);
    status = submitted?.status || "submitted";
    while (taskId && Date.now() - t0 < timeoutMs) {
      await sleep(2000);
      const got = await rpc("tools/call", {
        name: "get_task",
        arguments: { taskId },
      });
      status = got?.status || status;
      if (status === "done" || status === "failed" || status === "unknown") break;
    }
    if (taskId && status !== "done" && status !== "failed" && status !== "unknown") status = "timeout";
  } catch (error) {
    status = `error:${error instanceof Error ? error.message : String(error)}`;
  }
  const row = { round: i, taskId, status, ms: Date.now() - t0 };
  report.push(row);
  console.log(`[repro] ${JSON.stringify(row)}`);
}

console.log(`[repro] done ${JSON.stringify(report)}`);
