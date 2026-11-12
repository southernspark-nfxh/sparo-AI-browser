// 百家号。标题是 Lexical，正文是 UEditor，setContent 只传 1 个参数。
import {
  blockedCall,
  clickLabeled,
  confirmCoverScript,
  fail,
  guard,
  openWriteTab,
  page,
  pageHint,
  pass,
  runSchedule,
  sleep,
  uploadPicked,
  waitEditor,
} from "../page.mjs";
import { click, nav } from "../sparo.mjs";

/** 图片不堆在文末：单图放中段，多图均匀分布，只插在段落之前，不插在小标题后面。 */
function withImageSlots(html, count) {
  if (!count) return html;
  // 正文已写好 @@IMG1@@…@@IMGn@@ 时按锚点插，不再均分。没写标记的稿子仍走均分。
  const needed = Array.from({ length: count }, (_, i) => "@@IMG" + (i + 1) + "@@");
  if (needed.every((mark) => html.includes(mark))) return html;
  const blocks = html
    .split(/(?=<(?:p|h[1-6]|blockquote|ul|ol|table|hr|figure)\b)/i)
    .filter((block) => block.trim());
  const paras = blocks.map((block, i) => (/^<p[\s>]/i.test(block) ? i : -1)).filter((i) => i >= 0);
  if (paras.length < 2) {
    return html + Array.from({ length: count }, (_, i) => "<p>@@IMG" + (i + 1) + "@@</p>").join("");
  }
  const slots = new Map();
  for (let i = 0; i < count; i++) {
    const at = Math.min(paras.length - 1, Math.max(0, Math.round(((i + 1) * paras.length) / (count + 1)) - 1));
    const pos = paras[at];
    slots.set(pos, (slots.get(pos) || "") + "<p>@@IMG" + (i + 1) + "@@</p>");
  }
  return blocks.map((block, i) => (slots.get(i) || "") + block).join("");
}

/** 弹窗当前文案。重开弹窗时上一轮的「上传成功」还在，靠它区分新旧。 */
async function modalText(ctx) {
  const read = await page(
    ctx,
    "(() => {" +
      "const mod = document.querySelector('.cheetah-ui-pro-image-modal');" +
      "return JSON.stringify({ text: ((mod && mod.innerText) || '').replace(/\\s+/g, '') });" +
      "})()",
  );
  if (read.stop) return "";
  return read.value?.text || "";
}

/** 等图片模态框显示「上传成功」并且真的摆上屏幕，再点确认。 */
async function waitUploaded(ctx, beforeText) {
  const deadline = Date.now() + 20000;
  while (Date.now() <= deadline) {
    const read = await page(
      ctx,
      "(() => {" +
        "const mod = document.querySelector('.cheetah-ui-pro-image-modal');" +
        "const r = mod ? mod.getBoundingClientRect() : null;" +
        "const text = ((mod && mod.innerText) || '').replace(/\\s+/g, '');" +
        "return JSON.stringify({ visible: !!r && r.width > 8 && r.height > 8, text });" +
        "})()",
    );
    if (read.stop) return read.stop;
    if (!read.value?.visible) {
      await sleep(500);
      continue;
    }
    const text = read.value?.text || "";
    if (/上传失败/.test(text)) return fail("UPLOAD_FAILED", { text }, "百家号图片弹层报上传失败");
    const matched = text.match(/(\d+)\s*张\s*上传(?:成功|完成)/);
    const count = matched ? Number(matched[1]) : 0;
    if (count >= 1 && text !== beforeText) {
      const enabled = await page(
        ctx,
        "(() => { const mod = document.querySelector('.cheetah-ui-pro-image-modal'); const btn = mod && mod.querySelector('.cheetah-modal-footer button.cheetah-btn-primary'); if (!btn) return JSON.stringify({ btnDisabled: true }); const disabled = !!btn.disabled || btn.getAttribute('aria-disabled') === 'true' || /disabled/.test(String(btn.className)); return JSON.stringify({ btnDisabled: disabled }); })()",
      );
      if (enabled.stop) return enabled.stop;
      if (enabled.value?.btnDisabled === false) return pass({ count });
    }
    await sleep(500);
  }
  return fail("UPLOAD_UNCONFIRMED", "", "上传张数未到 1 或确认按钮仍不可用");
}

/** 上一张图确认后，弹层有时缩成只剩「取消 / 确认」并挡住下一次上传。这种空壳先关掉。 */
async function dismissStaleImageModal(ctx) {
  for (let i = 0; i < 3; i++) {
    const read = await page(
      ctx,
      "(() => { const mod = document.querySelector('.cheetah-ui-pro-image-modal'); const r = mod ? mod.getBoundingClientRect() : null; const open = !!(r && r.width > 8 && r.height > 8); const text = ((mod && mod.innerText) || '').replace(/\\s+/g, ''); return JSON.stringify({ open, text: text.slice(0, 40) }); })()",
    );
    if (read.stop) return read.stop;
    if (!read.value?.open) return pass({});
    if (/上传成功|本地图片|正版图库/.test(read.value.text || "")) return pass({ upload: true });
    await click(".cheetah-ui-pro-image-modal .cheetah-modal-footer button.cheetah-btn-default", ctx.tabId);
    await sleep(500);
  }
  return pass({});
}

