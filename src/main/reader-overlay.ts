/**
 * 阅读模式页：划线高亮、主题/字号、AI 伴读抽屉、一键盘存。
 * 依赖页面 preload 暴露的 window.SparoAPI。
 */
export const HIGHLIGHT_OVERLAY_SCRIPT = `(() => {
  if (window.__sparoHighlightReady) return;
  if (!document.querySelector('meta[name="sparo-reader"]')) return;
  window.__sparoHighlightReady = true;

  var COLORS = { yellow: "#ffe08a", green: "#b7ebc6", blue: "#b9d6ff", red: "#ffc1c1" };
  var payload = {};
  try {
    var raw = document.getElementById("sparo-reader-payload");
    payload = raw ? JSON.parse(raw.textContent || "{}") : {};
  } catch (e) { payload = {}; }
  var sourceUrl = String(payload.url || "");
  var pageTitle = String(payload.title || document.title || "");
  var siteName = String(payload.siteName || "");
  var companionOn = Boolean(payload.companionOn);
  var pending = null;

  function api() { return window.SparoAPI || null; }
  function toast(text) {
    var el = document.getElementById("readerToast");
    if (!el) return;
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove("show"); }, 2500);
  }
  function bodyEl() { return document.getElementById("readerBody"); }

  function chunkId() {
    return "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
  }

  function paint(mark, color) {
    mark.setAttribute("data-color", color);
    mark.style.background = COLORS[color] || COLORS.yellow;
    mark.style.color = "inherit";
  }

  function collect() {
    var root = bodyEl();
    if (!root) return [];
    return Array.prototype.map.call(root.querySelectorAll("mark[data-chunk-id]"), function (m) {
      var note = m.getAttribute("data-note") || "";
      var summary = m.getAttribute("data-summary") || "";
      var item = {
        chunkId: m.getAttribute("data-chunk-id"),
        color: m.getAttribute("data-color") || "yellow",
        text: (m.textContent || "").trim(),
        createdAt: m.getAttribute("data-created") || new Date().toISOString()
      };
      if (note) item.note = note;
      if (summary) item.aiSummary = summary;
      return item;
    });
  }

  function persist() {
    var bridge = api();
    if (!bridge || !sourceUrl) return;
    bridge.saveHighlights(sourceUrl, collect()).catch(function () {});
  }

  function wrapRange(range, color) {
    var mark = document.createElement("mark");
    mark.setAttribute("data-chunk-id", chunkId());
    mark.setAttribute("data-created", new Date().toISOString());
    paint(mark, color || "yellow");
    try {
      range.surroundContents(mark);
    } catch (err) {
      var frag = range.extractContents();
      mark.appendChild(frag);
      range.insertNode(mark);
    }
    return mark;
  }

  function wrapText(root, text, color, id, note) {
    if (!text) return false;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest("mark")) continue;
      var value = node.nodeValue || "";
      var idx = value.indexOf(text);
      if (idx < 0) continue;
      var range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + text.length);
      var mark = wrapRange(range, color);
      if (id) mark.setAttribute("data-chunk-id", id);
      if (note) mark.setAttribute("data-note", note);
      return true;
    }
    return false;
  }

  function selectedText() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount < 1) return "";
    return String(sel.toString() || "").trim();
  }

  function contextAround(text) {
    var root = bodyEl();
    var all = root ? String(root.innerText || "") : "";
    var at = all.indexOf(text);
    if (at < 0) return text.slice(0, 400);
    var start = Math.max(0, at - 200);
    var end = Math.min(all.length, at + text.length + 200);
    return all.slice(start, end);
  }

  var bar = document.createElement("div");
  bar.id = "sparoMarkBar";
  bar.className = "mark-toolbar";
  bar.innerHTML = '<button type="button" data-color="yellow">黄</button><button type="button" data-color="green">绿</button><button type="button" data-color="blue">蓝</button><button type="button" data-color="red">红</button><button type="button" data-act="note">添加笔记</button>';
  document.body.appendChild(bar);
  bar.addEventListener("mousedown", function (e) { e.preventDefault(); });

  function hideBar() { bar.style.display = "none"; }
  function showBar(x, y) {
    bar.style.display = "flex";
    bar.style.left = Math.max(8, x) + "px";
    bar.style.top = Math.max(8, y + 12) + "px";
  }
  hideBar();

  var drawer = document.getElementById("sparoDrawer");
  var drawerBody = document.getElementById("sparoDrawerBody");
  var drawerActions = document.getElementById("sparoDrawerActions");

  function closeDrawer() {
    if (drawer) drawer.classList.remove("show");
    pending = null;
  }
  window.__sparoCloseDrawer = closeDrawer;

  function setActions(html) {
    if (drawerActions) drawerActions.innerHTML = html;
  }

  function openSelectionDrawer(state) {
    pending = state;
    if (!drawer || !drawerBody) return;
    drawer.classList.add("show");
    var quote = '<div class="drawer-quote">' + escapeHtml(state.text) + "</div>";
    var summary = state.summary
      ? '<div class="drawer-summary">' + escapeHtml(state.summary) + "</div>"
      : '<div class="drawer-summary">正在生成一句话总结…</div>';
    drawerBody.innerHTML = quote + summary;
    setActions('<button type="button" data-act="save">存入笔记</button><button type="button" data-act="skip">跳过</button><button type="button" data-act="retry">再试试</button>');
  }

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function askAi(mark) {
    var text = (mark.textContent || "").trim();
    if (!text) return;
    var state = { kind: "selection", text: text, mark: mark, summary: "" };
    openSelectionDrawer(state);
    var bridge = api();
    if (!bridge || !bridge.summarizeSelection) {
      toast("AI 暂时不可用，但高亮已保存");
      return;
    }
    bridge.summarizeSelection({
      url: sourceUrl,
      title: pageTitle,
      text: text,
      context: contextAround(text),
      chunkId: mark.getAttribute("data-chunk-id")
    }).then(function (res) {
      if (!pending || pending.mark !== mark) return;
      if (!res || res.ok === false) {
        toast("AI 暂时不可用，但高亮已保存");
        if (drawerBody) {
          drawerBody.innerHTML = '<div class="drawer-quote">' + escapeHtml(text) + '</div><div class="drawer-summary">AI 暂时不可用，高亮已保留。</div>';
        }
        return;
      }
      state.summary = String(res.summary || "");
      mark.setAttribute("data-summary", state.summary);
      persist();
      openSelectionDrawer(state);
    }).catch(function () {
      toast("AI 暂时不可用，但高亮已保存");
    });
  }

  function applyColor(color) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount < 1 || !selectedText()) return null;
    var range = sel.getRangeAt(0);
    var parent = range.startContainer.parentElement;
    if (parent && parent.closest("mark") && parent.closest("mark").contains(range.endContainer)) {
      var existing = parent.closest("mark");
      paint(existing, color);
      persist();
      return existing;
    }
    var mark = wrapRange(range, color);
    sel.removeAllRanges();
    persist();
    return mark;
  }

  bar.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    var color = btn.getAttribute("data-color");
    if (color) {
      var mark = applyColor(color);
      hideBar();
      if (mark && companionOn) askAi(mark);
      return;
    }
    if (btn.getAttribute("data-act") === "note") {
      var mark2 = applyColor("yellow");
      hideBar();
      if (!mark2) return;
      var note = window.prompt("给这段加一句笔记", mark2.getAttribute("data-note") || "");
      if (note == null) return;
      mark2.setAttribute("data-note", note);
      persist();
      toast("笔记已写在高亮上");
    }
  });

  document.addEventListener("mouseup", function (e) {
    if (e.target.closest && e.target.closest("#sparoMarkBar, #sparoDrawer, .reader-toolbar")) return;
    var text = selectedText();
    if (!text) { hideBar(); return; }
    showBar(e.clientX || 24, e.clientY || 24);
    if (companionOn) {
      var mark = applyColor("yellow");
      if (mark) askAi(mark);
      hideBar();
    }
  });

  function syncCompanionBtn() {
    var btn = document.getElementById("btnReaderCompanion");
    if (!btn) return;
    btn.textContent = companionOn ? "AI伴读 开" : "AI伴读 关";
    btn.classList.toggle("on", companionOn);
  }
  syncCompanionBtn();

  var themeBtn = document.getElementById("btnReaderTheme");
  var fontBtn = document.getElementById("btnReaderFont");
  var companionBtn = document.getElementById("btnReaderCompanion");
  var saveBtn = document.getElementById("btnReaderSave");
  var closeBtn = document.getElementById("btnReaderClose");
  var themes = ["paper", "green", "night"];
  var fonts = [14, 16, 18, 20];

  function prefsPatch(patch) {
    var bridge = api();
    if (bridge && bridge.setReaderPrefs) bridge.setReaderPrefs(patch).catch(function () {});
  }
  if (themeBtn) themeBtn.addEventListener("click", function () {
    var cur = document.body.getAttribute("data-theme") || "paper";
    var next = themes[(themes.indexOf(cur) + 1) % themes.length];
    document.body.setAttribute("data-theme", next);
    themeBtn.textContent = next === "green" ? "豆沙绿" : next === "night" ? "夜间" : "米白";
    prefsPatch({ theme: next });
  });
  if (fontBtn) fontBtn.addEventListener("click", function () {
    var cur = Number(document.body.getAttribute("data-font") || 16);
    var next = fonts[(Math.max(0, fonts.indexOf(cur)) + 1) % fonts.length];
    document.body.setAttribute("data-font", String(next));
    fontBtn.textContent = next + "px";
    prefsPatch({ fontSize: next });
  });
  if (companionBtn) companionBtn.addEventListener("click", function () {
    companionOn = !companionOn;
    syncCompanionBtn();
    var bridge = api();
    if (bridge && bridge.setCompanion) bridge.setCompanion(companionOn).catch(function () {});
    toast(companionOn ? "AI伴读已打开" : "AI伴读已关闭");
  });
  if (closeBtn) closeBtn.addEventListener("click", function () {
    var bridge = api();
    if (bridge && bridge.closeReader) bridge.closeReader().catch(function () {});
  });

  function showPageDrawer(res, failed) {
    if (!drawer || !drawerBody) return;
    drawer.classList.add("show");
    var wordCount = Number((bodyEl() && (bodyEl().innerText || "").length) || payload.wordCount || 0);
    pending = { kind: "page", summary: res && res.summary ? res.summary : "", wordCount: wordCount, structured: res && res.structured };
    if (failed) {
      drawerBody.innerHTML = '<div class="drawer-summary">AI 总结失败。</div><p class="drawer-hint">可以手动存全文 ' + wordCount + " 字</p>";
      setActions('<button type="button" data-act="manual">手动存全文</button><button type="button" data-act="skip">取消</button>');
      toast("AI 总结失败，但可以手动存全文");
      return;
    }
    var s = (res && res.structured) || {};
    var sentences = (s.sentences || []).map(function (line) { return "<li>" + escapeHtml(line) + "</li>"; }).join("");
    var points = (s.points || []).map(function (line) { return "<li>" + escapeHtml(line) + "</li>"; }).join("");
    var block = "";
    if (sentences || points || s.recommend) {
      block = (sentences ? "<p>核心摘要</p><ol>" + sentences + "</ol>" : "")
        + (points ? "<p>关键观点</p><ul>" + points + "</ul>" : "")
        + (s.recommend ? "<p>推荐语：" + escapeHtml(s.recommend) + "</p>" : "");
    } else {
      block = "<div class='drawer-summary'>" + escapeHtml((res && res.summary) || "") + "</div>";
    }
    drawerBody.innerHTML = block + '<p class="drawer-hint">将保存：全文 ' + wordCount + " 字 + 读书记录（来源 URL、保存时间）</p>";
    setActions('<button type="button" data-act="confirm">确认键存</button><button type="button" data-act="skip">取消</button>');
  }

  function runPageSummary() {
    if (drawer && drawerBody) {
      drawer.classList.add("show");
      drawerBody.innerHTML = "<div class='drawer-summary'>正在总结全文…</div>";
      setActions("");
    }
    var bridge = api();
    var text = bodyEl() ? String(bodyEl().innerText || "") : "";
    if (!bridge || !bridge.summarizePage) {
      showPageDrawer(null, true);
      return;
    }
    bridge.summarizePage({ url: sourceUrl, title: pageTitle, text: text }).then(function (res) {
      if (!res || res.ok === false) showPageDrawer(res, true);
      else showPageDrawer(res, false);
    }).catch(function () { showPageDrawer(null, true); });
  }
  if (saveBtn) saveBtn.addEventListener("click", runPageSummary);
  window.__sparoOneShotSave = runPageSummary;

  if (drawerActions) drawerActions.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn || !pending) return;
    var act = btn.getAttribute("data-act");
    var bridge = api();
    if (act === "skip") { closeDrawer(); return; }
    if (act === "retry" && pending.kind === "selection" && pending.mark) {
      askAi(pending.mark);
      return;
    }
    if (act === "save" && pending.kind === "selection") {
      if (!bridge || !bridge.saveHighlightNote) { toast("存入笔记还没接上"); return; }
      bridge.saveHighlightNote({
        url: sourceUrl,
        title: pageTitle,
        siteName: siteName,
        text: pending.text,
        summary: pending.summary || "",
        chunkId: pending.mark ? pending.mark.getAttribute("data-chunk-id") : "",
        color: pending.mark ? (pending.mark.getAttribute("data-color") || "yellow") : "yellow"
      }).then(function (res) {
        if (!res || res.ok === false) toast((res && res.message) || "存入失败");
        else { toast("已存入笔记库"); closeDrawer(); }
      }).catch(function () { toast("存入失败"); });
      return;
    }
    if ((act === "confirm" || act === "manual") && pending.kind === "page") {
      if (!bridge || !bridge.saveFullPage) { toast("存入笔记还没接上"); return; }
      var html = bodyEl() ? bodyEl().innerHTML : "";
      var text = bodyEl() ? String(bodyEl().innerText || "") : "";
      bridge.saveFullPage({
        url: sourceUrl,
        title: pageTitle,
        siteName: siteName,
        html: html,
        text: text,
        summary: act === "manual" ? "" : (pending.summary || ""),
        wordCount: text.length
      }).then(function (res) {
        if (!res || res.ok === false) toast((res && res.message) || "存入失败");
        else { toast("已存入笔记库"); closeDrawer(); }
      }).catch(function () { toast("存入失败"); });
    }
  });

  document.querySelectorAll("#readerBody a[href]").forEach(function (a) {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noreferrer");
  });

  var bridge0 = api();
  if (bridge0 && sourceUrl && bridge0.loadHighlights) {
    bridge0.loadHighlights(sourceUrl).then(function (res) {
      var list = (res && res.highlights) || [];
      var root = bodyEl();
      if (!root) return;
      list.forEach(function (h) {
        if (root.querySelector('mark[data-chunk-id="' + h.chunkId + '"]')) return;
        wrapText(root, h.text, h.color || "yellow", h.chunkId, h.note || "");
      });
    }).catch(function () {});
  }
})();`;
