import http from "node:http";

const TOKEN = "f7a01880c8c517c3daec4768fa77dcc2385bc458809608a9";
const ENDPOINT = "http://127.0.0.1:3920/mcp";

function mcpRequest(method, params, id = 1) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const req = http.request(
      ENDPOINT,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + TOKEN,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            resolve(raw);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log("=== Initialize ===");
  const initResult = await mcpRequest("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "sparo-cli", version: "0.1.0" },
  });
  console.log(JSON.stringify(initResult, null, 2));

  console.log("=== Navigate to Weibo ===");
  const navResult = await mcpRequest("tools/call", {
    name: "navigate",
    arguments: { url: "https://weibo.com" },
  }, 2);
  console.log(JSON.stringify(navResult, null, 2));
}

main().catch(console.error);