/** 点弹窗页脚的「确认」。文案匹配会有两个同名按钮，只能用精确选择器。确认后再点一次会重复插图，所以先等弹层自己关掉。 */
async function confirmImageModal(ctx) {
  const stateScript =
    "(() => {" +
    "const iframe = document.querySelector('#ueditor_0');" +
    "const n = iframe?.contentDocument?.querySelectorAll('img')?.length || 0;" +
    "const mod = document.querySelector('.cheetah-ui-pro-image-modal');" +
    "const r = mod ? mod.getBoundingClientRect() : null;" +
    "return JSON.stringify({ open: !!r && r.width > 8 && r.height > 8, n });" +
    "})()";
  const before = await page(ctx, stateScript);
  if (before.stop) return before.stop;
  const beforeN = before.value?.n || 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await click(".cheetah-ui-pro-image-modal .cheetah-modal-footer button.cheetah-btn-primary", ctx.tabId);
    if (!/"ok"\s*:\s*true/.test(String(raw))) {
      console.error("[baijiahao] confirm click:", String(raw).slice(0, 300));
    }
    const deadline = Date.now() + 8000;
    while (Date.now() <= deadline) {
      const closed = await page(ctx, stateScript);
      if (closed.stop) return closed.stop;
      if (!closed.value?.open) return pass({ n: closed.value?.n || 0 });
      if ((closed.value?.n || 0) > beforeN) {
        await click(".cheetah-ui-pro-image-modal .cheetah-modal-footer button.cheetah-btn-default", ctx.tabId);
        await sleep(600);
        const after = await page(ctx, stateScript);
        if (after.stop) return after.stop;
        if ((after.value?.n || 0) >= beforeN + 1) return pass({ n: after.value.n, dismissed: true });
      }
      await sleep(400);
    }
  }
  return fail("IMAGE_CONFIRM_MISSING", "", "插图弹窗的确认没点掉");
}

/** 续跑时以编辑器里还在的 @@IMGn@@ 为准，已经换掉的标记不要再传。 */
async function readLiveBody(ctx) {
  const read = await page(
    ctx,
    "(() => {" +
      "const named = window.UE_V2 && window.UE_V2.instants && (window.UE_V2.instants.ueditorInstant0 || window.UE_V2.instants['ueditorInstant0']);" +
      "const fallback = window.UE && window.UE.getEditor && window.UE.getEditor('ueditor_0');" +
      "const ue = (named && named.getContent) ? named : fallback;" +
      "const fromUe = ue && ue.getContent ? (ue.getContent() || '') : '';" +
      "const iframe = document.querySelector('#ueditor_0');" +
      "const fromDom = iframe && iframe.contentDocument && iframe.contentDocument.body ? (iframe.contentDocument.body.innerHTML || '') : '';" +
      "const html = fromUe || fromDom;" +
      "const marks = html.match(/@@IMG\\d+@@/g) || [];" +
      "return JSON.stringify({ html, marks });" +
      "})()",
  );
  if (read.stop) return read.stop;
  return pass(read.value || { html: "", marks: [] });
}

/** 正文 iframe 里已有的图片地址。用来认出这次新传进来的那张。 */
async function readImageSrcs(ctx) {
  const read = await page(
    ctx,
    "(() => {" +
      "const iframe = document.querySelector('#ueditor_0');" +
      "const imgs = Array.from(iframe?.contentDocument?.querySelectorAll('img') || []);" +
      "const srcs = imgs.map((img) => img.getAttribute('src') || '').filter((item) => /picproxy|baijiahao|baidu/.test(item));" +
      "return JSON.stringify({ srcs });" +
      "})()",
  );
  if (read.stop) return [];
  return read.value?.srcs || [];
}

/** 定时弹层的确认按钮：页脚主按钮写「定时发布」，和页面上开弹层的按钮重名，只能按弹层的构造点。 */
async function confirmScheduleModal(ctx) {
  const selector = ".cheetah-modal-confirm-btns button.cheetah-btn-primary";
  const wrapOpen = () =>
    page(
      ctx,
      "(() => {" +
        "const wrap = document.querySelector('.timepublish-wrap');" +
        "const r = wrap ? wrap.getBoundingClientRect() : null;" +
        "return JSON.stringify({ open: !!r && r.height > 8 });" +
        "})()",
    );
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await click(selector, ctx.tabId);
    if (!/"ok"\s*:\s*true/.test(String(raw))) {
      // click 回执会因为渲染忙变成空串，但动作可能已经生效。先看弹层关没关：
      // 关了就是成功，绝不能再点一次——第二次会落到后续弹层的 primary 上，变成立即发布。
      console.error("[baijiahao] schedule confirm click:", String(raw).slice(0, 300));
      const state = await wrapOpen();
      if (state.stop) return state.stop;
      if (state.value && state.value.open === false) return pass({ retried: true });
      await sleep(800);
      continue;
    }
    const deadline = Date.now() + 15000;
    while (Date.now() <= deadline) {
      const read = await wrapOpen();
      if (read.stop) return read.stop;
      if (!read.value?.open) return pass({});
      await sleep(500);
    }
    return fail("SCHEDULE_CONFIRM_MISSING", {}, "点了「定时发布」但弹层没关");
  }
  return fail("SCHEDULE_CONFIRM_MISSING", {}, "没点到定时弹层的「定时发布」");
}

/** 续跑时定时弹层可能还开着，会挡住封面和 AI 选项：先按「取消」关掉，后面再重新填时间。 */
async function closeScheduleModal(ctx) {
  const read = await page(
    ctx,
    "(() => {" +
      "const wrap = document.querySelector('.timepublish-wrap');" +
      "const r = wrap ? wrap.getBoundingClientRect() : null;" +
      "return JSON.stringify({ open: !!r && r.height > 8 });" +
      "})()",
  );
  if (read.stop) return read.stop;
  if (!read.value?.open) return pass({ closed: false });
  const fired = await page(
    ctx,
    "(() => {" +
      "const foot = document.querySelector('.cheetah-modal-confirm-btns');" +
      "if (!foot) return JSON.stringify({ ok: false });" +
      "const btn = Array.from(foot.querySelectorAll('button')).find((el) => (el.innerText || '').replace(/\\s+/g, '') === '取消');" +
      "if (!btn) return JSON.stringify({ ok: false });" +
      "const r = btn.getBoundingClientRect();" +
      "const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };" +
      "btn.dispatchEvent(new PointerEvent('pointerdown', opt));" +
      "btn.dispatchEvent(new MouseEvent('mousedown', opt));" +
      "btn.dispatchEvent(new PointerEvent('pointerup', opt));" +
      "btn.dispatchEvent(new MouseEvent('mouseup', opt));" +
      "btn.click();" +
      "return JSON.stringify({ ok: true });" +
      "})()",
  );
  if (fired.stop) return fired.stop;
  if (!fired.value?.ok) return fail("SCHEDULE_MODAL_STUCK", fired.value, "定时弹层开着，没找到「取消」");
  await sleep(800);
  return pass({ closed: true });
}

