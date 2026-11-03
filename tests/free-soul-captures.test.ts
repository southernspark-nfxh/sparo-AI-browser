import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FreeSoul } from "../src/main/agent/free-soul.js";
import {
  CAPTURE_IMAGE_MAX_BYTES,
  CAPTURE_LIBRARY_MAX_BYTES,
  CAPTURE_PROMPT,
  fetchImagePageScript,
  listCaptures,
  saveImageBytes,
  saveShotBytes,
} from "../src/main/captures.js";

const STEP_CONFIRM =
  "发布、发送、支付、删除等不可逆动作：先用 request_confirm 向用户确认，得到用户明确同意后才执行。用户此前下过的命令不算同意，必须经过一次确认往返。客服回复只把草稿填进输入框，发送仍由用户在页面上点。";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sparo-captures-"));
  dirs.push(dir);
  return dir;
}

function config(fetchImpl: typeof fetch) {
  return {
    apiKey: "test",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetchImpl,
  };
}

function toolCall(id: string, name: string, args: Record<string, unknown> = {}) {
  return {
    id,
    type: "function" as const,
    function: { name, arguments: JSON.stringify(args) },
  };
}

function scripted(messages: Array<Record<string, unknown>>, sent: Array<Record<string, unknown>>) {
  let index = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    sent.push(JSON.parse(String(init?.body || "{}")));
    const message = messages[Math.min(index, messages.length - 1)];
    index += 1;
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return fetchImpl;
}

async function systemOf(execMode?: "step" | "auto"): Promise<string> {
  const sent: Array<{ messages?: Array<{ content?: string }> }> = [];
  const agent = new FreeSoul(
    config(scripted([{ content: "好的。" }], sent)),
    async () => ({ ok: true, message: "不会执行" }),
  );
  await agent.run({
    input: "看一下",
    url: "https://example.com",
    title: "例",
    locale: "zh",
    ...(execMode ? { execMode } : {}),
  });
  return String(sent[0]?.messages?.[0]?.content || "");
}

