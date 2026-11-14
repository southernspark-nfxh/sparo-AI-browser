import { afterAll, describe, expect, it } from "vitest";

process.env.SPARO_MCP_PORT = "0";

const { startMcpServer } = await import("../src/main/mcp-server.js");

const server = await startMcpServer({} as never);
const base = `http://127.0.0.1:${server.port}`;

afterAll(async () => {
  await server.close();
});

async function post(body: string, token = server.token): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body,
  });
  return { status: res.status, text: await res.text() };
}

describe("MCP 坏帧", () => {
  it("畸形 JSON 回 400，不炸主进程", async () => {
    const res = await post('{"jsonrpc":"2.0","method":"tools/call","params":}}');
    expect(res.status).toBe(400);
    // 服务端还活着：健康检查照常 200
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
  });

  it("合法 JSON 不受影响，没带 token 照旧 401", async () => {
    const res = await post('{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}', "wrong-token");
    expect(res.status).toBe(401);
  });
});