export const baijiahao = {
  id: "baijiahao",
  host: "baijiahao.baidu.com",
  writeUrl: "https://baijiahao.baidu.com/builder/rc/edit?type=news",
  writeMark: "/builder/rc/edit",
  // 带 article_id / online_modify 的是「修改已发布文章」，不能当新稿空白页复用
  editExisting: /[?&]article_id=|\bonline_modify\b/,
  listUrl: "https://baijiahao.baidu.com/builder/rc/content",

  async openBlank(ctx) {
    const opened = await openWriteTab(ctx);
    if (!opened.ok) return opened;
    if (opened.detail && opened.detail.reused) {
      // 复用旧编辑器会带着上一篇的草稿和半初始化的工具栏：重载一次，保证从空白页开始
      const moved = await nav(ctx.writeUrl, ctx.tabId);
      if (typeof moved === "string" && /MISMATCH|UNREAD/.test(moved)) {
        return fail("NAV_FAIL", moved, "重载空白编辑页失败");
      }
      await sleep(1800);
    }
    const editor = await waitEditor(ctx, "#ueditor_0");
    if (!editor.ok) return editor;
    const title = await waitEditor(ctx, '[data-lexical-editor="true"]');
    if (!title.ok) return title;
    return pass({ tabId: ctx.tabId, href: editor.detail.href });
  },

  async readTitle(ctx) {
    const read = await page(
      ctx,
      "(() => { const ed = document.querySelector('[data-lexical-editor=\"true\"]'); return JSON.stringify({ href: location.href, title: ((ed && ed.innerText) || '').replace(/\\u200b/g, '').trim() }); })()",
    );
    if (read.stop) return read.stop;
    return pass(read.value || {});
  },

  async fillTitle(ctx) {
    const script =
      "(() => {" +
      "const ed = document.querySelector('[data-lexical-editor=\"true\"]');" +
      "const editor = ed && ed.__lexicalEditor;" +
      "if (!editor || typeof editor.update !== 'function' || typeof editor.parseEditorState !== 'function') return JSON.stringify({ ok: false, code: 'NO_TITLE' });" +
      "const text = " + JSON.stringify(ctx.title) + ";" +
      "try { editor.update((root) => { if (root && typeof root.clear === 'function') root.clear(); }); } catch (e) {}" +
      "const json = { root: { children: [{ children: [{ detail: 0, format: 0, mode: 'normal', style: '', text: text, type: 'text', version: 1 }], direction: 'ltr', format: '', indent: 0, type: 'paragraph', version: 1 }], direction: 'ltr', format: '', indent: 0, type: 'root', version: 1 } };" +
      "editor.setEditorState(editor.parseEditorState(JSON.stringify(json)));" +
      "const value = ((ed.innerText || '').replace(/\\u200b/g, '').trim());" +
      "return JSON.stringify({ ok: value === text, value });" +
      "})()";
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const read = await page(ctx, script);
      if (read.stop) return read.stop;
      last = read.value;
      if (last?.ok) return pass({ value: last.value });
      // 刚重载时 exec 可能回空串，或 Lexical 还没挂上 __lexicalEditor：等一下再试
      await sleep(700);
    }
    return fail("TITLE_UNREAD", last, "Lexical 标题回读不一致");
  },

  async fillBody(ctx) {
    const html = withImageSlots(ctx.bodyHtml, ctx.images.length);
    ctx.bodyHtmlLive = html;
    const written = await setUeContent(ctx, html);
    if (!written.ok) return written;
    if (!written.detail?.len) return fail("BODY_UNREAD", written.detail, "正文字数回读为 0");
    return written;
  },

  async insertImages(ctx) {
    if (!ctx.images.length) {
      ctx.imageCount = 0;
      return pass({ count: 0 });
    }
    const live = await readLiveBody(ctx);
    if (live.stop) return live.stop;
    if (!live.ok) return live;
    let html = live.detail?.html || ctx.bodyHtmlLive || withImageSlots(ctx.bodyHtml, ctx.images.length);
    const seen = live.detail?.marks || [];
    const pending = new Set(seen.length || !html.includes("@@IMG") ? seen : html.match(/@@IMG\d+@@/g) || []);
    for (let index = 0; index < ctx.images.length; index++) {
      const mark = "@@IMG" + (index + 1) + "@@";
      if (!pending.has(mark)) continue;
      const file = ctx.images[index];
      const cleared = await dismissStaleImageModal(ctx);
      if (!cleared.ok) return cleared;
      const beforeSrcs = await readImageSrcs(ctx);
      const beforeModal = await modalText(ctx);
      // 刚进编辑页时工具栏还没渲染，先等插图入口出现，别急着点
      let entry = false;
      for (let wait = 0; wait < 12 && !entry; wait++) {
        entry = await page(
          ctx,
          "(() => { const el = document.querySelector('.edui-for-insertimage'); if (!el) return JSON.stringify({ ok: false }); const r = el.getBoundingClientRect(); return JSON.stringify({ ok: r.width > 0 && r.height > 0 }); })()",
        ).then((r) => !!r.value?.ok);
        if (!entry) await sleep(400);
      }
      if (!entry) return fail("IMAGE_ENTRY_MISSING", file, "工具栏一直没渲染出插图入口");
      // 真实点击：JS 模拟点击会落到相邻的视频入口，jpg 被当视频拒收
      // click 回执偶发空串，不代表没点上：先看图片弹窗出来没有，没出来才补点一次
      let opened = await click(".edui-for-insertimage", ctx.tabId);
      if (!/"ok"\s*:\s*true/.test(String(opened))) {
        console.error("[baijiahao] image entry click:", String(opened).slice(0, 200));
        await sleep(1200);
        const popped = await page(
          ctx,
          "(() => {" +
            "const el = document.querySelector('.cheetah-ui-pro-image-modal');" +
            "const r = el ? el.getBoundingClientRect() : null;" +
            "return JSON.stringify({ open: !!r && r.width > 0 && r.height > 0 });" +
            "})()",
        );
        if (popped.value?.open !== true) {
          opened = await click(".edui-for-insertimage", ctx.tabId);
          if (!/"ok"\s*:\s*true/.test(String(opened))) {
            return fail("IMAGE_ENTRY_MISSING", file, "没有点到百家号插图按钮：" + String(opened).slice(0, 160));
          }
        }
      }
      await sleep(1600);
      const blocked = await guard(ctx);
      if (blocked) return blocked;
      // 只认图片模态框里的 image input，避免抓到视频上传框
      const uploaded = await uploadPicked(ctx, file, "", true);
      if (!uploaded.ok) return uploaded;
      const ready = await waitUploaded(ctx, beforeModal);
      if (!ready.ok) return ready;
      const confirmed = await confirmImageModal(ctx);
      if (!confirmed.ok) return confirmed;
      // 确认后正文里必须多出一张图，才算这次插入成功
      let src = "";
      const deadline = Date.now() + 10000;
      while (Date.now() <= deadline) {
        const srcs = await readImageSrcs(ctx);
        src = srcs.find((item) => !beforeSrcs.includes(item)) || "";
        // 同一张图再传一次时，图床会给出已经出现过的地址，张数增加就算这张成功。
        if (!src && srcs.length > beforeSrcs.length) src = srcs[srcs.length - 1];
        if (src) break;
        await sleep(500);
      }
      if (!src) return fail("IMAGES_UNREAD", file, "确认后正文没有出现新图片");
      html = html.replace(mark, '<img src="' + src.replace(/"/g, "") + '">');
      const rewritten = await setUeContent(ctx, html);
      if (!rewritten.ok) return rewritten;
      ctx.bodyHtmlLive = html;
    }
    ctx.imageCount = ctx.images.length;
    return pass({ count: ctx.imageCount });
  },

  async setCover(ctx) {
    // 0) 先把「单图」radio 选中。没选服务端 cover_layout=none，本地却有封面，publish 会报 errno:20040083
    const pickedRadio = await ensureSingleCover(ctx);
    if (!pickedRadio.ok) return pickedRadio;

    // 1) 开封面弹窗。两轮：第一轮直接 fire；没成功重载编辑页再开
    let opened = await tryOpenCoverDialog(ctx);
    if (!opened.ok) {
      // 重载兜底：navigate 回当前编辑页，等标题+正文都回来，再试一次
      const refreshed = await nav(ctx.writeUrl + "&article_id=" + (ctx.articleId || ""), ctx.tabId);
      if (!String(refreshed).startsWith("URL_UNREAD") && !String(refreshed).startsWith("MISMATCH")) {
        await sleep(3500);
        // 重载后重新点「单图」+ 打开弹窗
        const rePick = await ensureSingleCover(ctx);
        if (!rePick.ok) return rePick;
        await sleep(600);
        opened = await tryOpenCoverDialog(ctx);
      }
    }
    if (!opened.ok) return fail("COVER_ENTRY_MISSING", "选择封面", await pageHint(ctx));
    const uploaded = await uploadPicked(ctx, ctx.cover, "", true);
    if (!uploaded.ok) return uploaded;
    await sleep(1200);
    // 选封面：必须点最后一张缩略图（刚上传那张）。点第一张示例图的话「确定」永远是灰的。
    const pickScript = (back) =>
      "(() => {" +
      "function visible(el) { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width >= 8 && r.height >= 8; }" +
      "function fire(el) { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; el.dispatchEvent(new PointerEvent('pointerdown', opt)); el.dispatchEvent(new MouseEvent('mousedown', opt)); el.dispatchEvent(new PointerEvent('pointerup', opt)); el.dispatchEvent(new MouseEvent('mouseup', opt)); el.click(); }" +
      "function findCoverDialog() {" +
      "const candidates = Array.from(document.querySelectorAll('[class*=\"modal\"], [class*=\"dialog\"], [role=\"dialog\"]')).filter((el) => visible(el));" +
      "for (const c of candidates) {" +
      "const t = (c.innerText || '').replace(/\\s+/g, '');" +
      "if (/确定/.test(t) && (/取消/.test(t) || /封面|本地上传|正版图库/.test(t))) return c;" +
      "}" +
      "for (const c of candidates) { if (/确定/.test((c.innerText || '').replace(/\\s+/g, ''))) return c; }" +
      "return null;" +
      "}" +
      "const dialog = findCoverDialog();" +
      "if (!dialog) return JSON.stringify({ ok: false, code: 'NO_DIALOG' });" +
      "const thumbs = Array.from(dialog.querySelectorAll('img')).filter((img) => visible(img) && img.getBoundingClientRect().width >= 40 && ((img.currentSrc || img.getAttribute('src') || '').length > 8));" +
      "if (!thumbs.length) return JSON.stringify({ ok: false, code: 'NO_THUMB' });" +
      "const idx = Math.max(0, thumbs.length - 1 - " + back + ");" +
      "fire(thumbs[idx]);" +
      "return JSON.stringify({ ok: true, idx, thumbs: thumbs.length });" +
      "})()";
    const checkScript =
      "(() => {" +
      "function visible(el) { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width >= 8 && r.height >= 8; }" +
      "const btn = Array.from(document.querySelectorAll('.cheetah-modal-wrap button')).filter((b) => visible(b) && /^\\s*确定(\\s*\\(\\d+\\))?\\s*$/.test(b.innerText || ''))[0];" +
      "if (!btn) return JSON.stringify({ ready: false, code: 'NO_CONFIRM' });" +
      "if (btn.disabled) return JSON.stringify({ ready: false, disabled: true });" +
      "btn.id = 'sparo-cover-ok';" +
      "return JSON.stringify({ ready: true });" +
      "})()";
    let ready = null;
    for (let attempt = 0; attempt < 3 && !ready; attempt++) {
      const picked = await page(ctx, pickScript(attempt));
      if (picked.stop) return picked.stop;
      if (!picked.value?.ok) return fail(picked.value?.code || "COVER_THUMB_MISSING", picked.value, "封面弹窗里没找到缩略图");
      await sleep(800);
      const check = await page(ctx, checkScript);
      if (check.stop) return check.stop;
      if (check.value?.ready) ready = check.value;
    }
    if (!ready) return fail("COVER_NOT_PICKED", "", "封面已上传但「确定」始终是灰的，说明没真正选中");
    const okClick = await click("#sparo-cover-ok", ctx.tabId);
    if (!/"ok"\s*:\s*true/.test(String(okClick))) {
      return fail("COVER_CONFIRM_MISSING", String(okClick).slice(0, 160), "封面「确定」点不下去");
    }
    await sleep(1500);
    const seen = await page(
      ctx,
      "(() => {" +
        "const coverImgs = Array.from(document.querySelectorAll('img')).filter((img) => {" +
        "const src = img.getAttribute('src') || '';" +
        "const cls = img.className || '';" +
        "const w = img.naturalWidth || 0;" +
        "const h = img.naturalHeight || 0;" +
        "return (/coverImg|cover/i.test(cls) || /picproxy|baijiahao|baidu/.test(src) || (src.startsWith('blob:') && w >= 300 && h >= 200));" +
        "});" +
        "return JSON.stringify({ n: coverImgs.length });" +
        "})()",
    );
    if (seen.stop) return seen.stop;
    // 弹窗必须真的关了，否则说明「确定」没生效，页面上的图可能只是弹窗里的候选图
    const modalGone = await page(
      ctx,
      "(() => {" +
        "const open = Array.from(document.querySelectorAll('.cheetah-modal-wrap')).filter((m) => m.getBoundingClientRect().height > 8).length;" +
        "return JSON.stringify({ open });" +
        "})()",
    );
    if (modalGone.stop) return modalGone.stop;
    if (modalGone.value?.open) return fail("COVER_MODAL_STILL_OPEN", modalGone.value, "封面弹窗点了确定还开着");
    ctx.coverCount = seen.value?.n || 0;
    if (!ctx.coverCount) return fail("COVER_UNREAD", seen.value, "封面回读没有图片");
    return pass({ cover: ctx.coverCount });
  },

  async setOptions(ctx) {
    // 已断言：采用AI生成内容必须未勾选。赞赏、作品声明本轮未封装，需人工补。
    const state = await readAi(ctx, true);
    if (!state.ok) return state;
    ctx.options = state.detail;
    return state;
  },

  async publishOrSchedule(ctx) {
    const blocked = await guard(ctx);
    if (blocked) return blocked;
    // 续跑时上一次没关掉的定时弹层会挡住封面和 AI 选项
    const scheduleClosed = await closeScheduleModal(ctx);
    if (!scheduleClosed.ok) return scheduleClosed;
    // 只确认「单图」radio，不存草稿：存草稿会清空已设封面并重弹空封面窗，发布必被挡
    if (ctx.cover) {
      const radioOk = await ensureSingleCover(ctx);
      if (!radioOk.ok) return radioOk;
    }
    const cleared = await closeCoverModals(ctx);
    if (!cleared.ok) return cleared;
    const options = await readAi(ctx, true);
    if (!options.ok) return options;
    const ready = await assertPublishReady(ctx);
    if (!ready.ok) return ready;
    if (ctx.schedule) {
      const filled = await runSchedule(ctx);
      if (!filled.ok) return filled;
      // 弹层页脚的主按钮写的是「定时发布」，和页面上开弹层的按钮同名，只能按弹层页脚的构造点
      const confirmed = await confirmScheduleModal(ctx);
      if (!confirmed.ok) return confirmed;
      // 提交后编辑页会跳走，再读 AI 选项只会假阴性；「采用AI生成内容」未勾选已在提交前断言过
      return pass({ mode: "schedule", at: ctx.schedule.text });
    }
    // 注入 XHR hook 抓 publish 真实响应（百家号 publish 静默成功/失败不弹窗）
    const hooked = await page(
      ctx,
      "(() => {" +
      "if (window.__pubHooked) return JSON.stringify({ ok: true, already: true });" +
      "window.__pubHooked = true;" +
      "window.__pubResponses = [];" +
      "const _origOpen = XMLHttpRequest.prototype.open;" +
      "const _origSend = XMLHttpRequest.prototype.send;" +
      "XMLHttpRequest.prototype.open = function(method, url) {" +
      "this.__sparoUrl = url;" +
      "return _origOpen.apply(this, arguments);" +
      "};" +
      "XMLHttpRequest.prototype.send = function() {" +
      "this.addEventListener('load', function() {" +
      "try {" +
      "if (typeof this.__sparoUrl === 'string' && /publish|save|article\\/publish/.test(this.__sparoUrl)) {" +
      "let body = '';" +
      "try { body = this.responseText || ''; } catch(e) {}" +
      "let parsed = null;" +
      "try { parsed = JSON.parse(body); } catch(e) { parsed = null; }" +
      "window.__pubResponses.push({ url: this.__sparoUrl.slice(-80), status: this.status, body: body.slice(0, 500), parsed });" +
      "}" +
      "} catch(e) {}" +
      "});" +
      "return _origSend.apply(this, arguments);" +
      "};" +
      "return JSON.stringify({ ok: true, hooked: true });" +
      "})()",
    );
    // 找发布按钮：poll 3 次，每次 sleep 1000。存草稿后页面可能刷新，按钮需要等一下
    let publish = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      publish = await page(
        ctx,
        "(() => {" +
          "const btn = Array.from(document.querySelectorAll('button'))" +
          ".find(b => (b.innerText||'').replace(/\\s+/g,'').trim()==='发布' && b.getBoundingClientRect().height>0 && !b.disabled);" +
          "if (!btn) return JSON.stringify({ ok:false });" +
          "function fire(el) {" +
          "el.scrollIntoView({ block:'center' });" +
          "const r = el.getBoundingClientRect();" +
          "const o = { bubbles:true, cancelable:true, clientX:r.left+r.width/2, clientY:r.top+r.height/2 };" +
          "el.dispatchEvent(new PointerEvent('pointerdown',o));" +
          "el.dispatchEvent(new MouseEvent('mousedown',o));" +
          "el.dispatchEvent(new PointerEvent('pointerup',o));" +
          "el.dispatchEvent(new MouseEvent('mouseup',o));" +
          "el.click();" +
          "}" +
          "fire(btn);" +
          "return JSON.stringify({ ok:true });" +
          "})()",
      );
      if (publish.stop) return publish.stop;
      if (publish.value?.ok) break;
      if (attempt < 2) await sleep(1000);
    }
    if (!publish.value?.ok) return fail("PUBLISH_BUTTON_MISSING", "发布", await pageHint(ctx));
    // 等 XHR 异步返回
    await sleep(2500);
    // 先读 XHR hook 抓到的 publish 响应
    const hookRead = await page(
      ctx,
      "(() => {" +
      "const resps = window.__pubResponses || [];" +
      "const publishResp = resps.find(r => /publish/.test(r.url || ''));" +
      "if (!publishResp) return JSON.stringify({ ok: true, noHook: true, count: resps.length });" +
      "const p = publishResp.parsed || {};" +
      "const errno = p.errno ?? p.code ?? 0;" +
      "const errmsg = p.errmsg || p.message || p.msg || '';" +
      "const data = p.data || {};" +
      "const articleId = data.article_id || data.id || '';" +
      "const success = errno === 0 || errno === '0' || /success|ok/i.test(errmsg || '');" +
      "return JSON.stringify({ ok: success, errno, errmsg, articleId, body: publishResp.body?.slice(0, 300) || '' });" +
      "})()",
    );
    if (hookRead.stop) return hookRead.stop;
    const hook = hookRead.value || {};
    ctx.articleId = hook.articleId || ctx.articleId;
    if (hook.ok === false) {
      return fail("PUBLISH_REJECTED", hook, "publish 接口返回 errno=" + hook.errno + " " + hook.errmsg);
    }
    // 再读页面弹窗（百家号可能不弹）
    const receipt = await page(
      ctx,
      "(() => {" +
      "const mods = Array.from(document.querySelectorAll('[class*=\"modal\"], [class*=\"toast\"], [role=\"dialog\"]')).filter((el) => el.getBoundingClientRect().height > 20);" +
      "const msgs = mods.map((m) => (m.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 3);" +
      "const ok = /已发布|发布成功|审核中|已提交/.test(msgs.join('|'));" +
      "const err = /封面|图片|校验|未通过|错误|失败/.test(msgs.join('|'));" +
      "return JSON.stringify({ ok, err, msgs, url: location.href.slice(0, 90) });" +
      "})()",
    );
    if (receipt.stop) return receipt.stop;
    if (receipt.value?.err) return fail("PUBLISH_REJECTED", receipt.value, receipt.value.msgs?.join(' | ') || "平台返回错误");
    const human = await guard(ctx);
    if (human) return human;
    const again = await readAi(ctx, false);
    if (!again.ok && again.code !== "AI_CONTROL_MISSING") return again;
    return pass({ mode: "now", receipt: receipt.value || hook, articleId: hook.articleId || "" });
  },

  async verify(ctx) {
    const moved = await nav(this.listUrl, ctx.tabId);
    if (String(moved).startsWith("URL_UNREAD") || String(moved).startsWith("MISMATCH")) return blockedCall(moved);
    // 百家号列表页加载慢，等 3 秒让标题渲染出来
    await sleep(3000);
    const title = JSON.stringify(ctx.title);
    const articleId = JSON.stringify(ctx.articleId || "");
    const script =
      "(() => {" +
      "const want = " + title + ";" +
      "const wantPlain = want.replace(/[《》]/g, '');" +
      "const articleId = " + articleId + ";" +
      "const rows = (document.body?.innerText || '').split('\\n').map((s) => s.trim()).filter(Boolean);" +
      "const idx = rows.findIndex((s) => s === want || (wantPlain && s === wantPlain));" +
      "if (idx < 0) return JSON.stringify({ hit: false, href: location.href });" +
      // 相邻稿大约隔 5 行。只取标题往后 6 行，避开下一篇的状态。
      "const block = rows.slice(idx, idx + 7);" +
      "const joined = block.join('|');" +
      "let status = '';" +
      "if (/审核中/.test(joined)) status = '审核中';" +
      "else if (/已发布|发布成功/.test(joined)) status = '已发布';" +
      "else if (/定时|待发布/.test(joined)) status = '定时';" +
      "const scheduled = (joined.match(/预计\\s*(\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2})/) || [])[1] || '';" +
      "const time = scheduled || (joined.match(/\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}/) || [])[0] || '';" +
      "const linkEl = Array.from(document.querySelectorAll('a')).find((el) => {" +
      "const href = el.href || '';" +
      "if (articleId && href.includes('baijiahao.baidu.com/s?id=' + articleId)) return true;" +
      "const t = (el.innerText || '').trim();" +
      "if (t && (t === want || (wantPlain && t === wantPlain))) return true;" +
      "return false;" +
      "});" +
      "const link = linkEl ? linkEl.href : '';" +
      "return JSON.stringify({ hit: true, link, status, time, href: location.href });" +
      "})()";
    const read = await page(ctx, script);
    if (read.stop) return read.stop;
    if (!read.value?.hit) {
      // 再等 2 秒重试一次
      await sleep(2000);
      const retry = await page(ctx, script);
      if (retry.stop) return retry.stop;
      if (!retry.value?.hit) return fail("LIST_ROW_MISSING", retry.value, "列表里没有这篇标题（已等 5s）");
      read.value = retry.value;
    }
    const link = read.value.link || (/审核中|定时/.test(read.value.status || "") ? "待回访" : "");
    if (!link) return fail("LINK_UNREAD", read.value, "没有公开链接，也不是审核中或定时");
    return pass({
      platform: this.id,
      title: ctx.title,
      time: read.value.time || ctx.schedule?.text || "",
      status: read.value.status || "待回访",
      images: ctx.imageCount || 0,
      link,
      href: read.value.href,
      options: ctx.options || null,
    });
  },

  async probe(ctx) {
    const read = await page(
      ctx,
      "(() => JSON.stringify({" +
        "href: location.href," +
        "lexical: !!document.querySelector('[data-lexical-editor=\"true\"]')," +
        "ueditor: !!(window.UE_V2 && window.UE_V2.instants) || !!document.querySelector('#ueditor_0')" +
        "}))()",
    );
    if (read.stop) return read.stop;
    return pass(read.value);
  },
};

