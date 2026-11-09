import type http from "node:http";

type Bucket = {
  tokens: number;
  lastRefillMs: number;
};

const rateBuckets = new Map<string, Bucket>();

/**
 * Optional token TTL helper for callers that own mcp-auth.json (e.g. index.ts).
 * When SPARO_MCP_TOKEN_TTL > 0 (seconds), regenerate the bearer token if
 * `Date.now() - createdAt >= ttlSec * 1000` and rewrite mcp-auth.json.
 */
export function shouldRotateToken(createdAt: number, ttlSec: number): boolean {
  if (!(ttlSec > 0) || !Number.isFinite(ttlSec)) return false;
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt >= ttlSec * 1000;
}

export function applyCors(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const origin = process.env.SPARO_CORS_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");

  if ((req.method || "").toUpperCase() === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

/**
 * Token-bucket rate limit (~SPARO_MCP_RATE_LIMIT req/s, default 10) keyed by token.
 */
export function checkRateLimit(token: string): { ok: boolean; retryAfterMs?: number } {
  const rate = Math.max(1, Number(process.env.SPARO_MCP_RATE_LIMIT || 10) || 10);
  const now = Date.now();
  let bucket = rateBuckets.get(token);
  if (!bucket) {
    bucket = { tokens: rate, lastRefillMs: now };
    rateBuckets.set(token, bucket);
  }

  const elapsedSec = (now - bucket.lastRefillMs) / 1000;
  bucket.tokens = Math.min(rate, bucket.tokens + elapsedSec * rate);
  bucket.lastRefillMs = now;

  if (bucket.tokens < 1) {
    const need = 1 - bucket.tokens;
    const retryAfterMs = Math.max(1, Math.ceil((need / rate) * 1000));
    return { ok: false, retryAfterMs };
  }

  bucket.tokens -= 1;
  return { ok: true };
}

export function logMcpRequest(info: {
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  clientIp?: string;
  toolHint?: string;
}): void {
  const line = `[sparo-mcp] ${new Date().toISOString()} ${info.method} ${info.path} ${info.status} ${info.latencyMs}`;
  console.log(line);
}

export function jsonError(
  res: http.ServerResponse,
  status: number,
  error: string,
  mcp_error_code?: string,
): void {
  const body: { error: string; mcp_error_code?: string } = { error };
  if (mcp_error_code !== undefined) {
    body.mcp_error_code = mcp_error_code;
  }
  if (!res.headersSent) {
    res.writeHead(status, { "Content-Type": "application/json" });
  }
  res.end(JSON.stringify(body));
}

/** 限流回执必须是带正文的 JSON-RPC error。空 body 会让调用方以为提交成功了。 */
export function writeRateLimitResponse(res: http.ServerResponse, retryAfterMs?: number): void {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32029,
      message: "Too Many Requests",
      data: "rate_limited",
    },
  });
  const headers: Record<string, string | number> = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  };
  if (retryAfterMs !== undefined) {
    headers["Retry-After"] = String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
  }
  if (!res.headersSent) res.writeHead(429, headers);
  res.end(body);
}
