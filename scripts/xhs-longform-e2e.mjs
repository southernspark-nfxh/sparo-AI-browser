#!/usr/bin/env node
/**
 * End-to-end: Xiaohongshu long-article compose via Sparo MCP.
 * UTF-8 only — do not invoke via PowerShell string literals for Chinese.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

const TITLE = "Sparo浏览器——AI终于有了自己的手。";
const BODY = `先说一个你可能没意识到的问题：

2026年了，AI能写代码、能做PPT、能分析数据，但它始终缺一样东西——**一双能操作网页的手。**

你让 AI 帮你登录后台、填表单、发帖子、查数据……它要么告诉你"我做不到"，要么让你装一堆爬虫脚本，改一行就崩。

### 现在市面上的浏览器，AI都用不了

你可能会说，不是有很多AI浏览器插件吗？

但你仔细看，无非两类：

一种是在浏览器上插个AI对话框——它能陪你聊天、帮你总结网页，但**它动不了网页**。你让它帮你填个表，它说"我做不到"。本质上是插件，不是手。

另一种是让AI模拟人类——移动鼠标、点击按钮、滚屏……看起来很酷，但你用一下就知道了：慢、不稳定、动不动就找不到元素。而且你得在旁边等着，因为它随时会翻车。

这两种方式的根本问题是一样的：**AI没有真正拥有一台浏览器。** 它要么被关在对话框里，要么像个笨拙的机器人假装自己是人类。

### Sparo 是怎么解决的

Sparo 不做插件，也不模拟人类。

它是**人和 AI 共同使用的一个浏览器**。

同一个窗口、同一个登录态、同一套 Cookie。AI 在上面操作网页的时候，你能实时看到它在干什么。你觉得不对，一键暂停——鼠标立刻回到你手上。你审核通过，AI 继续。

和前面说的两种方案，区别在哪：

| | AI插件 | 模拟人类 | **Sparo** |
|---|---|---|---|
| AI能动网页吗 | ❌ 不能 | ⚠️ 笨拙 | ✅ 直接操控 |
| 需要你在旁边吗 | — | ⚠️ 怕翻车 | ✅ 放心走开 |
| 人能看到AI在干嘛吗 | — | ❌ 看不到 | ✅ 同窗可见 |
| 技能能积累复用吗 | ❌ | ❌ | ✅ 操作一次记住 |

### 实际用起来有多爽

🔥 让 Sparo 登录店铺后台，填写商品信息——20分钟的事1分钟搞定
🔥 让它在微博自动发帖、回评论——你看一眼点确认就行
🔥 让它批量查数据、填表格——它自己打开网页、复制、粘贴，你全程看戏

而且 Sparo 支持**技能积累**：你手动操作一遍，它就记住。下次一句话触发。你教它越多，它越强。这才是真正属于你的 AI 手。

解放人手。让 AI 真正拥有一台浏览器。

开源地址：github.com/southernspark-nfxh/sparo-agent-browser

*这篇文章从写作到发布，全程由 AI Agent Hermes（方沫）操作 Sparo 浏览器完成。*

#Sparo浏览器 #AI工具 #效率神器 #开源 #浏览器推荐 #人工智能`;

const PUBLISH_URL =
  "https://creator.xiaohongshu.com/publish/publish?target=article";

const log = [];
function step(name, data) {
  const entry = { t: new Date().toISOString(), name, data };
  log.push(entry);
  const brief =
    typeof data === "string"
      ? data.slice(0, 300)
      : JSON.stringify(data, null, 0).slice(0, 500);
  console.log(`\n=== ${name} ===\n${brief}`);
}

function unwrap(r) {
  // mcpCall returns parsed tool result already in helpers — check shape
  if (r && r.content && r.content[0]?.text) {
    try {
      return JSON.parse(r.content[0].text);
    } catch {
      return r;
    }
  }
  return r;
}

async function main() {
  const auth = loadAuth();
  await initialize(auth);

  // 1) Navigate
  let r = unwrap(await mcpCall(auth, "navigate", { url: PUBLISH_URL }));
  step("navigate", r);
  await sleep(4000);

  r = unwrap(await mcpCall(auth, "get_url", {}));
  step("get_url", r);
  const url = r?.data?.url || r?.message || "";
  if (/login|passport|account/i.test(url)) {
    step("BLOCKED", "Need human login on Xiaohongshu creator. Pausing.");
    await mcpCall(auth, "pause", {});
    saveLog("need-login");
    process.exit(2);
  }

  // 2) Snapshot shell
  r = unwrap(await mcpCall(auth, "snapshot", {}));
  step("snapshot#1", {
    ok: r?.ok,
    message: r?.message,
    count: r?.data?.elements?.length,
    names: (r?.data?.elements || []).slice(0, 25).map((e) => ({
      ref: e.ref,
      name: e.name,
      role: e.role,
    })),
  });

  // 3) Try open 写长文 / 新的创作
  for (const text of ["写长文", "新的创作", "发布", "写文章"]) {
    const click = unwrap(
      await mcpCall(auth, "click_text", { text, exact: false }),
    );
    step(`click_text:${text}`, click);
    if (click?.ok) {
      await sleep(1500);
      break;
    }
  }

  await sleep(2000);
  r = unwrap(await mcpCall(auth, "snapshot", {}));
  step("snapshot#2", {
    ok: r?.ok,
    message: r?.message,
    count: r?.data?.elements?.length,
    frames: r?.data?.iframeCount,
    sample: (r?.data?.elements || []).slice(0, 40).map((e) => ({
      ref: e.ref,
      name: (e.name || "").slice(0, 40),
      role: e.role,
      frame: e.frame,
    })),
  });

  // 4) Find title / body fields
  const els = r?.data?.elements || [];
  const titleEl =
    els.find(
      (e) =>
        /标题|title/i.test(e.name || "") ||
        /标题|title/i.test(e.placeholder || "") ||
        (e.role === "textbox" && /title/i.test(e.selector || "")),
    ) ||
    els.find((e) => e.role === "textbox" && !String(e.ref).startsWith("x"));

  const bodyEl =
    els.find(
      (e) =>
        e.ref?.startsWith("x") &&
        (e.role === "textbox" || e.tag === "textarea" || /edit|content|body/i.test(e.name || "")),
    ) ||
    els.find((e) => e.role === "textbox" && e.ref !== titleEl?.ref) ||
    els.find((e) => /contenteditable|editor|正文/i.test(e.name + e.selector));

  step("pick-fields", { titleEl, bodyEl });

  // 5) Fill title
  if (titleEl?.ref) {
    r = unwrap(
      await mcpCall(auth, "fill", { ref: titleEl.ref, value: TITLE }),
    );
    step("fill:title", r);
  } else {
    // try click_text then fill via execute
    step("fill:title", "NO title ref — trying execute fallback");
  }

  // 6) Fill body — prefer CDP frame
  if (bodyEl?.ref) {
    r = unwrap(await mcpCall(auth, "fill", { ref: bodyEl.ref, value: BODY }));
    step("fill:body", {
      ok: r?.ok,
      message: r?.message,
      matched: r?.data?.matched,
      actualHead: String(r?.data?.actual || "").slice(0, 80),
      method: r?.data?.method,
    });
  } else {
    // list CDP frames and try execute insert
    step("fill:body", "NO body ref");
    const framesProbe = unwrap(
      await mcpCall(auth, "execute", {
        script: `(() => ({ iframes: [...document.querySelectorAll('iframe')].map((f,i)=>({i,src:f.src,w:f.getBoundingClientRect().width})) }))()`,
      }),
    );
    step("iframe-probe", framesProbe);
  }

  // 7) Verify via snapshot / page_text
  await sleep(1000);
  r = unwrap(await mcpCall(auth, "page_text", {}));
  const text = r?.data?.text || "";
  step("page_text_check", {
    len: text.length,
    hasTitle: text.includes("Sparo") || text.includes("自己的手"),
    hasBody: text.includes("一双能操作网页的手") || text.includes("人机"),
    head: text.slice(0, 200),
    mojibake: /ä½|Ã/.test(text),
  });

  // 8) Look for publish button — do NOT auto-click without confirmation flag
  const snap3 = unwrap(await mcpCall(auth, "snapshot", {}));
  const pub = (snap3?.data?.elements || []).filter((e) =>
    /发布|存草稿|预览/.test(e.name || ""),
  );
  step("publish-candidates", pub.map((e) => ({ ref: e.ref, name: e.name })));

  const autoPublish = process.env.SPARO_XHS_PUBLISH === "1";
  if (autoPublish && pub.length) {
    const btn = pub.find((e) => e.name === "发布" || /发布/.test(e.name));
    if (btn) {
      const approval = unwrap(
        await mcpCall(auth, "request_approval", {
          action: "xhs_publish",
          reason: "Publish Xiaohongshu long article via Sparo E2E",
          risk: "high",
        }),
      );
      step("approval", approval);
      if (approval?.ok || approval?.data?.approved) {
        r = unwrap(await mcpCall(auth, "click", { ref: btn.ref }));
        step("click:publish", r);
      }
    }
  } else {
    step(
      "publish",
      "Skipped auto-publish. Set SPARO_XHS_PUBLISH=1 to enable with approval gate. Human can click 发布 in the shared window.",
    );
    await mcpCall(auth, "pause", {});
  }

  // 9) Save skill recording tip
  step("next", "If content looks correct in window, human clicks 发布; then we save skill.");
  saveLog("compose-done");
}

function saveLog(tag) {
  const dir =
    process.platform === "win32" && process.env.APPDATA
      ? join(process.env.APPDATA, "sparo", "traces")
      : join(homedir(), ".config", "sparo", "traces");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `xhs-longform-${tag}-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(log, null, 2), "utf8");
  console.log(`\nLOG → ${path}`);
}

main().catch((e) => {
  console.error(e);
  saveLog("error");
  process.exit(1);
});