async function ueApiScript(html) {
  return (
    "(() => {" +
    "const named = window.UE_V2 && window.UE_V2.instants && (window.UE_V2.instants.ueditorInstant0 || window.UE_V2.instants['ueditorInstant0']);" +
    "const fallback = window.UE && window.UE.getEditor && window.UE.getEditor('ueditor_0');" +
    "const ue = (named && named.setContent) ? named : fallback;" +
    "if (!ue || typeof ue.setContent !== 'function') return JSON.stringify({ ok: false, code: 'NO_UE' });" +
    "const iframe = document.querySelector('#ueditor_0');" +
    "const iframeBody = iframe?.contentDocument?.body;" +
    "if (!iframeBody) return JSON.stringify({ ok: false, code: 'NO_IFRAME' });" +
    "const html = " + JSON.stringify(html) + ";" +
    "ue.setContent(html);" +
    "let len = (ue.getContent ? (ue.getContent() || '').length : 0);" +
    "if (len === 0) len = iframeBody.innerText?.length || 0;" +
    "if (len === 0) len = ue.getContentLength ? ue.getContentLength(true) : 0;" +
    "return JSON.stringify({ ok: len > 0, len, args: 1 });" +
    "})()"
  );
}

async function setUeContent(ctx, html) {
  const setScript =
    "(() => {" +
    "const named = window.UE_V2 && window.UE_V2.instants && (window.UE_V2.instants.ueditorInstant0 || window.UE_V2.instants['ueditorInstant0']);" +
    "const fallback = window.UE && window.UE.getEditor && window.UE.getEditor('ueditor_0');" +
    "const ue = (named && named.setContent) ? named : fallback;" +
    "if (!ue || typeof ue.setContent !== 'function') return JSON.stringify({ ok: false, code: 'NO_UE' });" +
    "ue.setContent(" + JSON.stringify(html) + ");" +
    "return JSON.stringify({ ok: true });" +
    "})()";
  let set;
  for (let i = 0; i < 5; i++) {
    set = await page(ctx, setScript);
    if (set.stop) return set.stop;
    if (set.value?.ok) break;
    await sleep(500);
  }
  if (!set.value?.ok) return fail(set.value?.code || "NO_UE", set.value, "UEditor 不可用");
  await sleep(600);
  const checkScript =
    "(() => {" +
    "const named = window.UE_V2 && window.UE_V2.instants && (window.UE_V2.instants.ueditorInstant0 || window.UE_V2.instants['ueditorInstant0']);" +
    "const fallback = window.UE && window.UE.getEditor && window.UE.getEditor('ueditor_0');" +
    "const ue = (named && named.setContent) ? named : fallback;" +
    "const iframe = document.querySelector('#ueditor_0');" +
    "const iframeBody = iframe?.contentDocument?.body;" +
    "let len = ue && ue.getContent ? (ue.getContent() || '').length : 0;" +
    "if (len === 0) len = iframeBody?.innerText?.length || 0;" +
    "if (len === 0 && ue && ue.getContentLength) len = ue.getContentLength(true);" +
    "return JSON.stringify({ ok: len > 0, len });" +
    "})()";
  const read = await page(ctx, checkScript);
  if (read.stop) return read.stop;
  if (!read.value?.ok) return fail("BODY_UNREAD", read.value, "UEditor setContent 没有写上");
  return pass(read.value);
}

