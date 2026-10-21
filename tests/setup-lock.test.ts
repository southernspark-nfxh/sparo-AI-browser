import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");

describe("首次设置锁层必须能点", () => {
  it("锁屏只留引导，邮箱和密钥只在设置里", () => {
    for (const id of ["composerLock", "lockHome", "lockLogin", "cloudEmail", "cloudCode", "dsKey"]) {
      expect(html, `缺少 #${id}`).toContain(`id="${id}"`);
    }
    for (const id of ["lockKey", "lockCloud", "lockEmail", "lockByok", "lockKeyInput"]) {
      expect(html, `不该再有 #${id}`).not.toContain(`id="${id}"`);
    }
  });

  it("锁层不是盖在输入框上的绝对定位遮罩", () => {
    const css = html.slice(html.indexOf(".composer-lock {"), html.indexOf(".composer-lock p"));
    expect(css).toMatch(/position:\s*relative/);
    expect(css).not.toMatch(/inset:\s*0/);
    expect(html).toContain(".composer.is-locked textarea");
  });

  it("点击走 document 委托，不依赖 bindShell 后半段", () => {
    expect(html).toContain('btn.id === "lockLogin"');
    expect(html).toContain('btn.id === "welcomeKeyBtn"');
    expect(html).toContain("window.__sparoOpenSettings");
    expect(html).not.toContain("lockSendCode");
    expect(html).not.toContain("showLockPanel");
  });

  it("sidebarDsCloud 在模块顶层，goSetup 不会 ReferenceError", () => {
    const top = html.indexOf("let lastSidebar = null;");
    const go = html.indexOf("function goSetup(kind)");
    const bind = html.indexOf("function bindShell()");
    const def = html.indexOf("function sidebarDsCloud()");
    expect(def).toBeGreaterThan(-1);
    expect(def).toBeLessThan(go);
    expect(go).toBeLessThan(bind);
    expect(top).toBeLessThan(def);
  });

  it("登录和密钥表单只留设置一处，欢迎卡和账号浮层不再各做一套", () => {
    expect(html).not.toContain('id="welcomeEmail"');
    expect(html).not.toContain('id="welcomeProvider"');
    expect(html).not.toContain('id="welcomeKeyInput"');
    expect(html).not.toContain('id="userEmail"');
    expect(html).toContain('id="userGoLogin"');
    expect(html).toContain('id="cloudEmail"');
    expect(html).toContain('id="dsKey"');
  });

  it("设置里不再露出和自己的模型重叠的网关下拉", () => {
    expect(html).not.toContain('id="dsGateway"');
    expect(html).not.toContain("fillGatewaySelect");
    expect(html).toContain("function toggleCustomBaseRow");
  });

  it("点侧栏输入时把键盘从网页层拉回来", () => {
    expect(html).toContain("grabShellFocus");
    expect(html).toContain("focusShell");
  });

  it("连接 Agent 在高级分区里直接可见，不藏进自检折叠", () => {
    const block = html.indexOf('id="agentConnectBlock"');
    const copy = html.indexOf('id="btnCopyAgent"');
    const qaFold = html.indexOf("<summary>自检</summary>");
    const advanced = html.indexOf('data-panel="advanced"');
    expect(block).toBeGreaterThan(advanced);
    expect(copy).toBeGreaterThan(block);
    expect(qaFold).toBeGreaterThan(copy);
    expect(html).toContain('class="ghost js-copy-agent"');
    expect(html).not.toContain('id="mcpPort"');
    expect(html).not.toContain('id="mcpToken"');
  });

  it("没接到主进程时服务商列表也是完整的", () => {
    expect(html).toContain("const FALLBACK_PRESETS");
    for (const id of ["moonshot", "dashscope", "anthropic", "gemini", "openrouter", "ollama"]) {
      expect(html, `FALLBACK_PRESETS 缺少 ${id}`).toContain(`${id}:`);
    }
    expect(html).toContain("live.moonshot && live.dashscope ? live : FALLBACK_PRESETS");
  });
});
