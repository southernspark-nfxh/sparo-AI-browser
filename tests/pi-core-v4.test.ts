import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiAgentCore } from "../src/main/agent/pi-core.js";
import { gateClickText } from "../src/main/agent/publish-gate.js";
import { inspectUploadPath } from "../src/main/agent/set-file.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function config(fetchImpl: typeof fetch, requestTimeoutMs?: number) {
  return {
    apiKey: "test",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetchImpl,
    requestTimeoutMs,
  };
}

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    content: null,
    tool_calls: [
      {
        id,
        type: "function" as const,
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}

function abortOnSignal(init: RequestInit | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (init?.signal?.aborted) fail();
    else init?.signal?.addEventListener("abort", fail, { once: true });
  });
}

describe("模型请求超时", () => {
  it("第一次挂起、第二次正常返回时，任务照常完成", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls += 1;
      if (calls === 1) return abortOnSignal(init);
      return new Response(JSON.stringify({ choices: [{ message: { content: "好的。" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const agent = new PiAgentCore(config(fetchImpl, 30), async () => ({ ok: true, message: "不会执行" }));
    const result = await agent.run({ input: "看一下", url: "https://example.com", title: "例", locale: "zh" });
    expect(calls).toBe(2);
    expect(result).toEqual({ ok: true, text: "好的。" });
  });

  it("两次都挂起时如实失败，不把过程说成完成", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls += 1;
      return abortOnSignal(init);
    };
    const agent = new PiAgentCore(config(fetchImpl, 30), async () => ({ ok: true, message: "不会执行" }));
    const result = await agent.run({ input: "看一下", url: "https://example.com", title: "例", locale: "zh" });
    expect(calls).toBe(2);
    expect(result.ok).toBe(false);
    expect(result.text).toContain("模型请求超时/失败");
    expect(result.text).toContain("请求超时");
    expect(result.text).toContain("可重试");
    expect(result.text).not.toContain("已完成");
  });
});

describe("click_text 对新核心放行发送", () => {
  it("运行中放行发送，支付仍拦，旧路径仍拦发送", () => {
    expect(gateClickText(true, "发送", false)).toEqual({ ok: true });
    expect(gateClickText(true, "支付", false).ok).toBe(false);
    expect(gateClickText(true, "登录", false).ok).toBe(false);
    const blocked = gateClickText(false, "发送", false);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain("草稿已填好");
  });
});

describe("set_file", () => {
  it("模型调用时走 set_file 分支，参数带路径、ref 和 selector", async () => {
    const seen: Array<{ name: string; args: Record<string, unknown> }> = [];
    let tools: Array<{ function?: { name?: string; parameters?: { required?: string[]; properties?: object } } }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as { tools?: typeof tools };
      tools = body.tools || [];
      const message = seen.length
        ? { content: "文件已放进选择框。" }
        : toolCall("f1", "set_file", { path: "D:\\download\\clip.mp4", ref: "e3", selector: "input[type=file]" });
      return new Response(JSON.stringify({ choices: [{ message }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const agent = new PiAgentCore(config(fetchImpl), async (name, args) => {
      seen.push({ name, args });
      return { ok: true, message: "已放入", data: { path: args.path, sizeMB: 1.2 } };
    });
    const result = await agent.run({ input: "把视频放进投稿框", url: "https://member.bilibili.com", title: "投稿", locale: "zh" });
    expect(seen).toEqual([
      {
        name: "set_file",
        args: { path: "D:\\download\\clip.mp4", ref: "e3", selector: "input[type=file]" },
      },
    ]);
    const spec = tools.find((item) => item.function?.name === "set_file");
    expect(spec?.function?.parameters?.required).toEqual(["path"]);
    expect(spec?.function?.parameters?.properties).toMatchObject({
      path: { type: "string" },
      ref: { type: "string" },
      selector: { type: "string" },
    });
    expect(result).toEqual({ ok: true, text: "文件已放进选择框。" });
  });

  it("文件不存在时如实失败，存在时只回报路径和大小", () => {
    expect(inspectUploadPath("")).toEqual({ ok: false, message: "set_file 需要本地文件路径" });
    expect(inspectUploadPath("D:\\no-such-sparo-file.mp4")).toEqual({
      ok: false,
      message: "文件不存在：D:\\no-such-sparo-file.mp4",
    });
    const dir = mkdtempSync(join(tmpdir(), "sparo-set-file-"));
    dirs.push(dir);
    const file = join(dir, "clip.mp4");
    writeFileSync(file, Buffer.alloc(200 * 1024));
    const found = inspectUploadPath(file);
    expect(found).toEqual({ ok: true, path: file, sizeMB: 0.2 });
  });
});