/** 发布前回读。不过就不点发布按钮，也不在这里改选项。 */
async function assertPublishReady(ctx) {
  const read = await page(
    ctx,
    "(() => {" +
      "const iframe = document.querySelector('#ueditor_0');" +
      "const body = iframe && iframe.contentDocument && iframe.contentDocument.body;" +
      "const blob = ((body && body.innerText) || '') + ((body && body.innerHTML) || '');" +
      "const markers = blob.includes('@@IMG');" +
      "const images = body ? body.querySelectorAll('img').length : 0;" +
      "const box = document.querySelector('#bjhNewsCover');" +
      "const coverImgs = box ? Array.from(box.querySelectorAll('img')).filter((img) => { const r = img.getBoundingClientRect(); return r.width > 8 && r.height > 8; }).length : 0;" +
      "const one = box ? box.querySelector('input[type=radio][value=\"one\"]') : null;" +
      "const hits = Array.from(document.querySelectorAll('label')).filter((el) => /采用\\s*AI\\s*生成|AI\\s*生成内容/.test(el.innerText || ''));" +
      "const aiChecked = hits.some((label) => { const input = label.querySelector('input'); return !!(input && input.checked); });" +
      "return JSON.stringify({ markers, images, coverImgs, singleOn: !!(one && one.checked), aiFound: hits.length > 0, aiChecked });" +
      "})()",
  );
  if (read.stop) return read.stop;
  const state = read.value || {};
  if (state.markers) return fail("MARKERS_LEFT", state, "正文还有 @@IMG 标记");
  if (ctx.images.length && state.images !== ctx.images.length) return fail("IMAGE_COUNT_MISMATCH", state, "正文图片张数和文件数不一致");
  if (state.coverImgs !== 1 || !state.singleOn) return fail("COVER_REQUIRED", state, "封面不是单图");
  if (!state.aiFound || state.aiChecked) return fail("OPTIONS_MISMATCH", state, "采用AI生成内容不是未勾选");
  return pass(state);
}