describe("素材库", () => {
  it("截图和网页图片落盘，清单有对应记录", () => {
    const dir = tmpDir();
    const shot = saveShotBytes({
      configDir: dir,
      label: "整页",
      bytes: Buffer.from("png-bytes"),
      ext: "png",
      url: "https://example.com/a",
      title: "例",
    });
    expect(shot.ok).toBe(true);
    if (!shot.ok) return;
    expect(existsSync(shot.file)).toBe(true);
    expect(shot.file.endsWith(".png")).toBe(true);
    expect(shot.file.includes(`${dir}`)).toBe(true);
    expect(shot.file.includes("captures")).toBe(true);

    const image = saveImageBytes({
      configDir: dir,
      contentType: "image/jpeg; charset=binary",
      bytes: Buffer.from("jpg-bytes"),
      label: "配图",
      src: "https://example.com/a.jpg",
      url: "https://example.com/a",
      title: "例",
    });
    expect(image.ok).toBe(true);
    if (!image.ok) return;
    expect(existsSync(image.file)).toBe(true);

    const index = JSON.parse(readFileSync(join(dir, "captures", "index.json"), "utf8")) as Array<{
      file: string;
      kind: string;
      src?: string;
      url: string;
      title: string;
      time: string;
    }>;
    expect(index.map((item) => item.kind)).toEqual(["shot", "image"]);
    expect(index[0]?.file).toBe(shot.file);
    expect(index[1]?.src).toBe("https://example.com/a.jpg");
    expect(index[1]?.url).toBe("https://example.com/a");
    expect(index[1]?.time).toBeTruthy();
  });

  it("Content-Type 不是图片时拒绝且不落盘", () => {
    const dir = tmpDir();
    const saved = saveImageBytes({
      configDir: dir,
      contentType: "text/html",
      bytes: Buffer.from("<html>"),
      url: "https://example.com",
      title: "例",
    });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.message).toContain("不是图片");
    expect(existsSync(join(dir, "captures"))).toBe(false);
  });

  it("单张超过 10MB 拒绝且不落盘", () => {
    expect(CAPTURE_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
    const dir = tmpDir();
    const saved = saveImageBytes({
      configDir: dir,
      contentType: "image/png",
      bytes: Buffer.alloc(CAPTURE_IMAGE_MAX_BYTES + 1),
      url: "https://example.com",
      title: "例",
    });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.message).toContain("10MB");
    expect(existsSync(join(dir, "captures"))).toBe(false);
  });

  it("库容超过 500MB 时报满且不自动删", () => {
    expect(CAPTURE_LIBRARY_MAX_BYTES).toBe(500 * 1024 * 1024);
    const dir = tmpDir();
    const captures = join(dir, "captures");
    mkdirSync(captures, { recursive: true });
    const kept = join(captures, "kept.png");
    writeFileSync(kept, Buffer.alloc(40));
    const saved = saveShotBytes({
      configDir: dir,
      bytes: Buffer.from("next"),
      ext: "png",
      url: "https://example.com",
      title: "例",
      libraryCapBytes: 30,
    });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.message).toContain("500MB");
    expect(saved.message).toContain("不会自动删除");
    expect(existsSync(kept)).toBe(true);
    expect(readdirSync(captures).filter((name) => name !== "index.json")).toEqual(["kept.png"]);
  });

  it("单次任务两工具合计超过 20 张时报满，不再调用保存", async () => {
    const calls: string[] = [];
    const sent: Array<{ messages?: Array<{ role?: string; content?: string }> }> = [];
    const callsInOneRound = Array.from({ length: 21 }, (_, index) =>
      toolCall(`c${index}`, index % 2 === 0 ? "save_shot" : "save_image", { label: "n" }),
    );
    const agent = new FreeSoul(
      config(scripted([
        { content: null, tool_calls: callsInOneRound },
        { content: "停了。" },
      ], sent)),
      async (name) => {
        calls.push(name);
        return { ok: true, message: "已存", data: { file: `f-${calls.length}`, url: "https://example.com", title: "例" } };
      },
    );
    const result = await agent.run({
      input: "存下来",
      url: "https://example.com",
      title: "例",
      locale: "zh",
    });
    expect(calls).toHaveLength(20);
    expect(result).toEqual({ ok: true, text: "停了。" });
    const tools = (sent[1]?.messages || []).filter((item) => item.role === "tool");
    expect(tools).toHaveLength(21);
    expect(String(tools[20]?.content || "")).toContain("20");
    expect(String(tools[20]?.content || "")).toContain("不会自动删除");
    expect(String(tools[19]?.content || "")).not.toContain("不会自动删除");
  });

  it("空库 list_captures 返回空数组", async () => {
    const dir = tmpDir();
    expect(listCaptures(dir)).toEqual([]);
    const seen: string[] = [];
    const agent = new FreeSoul(
      config(scripted([
        { content: null, tool_calls: [toolCall("c1", "list_captures")] },
        { content: "没有素材。" },
      ], [])),
      async (name) => {
        seen.push(name);
        return { ok: true, message: "素材库是空的。", data: { items: listCaptures(dir) } };
      },
    );
    const result = await agent.run({
      input: "有哪些素材",
      url: "https://example.com",
      title: "例",
      locale: "zh",
    });
    expect(seen).toEqual(["list_captures"]);
    expect(result).toEqual({ ok: true, text: "没有素材。" });
  });

  it("step 和 auto 的系统提示都要求存本机素材，存量确认句还在", async () => {
    const step = await systemOf("step");
    const omitted = await systemOf();
    const auto = await systemOf("auto");
    expect(step).toBe(omitted);
    expect(step).toContain(CAPTURE_PROMPT);
    expect(auto).toContain(CAPTURE_PROMPT);
    expect(step).toContain(STEP_CONFIRM);
    expect(auto).not.toContain(STEP_CONFIRM);
    expect(auto).toContain("直接执行");
    expect(step).toContain("全量授权");
    expect(auto).toContain("全量授权");
  });

  it("页面取图脚本带上 cookie，不把凭据写进素材", () => {
    const script = fetchImagePageScript();
    expect(script).toContain('credentials: "include"');
    expect(script).not.toContain("document.cookie");
    expect(script).not.toContain("localStorage");
  });
});
