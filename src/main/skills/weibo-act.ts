/**
 * 微博当前页评论 / 转发。一次写入、点发送、读回页面。
 * 不导航，不新开标签。文字和做哪一件由调用方决定。
 */
export function weiboActScript(text: string, mode: string, anchor: string): string {
  const payload = JSON.stringify({
    text: String(text || ""),
    mode: mode === "repost" || mode === "both" ? mode : "comment",
    anchor: String(anchor || ""),
  });
  return `(async () => {
    const job = ${payload};
    const text = job.text;
    const mode = job.mode;
    const anchor = job.anchor;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const host = location.hostname.replace(/^www\\./, "").replace(/^m\\./, "");
    if (!/(^|\\.)weibo\\.(com|cn)$/.test(host)) {
      throw new Error("当前不是微博页，没有离开这一页");
    }
    const head = String(document.body && document.body.innerText || "").slice(0, 1200);
    if (/passport\\.weibo|login\\.sina|weibo\\.cn\\/login/.test(location.href) || /登录\\s*-\\s*微博/.test(document.title || "") || /登录(?:\\s|[\\/|｜]){0,12}注册/.test(head)) {
      throw new Error("微博要登录，停在这一页");
    }
    if (!String(text || "").trim()) throw new Error("评论或转发的文字还没给定");
    const visible = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 2 && rect.height > 2 && style.visibility !== "hidden" && style.display !== "none";
    };
    const compact = (value) => String(value || "").replace(/\\s+/g, "");
    const wordHit = (label, words) => words.some((word) => label === word || new RegExp("^" + word + "\\\\d+$").test(label));
    const labelOf = (el) => compact([
      el && el.getAttribute && el.getAttribute("aria-label"),
      el && el.getAttribute && el.getAttribute("title"),
      el && el.innerText,
    ].filter(Boolean).join(""));
    const exact = (root, words) => {
      const scope = root && root.querySelectorAll ? root : document;
      const nodes = scope.querySelectorAll("button, a, span, div");
      for (const el of nodes) {
        if (!visible(el)) continue;
        const own = labelOf(el);
        if (own && own.length <= 8 && wordHit(own, words)) return el;
        const parent = el.parentElement;
        const around = parent ? compact(parent.innerText) : "";
        if (parent && around.length <= 8 && wordHit(around, words) && (!own || /^\\d+$/.test(own))) return parent;
      }
      return null;
    };
    const seenLabels = (root, words) => {
      const scope = root && root.querySelectorAll ? root : document;
      const found = [];
      for (const el of scope.querySelectorAll("button, a, span")) {
        const label = String(el.innerText || "").replace(/\\s+/g, " ").trim();
        if (!label || label.length > 12 || !visible(el)) continue;
        if (!words.some((word) => label.includes(word))) continue;
        if (!found.includes(label)) found.push(label);
        if (found.length >= 8) break;
      }
      return found;
    };
    const cardFor = (needle) => {
      if (!needle) return document;
      let best = null;
      let bestLen = 1e9;
      for (const el of document.querySelectorAll("article, section, div")) {
        const blob = el.innerText || "";
        if (!blob.includes(needle) || blob.length >= bestLen || blob.length > 5000) continue;
        best = el;
        bestLen = blob.length;
      }
      return best || document;
    };
    const write = (el, value) => {
      el.focus();
      if (el.isContentEditable) {
        document.execCommand("selectAll", false, null);
        const ok = document.execCommand("insertText", false, value);
        if (!ok || !String(el.innerText || "").includes(value.slice(0, 6))) {
          el.textContent = value;
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        }
        return String(el.innerText || "").includes(value.slice(0, 6));
      }
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value") && Object.getOwnPropertyDescriptor(proto, "value").set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      return String(el.value || "").includes(value.slice(0, 6));
    };
    const field = (root) => {
      const scope = root && root.querySelectorAll ? root : document;
      for (const el of scope.querySelectorAll("textarea, [contenteditable='true'], [contenteditable='']")) {
        if (visible(el)) return el;
      }
      return null;
    };
    const act = async (kind) => {
      const root = cardFor(anchor);
      const openWord = kind === "repost" ? "转发" : "评论";
      let box = field(root);
      if (!box) {
        const opener = exact(root, [openWord]);
        if (!opener) {
          const labels = seenLabels(root, ["评论", "转发", "回复"]);
          throw new Error("这一页没找到「" + openWord + "」。页面上看到的是：" + (labels.join("、") || "没有这些按钮"));
        }
        opener.click();
        await sleep(600);
        box = field(document);
      }
      if (!box) throw new Error("「" + openWord + "」点开后没有输入框");
      if (!write(box, text)) throw new Error("文字没有一次写进" + openWord + "框");
      await sleep(200);
      const sendWords = kind === "repost" ? ["转发", "发送"] : ["评论", "发送", "回复"];
      const near = box.closest("form, [class*='comment'], [class*='forward'], [class*='publish'], [class*='Composer']") || box.parentElement || document;
      const send = exact(near, sendWords) || exact(document, sendWords);
      if (!send) throw new Error("字已经写入，但没找到发送");
      send.click();
      await sleep(800);
      const needle = text.slice(0, Math.min(12, text.length));
      const region = kind === "repost" ? "[class*='forward'], [class*='Forward'], [class*='repost'], [class*='Repost']" : "[class*='comment'], [class*='Comment'], [class*='reply'], [class*='Reply']";
      const seen = [...document.querySelectorAll(region)].some((el) => {
        if (el.matches && el.matches("textarea, [contenteditable]")) return false;
        if (el.querySelector && el.querySelector("textarea, [contenteditable='true'], [contenteditable='']")) return false;
        return String(el.innerText || "").includes(needle);
      });
      return { kind, wrote: true, clickedSend: true, seenOnPage: seen };
    };
    const results = [];
    if (mode !== "repost") results.push(await act("comment"));
    if (mode === "repost" || mode === "both") results.push(await act("repost"));
    const missing = results.filter((item) => !item.seenOnPage).map((item) => item.kind);
    return {
      ok: missing.length === 0,
      message: missing.length
        ? "已点发送，页面上还没读到：" + missing.join("、")
        : "评论或转发已在页面上读到",
      results,
    };
  })()`;
}