async function readAi(ctx, fix) {
  const script =
    "(() => {" +
    "window.scrollTo(0, 0);" +
    "const labels = Array.from(document.querySelectorAll('label'));" +
    "const hits = labels.filter((el) => /采用\\s*AI\\s*生成|AI\\s*生成内容/.test(el.innerText || ''));" +
    "if (!hits.length) return JSON.stringify({ found: false, checked: false });" +
    (fix
      ? "for (const label of hits) { const input = label.querySelector('input'); if (input && input.checked) label.click(); }"
      : "") +
    "const checked = hits.some((label) => label.querySelector('input')?.checked);" +
    "return JSON.stringify({ found: true, checked });" +
    "})()";
  // 封面确定后 React 会重渲染，选项可能有一瞬间不在 DOM 里，轮询几次再判缺失
  for (let attempt = 0; attempt < 6; attempt++) {
    const read = await page(ctx, script);
    if (read.stop) return read.stop;
    if (read.value?.found) {
      if (read.value.checked) return fail("AI_STILL_CHECKED", read.value, "采用AI生成内容仍是勾选状态");
      return pass({ aiChecked: false });
    }
    await sleep(500);
  }
  return fail("AI_CONTROL_MISSING", "", "没有找到「采用AI生成内容」，不能证明它没被勾上");
}

