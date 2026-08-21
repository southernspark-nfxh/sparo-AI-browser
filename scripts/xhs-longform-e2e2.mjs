#!/usr/bin/env node
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

解放人手。让 AI 真正拥有一台浏览器。

开源地址：github.com/southernspark-nfxh/sparo-agent-browser

*这篇文章从写作到发布，全程由 AI Agent 操作 Sparo 浏览器完成。*

#Sparo浏览器 #AI工具 #效率神器 #开源 #浏览器推荐 #人工智能`;

function p(label, r) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(r, null, 2).slice(0, 1200));
}

async function main() {
  const auth = loadAuth();
  await initialize(auth);

  // Resume if paused
  await mcpCall(auth, "resume", {}).catch(() => {});

  let r = await mcpCall(auth, "get_url", {});
  p("url", r);

  // Ensure on article tab
  r = await mcpCall(auth, "click_text", { text: "写长文", exact: false });
  p("click 写长文", r);
  await sleep(1000);

  r = await mcpCall(auth, "click_text", { text: "新的创作", exact: false });
  p("click 新的创作", r);
  await sleep(3500);

  r = await mcpCall(auth, "snapshot", {});
  p("snapshot after 新的创作", {
    message: r.message,
    count: r.data?.elements?.length,
    els: (r.data?.elements || []).map((e) => ({
      ref: e.ref,
      name: (e.name || "").slice(0, 50),
      role: e.role,
      tag: e.tag,
      frame: e.frame,
      placeholder: e.placeholder,
    })),
  });

  // Probe DOM for editors
  r = await mcpCall(auth, "execute", {
    script: `(() => {
      const inputs = [...document.querySelectorAll('input,textarea,[contenteditable],iframe')].map(el => ({
        tag: el.tagName,
        type: el.type||'',
        ph: el.placeholder||'',
        cls: (el.className||'').toString().slice(0,80),
        ce: el.isContentEditable||el.contentEditable,
        src: el.src||'',
        rect: (()=>{const r=el.getBoundingClientRect(); return {w:r.width,h:r.height,x:r.x,y:r.y};})()
      }));
      return { href: location.href, inputs };
    })()`,
  });
  p("dom-probe", r);

  // Try CDP frame 0 collect via execute
  r = await mcpCall(auth, "execute", {
    script: `(() => {
      const d = document;
      const textboxes = [...d.querySelectorAll('input,textarea,[contenteditable="true"],[contenteditable=""],[role=textbox]')].map((el,i)=>({
        i, tag: el.tagName, ph: el.placeholder||'', aria: el.getAttribute('aria-label')||'',
        text: (el.innerText||el.value||'').slice(0,40),
        rect: (()=>{const r=el.getBoundingClientRect();return {w:r.width,h:r.height};})()
      }));
      return { title: d.title, href: location.href, textboxes, bodyHead: (d.body&&d.body.innerText||'').slice(0,300) };
    })()`,
    frame: 0,
  });
  p("cdp-frame0", r);

  // If frame has fields, fill via x0 refs from fresh snapshot
  const snap = await mcpCall(auth, "snapshot", {});
  const els = snap.data?.elements || [];
  const xEls = els.filter((e) => String(e.ref).startsWith("x"));
  p("x-refs", xEls.map((e) => ({ ref: e.ref, name: e.name, role: e.role, tag: e.tag })));

  // Heuristic title: placeholder 标题 or first textbox in frame
  let titleRef =
    els.find((e) => /标题/.test(e.placeholder || e.name || ""))?.ref ||
    xEls.find((e) => e.role === "textbox" || e.tag === "input")?.ref;
  let bodyRef =
    xEls.find(
      (e) =>
        e.ref !== titleRef &&
        (e.tag === "textarea" ||
          e.role === "textbox" ||
          /contenteditable|editor|正文/.test((e.name || "") + (e.selector || ""))),
    )?.ref || xEls.find((e) => e.ref !== titleRef)?.ref;

  p("chosen", { titleRef, bodyRef });

  if (titleRef) {
    r = await mcpCall(auth, "fill", { ref: titleRef, value: TITLE });
    p("fill title", {
      ok: r.ok,
      message: r.message,
      matched: r.data?.matched,
      actual: String(r.data?.actual || "").slice(0, 60),
      method: r.data?.method,
    });
  }

  if (bodyRef) {
    r = await mcpCall(auth, "fill", { ref: bodyRef, value: BODY });
    p("fill body", {
      ok: r.ok,
      message: r.message,
      matched: r.data?.matched,
      actualHead: String(r.data?.actual || "").slice(0, 80),
      method: r.data?.method,
    });
  }

  // If still no refs, try fill via frame execute + insertText pattern
  if (!titleRef || !bodyRef) {
    r = await mcpCall(auth, "execute", {
      frame: 0,
      script: `(() => {
        const title = ${JSON.stringify(TITLE)};
        const body = ${JSON.stringify(BODY)};
        // find likely title input
        const candidates = [...document.querySelectorAll('input,textarea,[contenteditable="true"],[contenteditable=""]')];
        const visible = candidates.filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 20 && r.height > 10;
        });
        const info = visible.map((el,i) => ({
          i, tag: el.tagName, ph: el.placeholder||'', h: el.getBoundingClientRect().height,
          aria: el.getAttribute('aria-label')||'', cls: String(el.className||'').slice(0,60)
        }));
        return { count: visible.length, info };
      })()`,
    });
    p("frame fields detail", r);

    // Attempt direct assignment in frame using base64-safe path via Sparo execute
    // (execute already wraps with cdpUtf8Expr)
  }

  await sleep(800);
  const verify = await mcpCall(auth, "page_text", {});
  const t = verify.data?.text || "";
  p("verify page_text", {
    len: t.length,
    hasTitle: t.includes("Sparo") || t.includes("自己的手"),
    hasHand: t.includes("操作网页的手"),
    mojibake: /ä½|Ã/.test(t),
    head: t.slice(0, 400),
  });

  // Snapshot publish buttons
  const snap2 = await mcpCall(auth, "snapshot", {});
  const pubs = (snap2.data?.elements || []).filter((e) =>
    /发布|存草稿|预览|定时/.test(e.name || ""),
  );
  p("publish buttons", pubs.map((e) => ({ ref: e.ref, name: e.name })));

  console.log("\nDONE — check Sparo window. Pause for human publish.");
  await mcpCall(auth, "pause", {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
