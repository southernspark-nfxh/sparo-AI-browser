import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { PiAgentCore } from "../src/main/agent/pi-core.js";
import { loadSettings, saveSettings, settingsPublicView } from "../src/main/settings/store.js";
import { tx } from "../src/shared/i18n.js";

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
  const dir = mkdtempSync(join(tmpdir(), "sparo-exec-mode-"));
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
  const agent = new PiAgentCore(
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

describe("执行模式", () => {
  it("非法 execMode 落盘后读回落 step，合法 auto 能暴露", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ execMode: "yolo" }), "utf8");
    expect(loadSettings(dir).execMode).toBe("step");
    expect(settingsPublicView(loadSettings(dir)).execMode).toBe("step");
    const saved = saveSettings(dir, { execMode: "nope" as "step" });
    expect(saved.execMode).toBe("step");
    expect(loadSettings(dir).execMode).toBe("step");
    const auto = saveSettings(dir, { execMode: "auto" });
    expect(auto.execMode).toBe("auto");
    expect(loadSettings(dir).execMode).toBe("auto");
    expect(settingsPublicView(auto).execMode).toBe("auto");
    expect(loadSettings(tmpDir()).execMode).toBe("step");
  });

  it("不传 execMode 与 step 的系统提示逐字相同，且保留确认门原句", async () => {
    const omitted = await systemOf();
    const step = await systemOf("step");
    expect(step).toBe(omitted);
    expect(step).toContain(STEP_CONFIRM);
    expect(step).toContain("全量授权");
    expect(step).not.toContain("当前是自动执行模式");
    expect(step).not.toContain("直接执行");
  });

  it("auto 系统提示改发布发送为直接执行，支付删除仍必须确认", async () => {
    const auto = await systemOf("auto");
    expect(auto).toContain("直接执行");
    expect(auto).toContain("支付、删除仍必须");
    expect(auto).toContain("一口气执行到任务完成");
    expect(auto).toContain("先展示第一页结果");
    expect(auto).toContain("出发地");
    expect(auto).not.toContain(STEP_CONFIRM);
    expect(auto).toContain("全量授权");
    expect(auto).toContain("客服回复只把草稿填进输入框");
    expect(auto).toContain("验证码");
  });

  it("auto 模式下模型仍调用 request_confirm 时本地照常停下，不代答", async () => {
    const seen: string[] = [];
    const agent = new PiAgentCore(
      config(scripted([toolCall("c1", "request_confirm", { action: "删除这封邮件", detail: "不可恢复" })], [])),
      async (name) => {
        seen.push(name);
        return { ok: true, message: "不应执行" };
      },
    );
    const result = await agent.run({
      input: "删掉这封",
      url: "https://mail.google.com",
      title: "Gmail",
      locale: "zh",
      execMode: "auto",
    });
    expect(seen).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.awaitingConfirm).toBe(true);
    expect(result.text).toContain("确认吗");
    expect(result.text).not.toContain("已确认");
  });

  it("侧栏模式文案走中英词条，选择器落盘 execMode", () => {
    expect(tx("zh", "chat.execMode.step")).toBe("逐步确认");
    expect(tx("zh", "chat.execMode.auto")).toBe("自动执行");
    expect(tx("en", "chat.execMode.step")).toBe("Confirm each step");
    expect(tx("en", "chat.execMode.auto")).toBe("Run automatically");
    expect(tx("ja", "chat.execMode.auto")).toBe("Run automatically");
    const html = readFileSync(join("src", "renderer", "shell.html"), "utf8");
    expect(html).toContain('id="execMode"');
    expect(html).toContain('data-i18n="chat.execMode.step"');
    expect(html).toContain('data-i18n="chat.execMode.auto"');
    expect(html).toContain("saveSettings({ execMode");
  });
});