/** 发布前把残留的封面弹窗用真实点击关掉。JS 模拟点击对 cheetah 弹窗无效。 */
async function closeCoverModals(ctx) {
  const openCount = async () => {
    const read = await page(
      ctx,
      "(() => {" +
        "const wraps = Array.from(document.querySelectorAll('.cheetah-modal-wrap')).filter((m) => m.getBoundingClientRect().height > 8);" +
        "return JSON.stringify({ open: wraps.length });" +
        "})()",
    );
    return read.stop ? -1 : read.value?.open || 0;
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await openCount()) === 0) return pass({ closed: true });
    const raw = await click(".cheetah-modal-wrap .cheetah-modal-close", ctx.tabId);
    if (!/"ok"\s*:\s*true/.test(String(raw))) {
      const cancel = await clickLabeled(ctx, "取消");
      if (!cancel.ok) return fail("COVER_MODAL_STUCK", { open: true }, "封面弹窗关不掉，发布会一直被挡");
    }
    await sleep(700);
  }
  if ((await openCount()) === 0) return pass({ closed: true });
  return fail("COVER_MODAL_STUCK", { open: true }, "封面弹窗关不掉，发布会一直被挡");
}

async function ensureSingleCover(ctx) {
  const script =
    "(() => {" +
    "function fire(el) { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const o = { bubbles:true, cancelable:true, clientX:r.left+r.width/2, clientY:r.top+r.height/2 }; el.dispatchEvent(new PointerEvent('pointerdown',o)); el.dispatchEvent(new MouseEvent('mousedown',o)); el.dispatchEvent(new PointerEvent('pointerup',o)); el.dispatchEvent(new MouseEvent('mouseup',o)); el.click(); }" +
    "const box = document.querySelector('#bjhNewsCover');" +
    "if (!box) return JSON.stringify({ ok:false, code:'NO_COVER_BOX' });" +
    "const radios = Array.from(box.querySelectorAll('input[type=radio]'));" +
    "const one = radios.find(r => r.value === 'one');" +
    "if (!one) return JSON.stringify({ ok:false, code:'NO_RADIO_ONE' });" +
    "if (!one.checked) { const lbl = one.closest('label') || one.parentElement; if (lbl) fire(lbl); else fire(one); }" +
    "return JSON.stringify({ ok:true, checked: one.checked || true });" +
    "})()";
  const read = await page(ctx, script);
  if (read.stop) return read.stop;
  if (!read.value?.ok) return fail(read.value?.code || "COVER_RADIO_UNREAD", read.value, "百家号「单图」封面 radio 没选中");
  return pass({ coverLayout: "one" });
}

async function tryOpenCoverDialog(ctx) {
  const script =
    "(() => {" +
    "function fire(el) { el.scrollIntoView({ block:'center' }); const r=el.getBoundingClientRect(); const o={bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}; el.dispatchEvent(new PointerEvent('pointerdown',o)); el.dispatchEvent(new MouseEvent('mousedown',o)); el.dispatchEvent(new PointerEvent('pointerup',o)); el.dispatchEvent(new MouseEvent('mouseup',o)); el.click(); }" +
    "window.scrollTo(0, document.body.scrollHeight);" +
    "const el = Array.from(document.querySelectorAll('*')).find(e => {" +
    "  const t=(e.innerText||e.textContent||'').trim();" +
    "  return (t==='选择封面'||t==='更换') && getComputedStyle(e).cursor==='pointer';" +
    "});" +
    "if (!el) return JSON.stringify({ ok:false });" +
    "fire(el);" +
    "return JSON.stringify({ ok:true });" +
    "})()";
  const opened = await page(ctx, script);
  if (opened.stop) return opened.stop;
  if (!opened.value?.ok) return fail("COVER_ENTRY_MISSING", "选择封面", await pageHint(ctx));
  await sleep(1200);
  // 确认弹窗真的打开了：有 accept="image/*" 的 file input 或可见 modal
  const confirmScript =
    "(() => {" +
    "const input = !!document.querySelector('input[type=file][accept*=\"image\"]');" +
    "const modal = Array.from(document.querySelectorAll('[class*=\"modal\"]')).some(m => m.getBoundingClientRect().height > 100);" +
    "return JSON.stringify({ input, modal });" +
    "})()";
  const confirmRead = await page(ctx, confirmScript);
  if (confirmRead.stop) return confirmRead.stop;
  if (!confirmRead.value?.input && !confirmRead.value?.modal) return fail("COVER_DIALOG_NOT_OPEN", confirmRead.value, "封面弹窗没真的打开");
  return pass({ opened: true });
}
