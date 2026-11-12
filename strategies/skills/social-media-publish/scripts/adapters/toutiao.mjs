// 今日头条。封面是硬校验；广告收益必须回读为已勾。
// 定时是两步：编辑页「定时发布」→ 弹层选时间 →「预览并定时发布」进预览页 → 预览页底栏「定时发布」才真正提交。
// 提交后跳 /graphic/articles，那里看不到定时稿；定时稿只在 /manage/content/all 显示「定时发布中」。
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
  readHref,
  setNativeValue,
  sleep,
  uploadPicked,
  waitEditor,
} from "../page.mjs";
import { click, nav } from "../sparo.mjs";
import { loadProfile } from "../profile.mjs";

const MANAGE_URL = "https://mp.toutiao.com/profile_v4/manage/content/all?enter_from=left_menu";
const profile = loadProfile("toutiao");
const AD_LABEL = profile.switches.required.find((item) => item.id === "ad").label;

export const toutiao = {
  id: profile.id,
  host: profile.entry.host,
  writeUrl: profile.entry.writeUrl,
  writeMark: "/graphic/publish",
  listUrl: profile.entry.listUrl,

  async openBlank(ctx) {
    const opened = await openWriteTab(ctx);
    if (!opened.ok) return opened;
    const editor = await waitEditor(ctx, ".ProseMirror");
    if (!editor.ok) return editor;
    const cover = await waitEditor(ctx, ".article-cover-add");
    if (!cover.ok) return cover;
    return pass({ tabId: ctx.tabId, href: editor.detail.href });
  },

  async readTitle(ctx) {
    const read = await page(
      ctx,
      "(() => { const el = document.querySelector('textarea[placeholder*=\"标题\"], input[placeholder*=\"标题\"]'); return JSON.stringify({ href: location.href, title: (el && el.value || '').trim() }); })()",
    );
    if (read.stop) return read.stop;
    return pass(read.value || {});
  },

  async fillTitle(ctx) {
    const selectors = [
      'textarea[placeholder*="请输入文章标题"]',
      'input[placeholder*="请输入文章标题"]',
      'textarea[placeholder*="标题"]',
    ];
    let last = null;
    for (const selector of selectors) {
      last = await page(ctx, setNativeValue(selector, ctx.title));
      if (last.stop) return last.stop;
      if (last.value?.ok) return pass({ len: last.value.len, selector });
    }
    return fail("TITLE_UNREAD", last?.value || "NO_INPUT", "标题回读不一致");
  },

  async fillBody(ctx) {
    const script =
      "(() => {" +
      "const pm = document.querySelector('.ProseMirror');" +
      "if (!pm) return JSON.stringify({ ok: false, code: 'NO_EDITOR' });" +
      "pm.focus();" +
      "const html = " + JSON.stringify(ctx.bodyHtml) + ";" +
      "const plain = " + JSON.stringify(ctx.body) + ";" +
      "const dt = new DataTransfer();" +
      "dt.setData('text/html', html);" +
      "dt.setData('text/plain', plain);" +
      "pm.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));" +
      "if ((pm.innerText || '').trim().length < Math.min(20, plain.length)) {" +
      "document.execCommand('insertHTML', false, html);" +
      "}" +
      "const len = (pm.innerText || '').trim().length;" +
      "return JSON.stringify({ ok: len > 0, len });" +
      "})()";
    const read = await page(ctx, script);
    if (read.stop) return read.stop;
    if (!read.value?.ok) return fail("BODY_UNREAD", read.value, "正文没有写进去");
    return pass({ len: read.value.len });
  },

  async insertImages(ctx) {
    if (!ctx.images.length) {
      ctx.imageCount = 0;
      return pass({ count: 0 });
    }
    const initial = await readPgcCount(ctx);
    if (initial.stop) return initial.stop;
    const existing = Math.min(initial.value?.count || 0, ctx.images.length);
    if (existing >= ctx.images.length) {
      ctx.imageCount = existing;
      return pass({ count: existing, reused: true });
    }
    // 创作助手抽屉的遮罩会抢走段落点击：先关掉，再谈光标和插图。
    const assistant = await closeAiAssistant(ctx);
    if (!assistant.ok) return assistant;
    // 多图从后往前插，段落位置不被前一张图改变；续跑时保留已经回读到的前几张。
    for (let index = ctx.images.length - 1; index >= existing; index--) {
      const file = ctx.images[index];
      const before = await readPgcCount(ctx);
      if (before.stop) return before.stop;
      const opened = await openImageDrawerAt(ctx, index, ctx.images.length);
      if (!opened.ok) return opened;
      const entry = await ensureUploadEntry(ctx);
      if (!entry.ok) return entry;
      const blocked = await guard(ctx);
      if (blocked) return blocked;
      const uploaded = await uploadPicked(ctx, file, ".mp-ic-img-drawer", true);
      if (!uploaded.ok) return uploaded;
      const ready = await waitImageConfirm(ctx);
      if (!ready.ok) return ready;
      const inserted = await confirmImageInsert(ctx, before.value?.count || 0);
      if (!inserted.ok) return inserted;
    }
    const count = await readPgcCount(ctx);
    if (count.stop) return count.stop;
    ctx.imageCount = count.value?.count || 0;
    if (ctx.imageCount < ctx.images.length) return fail("IMAGES_UNREAD", count.value, "正文图数量少于本地配图数");
    return pass({ count: ctx.imageCount });
  },

  async setCover(ctx) {
    const assistant = await closeAiAssistant(ctx);
    if (!assistant.ok) return assistant;
    const prep = await page(
      ctx,
      "(() => {" +
        "function visible(el) { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; }" +
        "function inView(el) { const r = el.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth && r.width > 2 && r.height > 2; }" +
        "function scrollInner(el) {" +
        "el.scrollIntoView({ block: 'center', inline: 'nearest' });" +
        "let parent = el.parentElement;" +
        "while (parent) {" +
        "const st = getComputedStyle(parent);" +
        "if (/(auto|scroll)/.test(st.overflowY) && parent.scrollHeight > parent.clientHeight + 4) {" +
        "const pr = parent.getBoundingClientRect(); const er = el.getBoundingClientRect();" +
        "parent.scrollTop += er.top - pr.top - parent.clientHeight / 2;" +
        "}" +
        "parent = parent.parentElement;" +
        "}" +
        "}" +
        "const group = document.querySelector('.article-cover-radio-group');" +
        "if (group) scrollInner(group);" +
        "const single = group && group.querySelector('input[value=\"2\"]');" +
        "if (single && !single.checked) (single.closest('label') || single).click();" +
        "const cover = document.querySelector('.article-cover') || group;" +
        "const extra = cover ? Array.from(cover.querySelectorAll('button, [role=button], div, span')).filter((el) => /上传封面|选择封面|本地上传/.test((el.innerText || '').replace(/\\s+/g, ''))) : [];" +
        "const candidates = [document.querySelector('.article-cover-img-replace'), ...extra, document.querySelector('.article-cover-add')].filter(Boolean);" +
        "for (const btn of candidates) {" +
        "scrollInner(btn);" +
        "if (!inView(btn)) continue;" +
        "btn.click();" +
        "const drawer = document.querySelector('.mp-ic-img-drawer');" +
        "if (drawer && visible(drawer)) return JSON.stringify({ ok: true });" +
        "const assistant = Array.from(document.querySelectorAll('aside, [class*=\"assistant\"]')).find((el) => visible(el) && /创作助手/.test(el.innerText || ''));" +
        "const close = assistant && assistant.querySelector('[aria-label=\"关闭\"], [class*=\"close\"], button');" +
        "if (close) close.click();" +
        "}" +
        "const drawer = document.querySelector('.mp-ic-img-drawer');" +
        "return JSON.stringify({ ok: !!(drawer && visible(drawer)) });" +
        "})()",
    );
    if (prep.stop) return prep.stop;
    if (!prep.value?.ok) return fail("COVER_ENTRY_MISSING", "mp-ic-img-drawer", "封面入口没有打开图片抽屉");
    const entry = await ensureUploadEntry(ctx);
    if (!entry.ok) return entry;
    const blocked = await guard(ctx);
    if (blocked) return blocked;
    const uploaded = await uploadPicked(ctx, ctx.cover, ".mp-ic-img-drawer", true);
    if (!uploaded.ok) return uploaded;
    // 等抽屉里出现缩略图再确认，早了会点空
    for (let i = 0; i < 100; i++) {
      const ready = await page(
        ctx,
        "(() => { const d = document.querySelector('.mp-ic-img-drawer'); const thumbs = d ? Array.from(d.querySelectorAll('img,.img-span')).filter((el) => { const r = el.getBoundingClientRect(); if (r.width < 8 || r.height < 8) return false; return el.tagName === 'IMG' ? (el.complete && el.naturalWidth > 0) : (getComputedStyle(el).backgroundImage || '').includes('url('); }) : []; return JSON.stringify({ n: thumbs.length }); })()",
      );
      if (ready.stop) return ready.stop;
      if ((ready.value?.n || 0) > 0) break;
      await sleep(400);
    }
    const confirmed = await page(ctx, confirmCoverScript(".mp-ic-img-drawer"));
    if (confirmed.stop) return confirmed.stop;
    if (!confirmed.value?.ok) return fail(confirmed.value?.code || "COVER_THUMB_MISSING", confirmed.value, "封面缩略图没有点中，不能确认");
    const check = await page(
      ctx,
      "(() => JSON.stringify({ n: document.querySelectorAll('.article-cover img').length }))()",
    );
    if (check.stop) return check.stop;
    ctx.coverCount = check.value?.n || 0;
    if (!ctx.coverCount) return fail("COVER_UNREAD", check.value, "封面回读没有图片");
    return pass({ cover: ctx.coverCount });
  },

  async setOptions(ctx) {
    // 已断言：投放广告赚收益是 radio，只确保选中。头条首发若已选中则不点，标 firstLaunch。赞赏、微头条、作品声明、打赏需人工补。
    const readScript =
      "(() => {" +
      "const innerHeight = window.innerHeight || 0;" +
      "if (!innerHeight) return JSON.stringify({ code: 'RENDER_NOT_READY', innerHeight: 0 });" +
      "const radios = Array.from(document.querySelectorAll('input[type=\"radio\"]')).map((input) => {" +
      "const label = input.closest('label');" +
      "return { value: input.value || '', checked: !!input.checked, text: ((label && label.innerText) || '').replace(/\\s+/g, '') };" +
      "});" +
      "const ad = radios.find((item) => item.text.includes(" + JSON.stringify(AD_LABEL) + "));" +
      "const firstLabel = Array.from(document.querySelectorAll('label')).find((el) => (el.innerText || '').replace(/\\s+/g, '').includes('头条首发'));" +
      "const firstInput = firstLabel ? firstLabel.querySelector('input') : null;" +
      "return JSON.stringify({" +
      "innerHeight," +
      "adFound: !!ad," +
      "adChecked: !!(ad && ad.checked)," +
      "adValue: ad ? ad.value : ''," +
      "firstFound: !!firstLabel," +
      "firstChecked: !!(firstInput && firstInput.checked)," +
      "firstLaunch: !!(firstInput && firstInput.checked)," +
      "radios" +
      "});" +
      "})()";
    const selectScript =
      "(() => {" +
      "const label = Array.from(document.querySelectorAll('label')).find((el) => (el.innerText || '').includes(" + JSON.stringify(AD_LABEL) + "));" +
      "const input = label ? label.querySelector('input[type=\"radio\"]') : null;" +
      "if (!label || !input) return JSON.stringify({ ok: false });" +
      "if (!input.checked) label.click();" +
      "return JSON.stringify({ ok: true, checked: !!input.checked });" +
      "})()";
    let state = {};
    const deadline = Date.now() + 8000;
    while (Date.now() <= deadline) {
      const read = await page(ctx, readScript);
      if (read.stop) return read.stop;
      if (read.value?.code === "RENDER_NOT_READY") return fail("RENDER_NOT_READY", read.value, "编辑标签还没有布局");
      state = read.value || {};
      if (state.adFound) break;
      await sleep(300);
    }
    ctx.options = state;
    if (!state.adFound) return fail("AD_CONTROL_MISSING", state, "没有找到「" + AD_LABEL + "」");
    if (!state.adChecked) {
      const selected = await page(ctx, selectScript);
      if (selected.stop) return selected.stop;
      const againDeadline = Date.now() + 3000;
      while (Date.now() <= againDeadline) {
        await sleep(300);
        const again = await page(ctx, readScript);
        if (again.stop) return again.stop;
        state = again.value || {};
        if (state.adChecked) break;
      }
    }
    ctx.options = state;
    if (!state.adChecked) return fail("AD_ASSERT_FAIL", state, AD_LABEL + "没有选中");
    return pass(state);
  },

  async publishOrSchedule(ctx) {
    const blocked = await guard(ctx);
    if (blocked) return blocked;
    const options = await this.setOptions(ctx);
    if (!options.ok) return options;
    if (ctx.schedule) return schedule(ctx);
    const preview = await clickLabeled(ctx, "预览并发布");
    if (!preview.ok) return fail("PUBLISH_BUTTON_MISSING", "预览并发布", await pageHint(ctx));
    await sleep(1200);
    const human = await guard(ctx);
    if (human) return human;
    const confirm = await clickLabeled(ctx, "确认发布");
    if (!confirm.ok) return fail("PUBLISH_CONFIRM_MISSING", "确认发布", await pageHint(ctx));
    await sleep(1500);
    const after = await guard(ctx);
    if (after) return after;
    return pass({ mode: "now" });
  },

  async verify(ctx) {
    if (ctx.schedule) return verifyScheduled(ctx);
    const moved = await nav(this.listUrl, ctx.tabId);
    if (String(moved).startsWith("URL_UNREAD") || String(moved).startsWith("MISMATCH")) return blockedCall(moved);
    await sleep(1500);
    return readReceipt(ctx, this.id);
  },

  async probe(ctx) {
    const read = await page(
      ctx,
      "(() => JSON.stringify({" +
        "href: location.href," +
        "title: !!document.querySelector('textarea[placeholder*=\"标题\"], input[placeholder*=\"标题\"]')," +
        "body: !!document.querySelector('.ProseMirror')," +
        "image: !!document.querySelector('.syl-toolbar-tool.image .syl-toolbar-button')," +
        "cover: !!document.querySelector('.article-cover-add, .article-cover-img-replace')," +
        "ad: Array.from(document.querySelectorAll('label')).some((el) => (el.innerText || '').includes(" + JSON.stringify(AD_LABEL) + "))" +
        "}))()",
    );
    if (read.stop) return read.stop;
    return pass(read.value);
  },
};

async function readPgcCount(ctx) {
  return page(
    ctx,
    "(() => { const pm = document.querySelector('.ProseMirror'); return JSON.stringify({ href: location.href, count: pm ? pm.querySelectorAll('.pgc-img').length : 0, imgs: pm ? pm.querySelectorAll('img').length : 0 }); })()",
  );
}

async function closeAiAssistant(ctx) {
  const marked = await page(
    ctx,
    "(() => {" +
      "const drawer = document.querySelector('.ai-assistant-drawer');" +
      "const rect = drawer && drawer.getBoundingClientRect();" +
      "if (!drawer || !rect || rect.width <= 2 || rect.height <= 2) return JSON.stringify({ ok: true, closed: true });" +
      "const btn = drawer.querySelector('.close-btn');" +
      "if (!btn) return JSON.stringify({ ok: false, code: 'ASSISTANT_CLOSE_MISSING' });" +
      "btn.setAttribute('data-sparo-assistant-close', '1');" +
      "return JSON.stringify({ ok: true, closed: false });" +
      "})()",
  );
  if (marked.stop) return marked.stop;
  if (!marked.value?.ok) return fail(marked.value?.code || "ASSISTANT_CLOSE_MISSING", marked.value, "创作助手遮罩找不到关闭按钮");
  if (marked.value.closed) return pass({ closed: true });
  // 点击回包偶发空串，不代表没点上。先看抽屉还在不在，还在才再点一次。
  let raw = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    raw = await click("[data-sparo-assistant-close]", ctx.tabId, ctx.host);
    const stopped = blockedCall(raw);
    if (stopped) return stopped;
    if (/\"ok\"\s*:\s*true/.test(String(raw))) break;
    await sleep(300);
    const early = await page(
      ctx,
      "(() => { const d = document.querySelector('.ai-assistant-drawer'); const r = d && d.getBoundingClientRect(); return JSON.stringify({ visible: !!(r && r.width > 2 && r.height > 2) }); })()",
    );
    if (early.stop) return early.stop;
    if (!early.value?.visible) return pass({ closed: true, retried: true });
    if (attempt === 1) return fail("ASSISTANT_CLOSE_FAILED", raw, "创作助手关闭点击没有成功（两次空包，抽屉仍可见）");
    await sleep(500);
  }
  await sleep(500);
  const state = await page(
    ctx,
    "(() => { const d = document.querySelector('.ai-assistant-drawer'); const r = d && d.getBoundingClientRect(); return JSON.stringify({ visible: !!(r && r.width > 2 && r.height > 2) }); })()",
  );
  if (state.stop) return state.stop;
  if (state.value?.visible) return fail("ASSISTANT_STILL_OPEN", state.value, "创作助手遮罩仍未关闭");
  return pass({ closed: true });
}

async function openImageDrawerAt(ctx, index, total) {
  const marked = await page(
    ctx,
    "(() => {" +
      "const pm = document.querySelector('.ProseMirror');" +
      "if (!pm) return JSON.stringify({ ok: false, code: 'NO_EDITOR' });" +
      "document.querySelectorAll('[data-sparo-caret]').forEach((el) => el.removeAttribute('data-sparo-caret'));" +
      "const paras = Array.from(pm.querySelectorAll('p')).filter((el) => !el.closest('.pgc-img') && (el.innerText || '').trim());" +
      "if (!paras.length) return JSON.stringify({ ok: false, code: 'NO_PARAGRAPH' });" +
      "const at = Math.min(paras.length - 1, Math.max(0, Math.round(((" + (index + 1) + ") * paras.length) / (" + (total + 1) + ")) - 1));" +
      "const target = paras[at];" +
      "target.setAttribute('data-sparo-caret', '1');" +
      "target.scrollIntoView({ block: 'center' });" +
      "return JSON.stringify({ ok: true, at, total: paras.length, text: (target.innerText || '').slice(0, 100) });" +
      "})()",
  );
  if (marked.stop) return marked.stop;
  if (!marked.value?.ok) return fail(marked.value?.code || "NO_PARAGRAPH", marked.value, "正文里找不到插图段落");
  const caret = await click({ selector: "[data-sparo-caret]", caret: true }, ctx.tabId, ctx.host);
  const caretStopped = blockedCall(caret);
  if (caretStopped) return caretStopped;
  if (!/\"ok\"\s*:\s*true/.test(String(caret))) return fail("IMAGE_CARET_CLICK_FAILED", caret, "段落真实点击没有成功");
  await sleep(300);
  const selection = await page(
    ctx,
    "(() => {" +
      "const sel = window.getSelection(); const node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;" +
      "const el = node ? (node.nodeType === 1 ? node : node.parentElement) : null;" +
      "return JSON.stringify({ inMarked: !!(el && el.closest('[data-sparo-caret]')), paragraph: (el && el.closest('p')?.innerText || '').slice(0, 100), parent: el ? el.outerHTML.slice(0, 200) : '' });" +
      "})()",
  );
  if (selection.stop) return selection.stop;
  if (!selection.value?.inMarked) return fail("IMAGE_CARET_UNPROVEN", { target: marked.value, selection: selection.value }, "真实点击后光标不在目标段落，停止插图");
  const opened = await click(".syl-toolbar-tool.image .syl-toolbar-button", ctx.tabId, ctx.host);
  const openStopped = blockedCall(opened);
  if (openStopped) return openStopped;
  if (!/\"ok\"\s*:\s*true/.test(String(opened))) return fail("IMAGE_ENTRY_MISSING", opened, "头条插图按钮真实点击没有成功");
  let last = null;
  for (let i = 0; i < 15; i++) {
    last = await page(
      ctx,
      "(() => { const d = document.querySelector('.mp-ic-img-drawer'); const r = d && d.getBoundingClientRect(); return JSON.stringify({ visible: !!(r && r.width > 2 && r.height > 2) }); })()",
    );
    if (last.stop) return last.stop;
    if (last.value?.visible) return pass({ target: marked.value, selection: selection.value });
    await sleep(200);
  }
  return fail("IMAGE_ENTRY_MISSING", last?.value, "点了插图按钮但图片抽屉没有出现");
}

function readImageDrawerScript() {
  return (
    "(() => {" +
    "const d = document.querySelector('.mp-ic-img-drawer'); const r = d && d.getBoundingClientRect();" +
    "if (!d || !r || r.width <= 2 || r.height <= 2) return JSON.stringify({ ok: false, code: 'IMAGE_DRAWER_CLOSED' });" +
    "const text = d.innerText || '';" +
    "const confirm = Array.from(d.querySelectorAll('button,[role=button]')).find((el) => /^确定(?:\\(\\d+\\))?$/.test((el.innerText || '').replace(/\\s+/g, '')));" +
    "const imgs = Array.from(d.querySelectorAll('img')).filter((img) => img.complete && img.naturalWidth > 0);" +
    "return JSON.stringify({ ok: true, uploaded: /已上传\\s*\\d+\\s*张图片/.test(text), thumbs: imgs.length, confirm: confirm ? { disabled: !!confirm.disabled, aria: confirm.getAttribute('aria-disabled'), cls: String(confirm.className), text: (confirm.innerText || '').replace(/\\s+/g, '') } : null, text: text.slice(-400) });" +
    "})()"
  );
}

async function waitImageConfirm(ctx) {
  let last = null;
  let thumbClicked = false;
  for (let i = 0; i < 100; i++) {
    const state = await page(ctx, readImageDrawerScript());
    if (state.stop) return state.stop;
    last = state.value;
    if (!last?.ok) return fail(last?.code || "IMAGE_DRAWER_CLOSED", last, "上传后图片抽屉提前关闭，停止确认");
    const c = last.confirm;
    const enabled = c && !c.disabled && c.aria !== "true" && !/disabled/.test(c.cls);
    if (last.uploaded && last.thumbs > 0 && enabled) {
      const marked = await page(
        ctx,
        "(() => {" +
          "const d = document.querySelector('.mp-ic-img-drawer');" +
          "const b = d && Array.from(d.querySelectorAll('button,[role=button]')).find((el) => /^确定(?:\\(\\d+\\))?$/.test((el.innerText || '').replace(/\\s+/g, '')) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');" +
          "if (!b) return JSON.stringify({ ok: false });" +
          "b.setAttribute('data-sparo-image-confirm', '1');" +
          "return JSON.stringify({ ok: true });" +
          "})()",
      );
      if (marked.stop) return marked.stop;
      if (marked.value?.ok) return pass({ ...last, thumbClicked });
    }
    if (last.uploaded && last.thumbs > 0 && c && !enabled && !thumbClicked) {
      const thumb = await page(
        ctx,
        "(() => {" +
          "const d = document.querySelector('.mp-ic-img-drawer');" +
          "const imgs = d ? Array.from(d.querySelectorAll('img')).filter((img) => img.complete && img.naturalWidth > 0) : [];" +
          "const img = imgs[imgs.length - 1];" +
          "if (!img) return JSON.stringify({ ok: false, code: 'NO_THUMB' });" +
          "img.setAttribute('data-sparo-image-thumb', '1');" +
          "return JSON.stringify({ ok: true, thumbs: imgs.length });" +
          "})()",
      );
      if (thumb.stop) return thumb.stop;
      // ProseMirror/抽屉会重渲染，上一拍读到的缩略图这一拍可能刚换 DOM；下一拍重读，不上传第二次。
      if (!thumb.value?.ok) {
        await sleep(400);
        continue;
      }
      const picked = await click("[data-sparo-image-thumb]", ctx.tabId, ctx.host);
      const pickStopped = blockedCall(picked);
      if (pickStopped) return pickStopped;
      if (!/\"ok\"\s*:\s*true/.test(String(picked))) return fail("IMAGE_THUMB_CLICK_FAILED", picked, "刚上传的缩略图没有点中");
      thumbClicked = true;
    }
    await sleep(400);
  }
  return fail(last?.confirm ? "IMAGE_CONFIRM_DISABLED" : "IMAGE_CONFIRM_MISSING", last, "上传完成、缩略图加载且确定可用之后才允许确认");
}

async function confirmImageInsert(ctx, before) {
  // 空包先看抽屉是否已关、正文图是否已增加。两次都没生效才失败，避免空回执直接停。
  let raw = "";
  let clickSucceeded = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    raw = await click("[data-sparo-image-confirm]", ctx.tabId, ctx.host);
    const stopped = blockedCall(raw);
    if (stopped) return stopped;
    if (/\"ok\"\s*:\s*true/.test(String(raw))) {
      clickSucceeded = true;
      break;
    }
    await sleep(400);
    const probe = await page(
      ctx,
      "(() => { const d = document.querySelector('.mp-ic-img-drawer'); const r = d && d.getBoundingClientRect(); const pm = document.querySelector('.ProseMirror'); return JSON.stringify({ drawerVisible: !!(r && r.width > 2 && r.height > 2), count: pm ? pm.querySelectorAll('.pgc-img').length : 0 }); })()",
    );
    if (probe.stop) return probe.stop;
    if (!probe.value?.drawerVisible && (probe.value?.count || 0) > before) {
      return pass({ before, ...probe.value, retried: true });
    }
    if (attempt === 1) return fail("IMAGE_CONFIRM_CLICK_FAILED", raw, "图片确定按钮真实点击没有成功（两次空包）");
  }
  if (!clickSucceeded) return fail("IMAGE_CONFIRM_CLICK_FAILED", raw, "图片确定按钮真实点击没有成功（两次空包）");
  let last = null;
  for (let i = 0; i < 20; i++) {
    last = await page(
      ctx,
      "(() => {" +
        "const d = document.querySelector('.mp-ic-img-drawer'); const r = d && d.getBoundingClientRect();" +
        "const pm = document.querySelector('.ProseMirror');" +
        "return JSON.stringify({ drawerVisible: !!(r && r.width > 2 && r.height > 2), count: pm ? pm.querySelectorAll('.pgc-img').length : 0, imgs: pm ? pm.querySelectorAll('img').length : 0 });" +
        "})()",
    );
    if (last.stop) return last.stop;
    if (!last.value?.drawerVisible && (last.value?.count || 0) > before) return pass({ before, ...last.value });
    await sleep(400);
  }
  return fail("IMAGES_UNREAD", { before, ...last?.value }, "确定之后必须同时满足抽屉关闭、.pgc-img 数量增加");
}

/** 头条图片抽屉默认没有 file 输入框，要先点「上传图片」才会挂出来。 */
async function ensureUploadEntry(ctx) {
  const clicked = await page(
    ctx,
    "(() => {" +
      "const drawer = document.querySelector('.mp-ic-img-drawer');" +
      "if (!drawer) return JSON.stringify({ ok: false, code: 'NO_DRAWER' });" +
      "if (drawer.querySelector('input[type=file]')) return JSON.stringify({ ok: true, existed: true });" +
      "const tab = Array.from(drawer.querySelectorAll('div,span,button')).find((el) => (el.innerText || '').replace(/\\s+/g, '') === '上传图片' && el.getBoundingClientRect().height > 2);" +
      "if (!tab) return JSON.stringify({ ok: false, code: 'NO_UPLOAD_TAB' });" +
      "tab.click();" +
      "return JSON.stringify({ ok: true, existed: false });" +
      "})()",
  );
  if (clicked.stop) return clicked.stop;
  if (!clicked.value?.ok) {
    return fail(clicked.value?.code || "NO_FILE_INPUT", clicked.value, "图片抽屉里没有上传入口");
  }
  for (let i = 0; i < 10; i++) {
    const has = await page(
      ctx,
      "(() => { const d = document.querySelector('.mp-ic-img-drawer'); return JSON.stringify({ n: d ? d.querySelectorAll('input[type=file]').length : 0 }); })()",
    );
    if (has.stop) return has.stop;
    if ((has.value?.n || 0) > 0) return pass({ files: has.value.n });
    await sleep(300);
  }
  return fail("NO_FILE_INPUT", "mp-ic-img-drawer", "点了「上传图片」仍没有文件框");
}

function readScheduleModalScript() {
  return (
    "(() => {" +
    "const m = document.querySelector('.common-timing-picker');" +
    "if (!m || m.getBoundingClientRect().height <= 8) return JSON.stringify({ open: false });" +
    "const val = (sel) => { const el = m.querySelector(sel + ' .byte-select-view-value'); return el ? (el.innerText || '').trim() : ''; };" +
    "const text = (m.innerText || '').replace(/\\s+/g, ' ');" +
    "const hit = text.match(/北京时间\\s*(\\d{4}-\\d{2}-\\d{2})\\s*(\\d{2}:\\d{2})\\s*发布/);" +
    "return JSON.stringify({ open: true, day: val('.day-select'), hour: val('.hour-select'), minute: val('.minute-select'), iso: hit ? hit[1] + ' ' + hit[2] : '' });" +
    "})()"
  );
}

function openScheduleSelectScript(which) {
  return (
    "(() => {" +
    "const m = document.querySelector('.common-timing-picker');" +
    "const el = m && m.querySelector('." + which + "-select');" +
    "if (!el) return JSON.stringify({ ok: false, code: 'NO_SELECT' });" +
    "el.scrollIntoView({ block: 'center' });" +
    "el.click();" +
    "return JSON.stringify({ ok: true });" +
    "})()"
  );
}

function pickScheduleOptionScript(text) {
  return (
    "(() => {" +
    "function vis(el) { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; }" +
    "const popups = Array.from(document.querySelectorAll('.byte-select-popup')).filter(vis);" +
    "const popup = popups[popups.length - 1];" +
    "if (!popup) return JSON.stringify({ ok: false, popup: false });" +
    "const items = Array.from(popup.querySelectorAll('[class*=\"option\"],li')).filter(vis);" +
    "const hit = items.find((el) => (el.innerText || '').replace(/\\s+/g, '') === " + JSON.stringify(String(text)) + ");" +
    "if (!hit) return JSON.stringify({ ok: false, popup: true, shown: items.map((el) => (el.innerText || '').replace(/\\s+/g, '')).slice(0, 12) });" +
    "hit.click();" +
    "return JSON.stringify({ ok: true });" +
    "})()"
  );
}

async function pollModal(ctx) {
  let last = null;
  for (let i = 0; i < 20; i++) {
    last = await page(ctx, readScheduleModalScript());
    if (last.stop) return last;
    if (last.value?.open) return last;
    await sleep(300);
  }
  return last;
}

async function clickModalButton(ctx, text) {
  return page(
    ctx,
    "(() => {" +
      "const m = document.querySelector('.common-timing-picker');" +
      "const b = m && Array.from(m.querySelectorAll('button')).find((x) => (x.innerText || '').replace(/\\s+/g, '') === " + JSON.stringify(text) + ");" +
      "if (!b) return JSON.stringify({ ok: false });" +
      "b.click();" +
      "return JSON.stringify({ ok: true });" +
      "})()",
  );
}

/** 预览页底栏的「定时发布」才是真提交；它在 button.publish-btn 上，不在弹层里。 */
async function clickPreviewSubmit(ctx) {
  return page(
    ctx,
    "(() => {" +
      "function vis(el) { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; }" +
      "const btns = Array.from(document.querySelectorAll('button.publish-btn')).filter(vis).filter((b) => (b.innerText || '').replace(/\\s+/g, '') === '定时发布');" +
      "const b = btns[btns.length - 1];" +
      "if (!b) return JSON.stringify({ ok: false });" +
      "b.scrollIntoView({ block: 'center' });" +
      "b.click();" +
      "return JSON.stringify({ ok: true });" +
      "})()",
  );
}

async function schedule(ctx) {
  const human = await guard(ctx);
  if (human) return human;
  const opened = await page(
    ctx,
    "(() => {" +
      "const b = Array.from(document.querySelectorAll('button.publish-btn')).find((x) => (x.innerText || '').replace(/\\s+/g, '') === '定时发布');" +
      "if (!b) return JSON.stringify({ ok: false });" +
      "b.scrollIntoView({ block: 'center' });" +
      "b.click();" +
      "return JSON.stringify({ ok: true });" +
      "})()",
  );
  if (opened.stop) return opened.stop;
  if (!opened.value?.ok) return fail("SCHEDULE_BUTTON_MISSING", opened.value, "没有找到「定时发布」按钮");
  const seen = await pollModal(ctx);
  if (seen.stop) return seen.stop;
  if (!seen.value?.open) return fail("SCHEDULE_MODAL_MISSING", seen.value, "定时弹层没有出现");

  const [, month, day] = String(ctx.schedule.date).split("-");
  const dayLabel = Number(month) + "月" + Number(day) + "日";
  const [hourText, minuteText] = String(ctx.schedule.time).split(":");
  const wants = [
    ["day", ".day-select", "day", dayLabel],
    ["hour", ".hour-select", "hour", String(Number(hourText))],
    ["minute", ".minute-select", "minute", String(Number(minuteText))],
  ];
  for (const [kind, selector, key, value] of wants) {
    const current = await pollModal(ctx);
    if (current.stop) return current.stop;
    if (current.value?.[key] === value) continue;
    const open = await page(ctx, openScheduleSelectScript(kind));
    if (open.stop) return open.stop;
    if (!open.value?.ok) return fail("SCHEDULE_CONTROLS_MISSING", open.value, "定时控件 " + selector + " 找不到");
    let picked = null;
    for (let i = 0; i < 12; i++) {
      picked = await page(ctx, pickScheduleOptionScript(value));
      if (picked.stop) return picked.stop;
      if (picked.value?.ok) break;
      await sleep(250);
    }
    if (!picked.value?.ok) {
      return fail("SCHEDULE_OPTION_MISSING", picked.value, "定时弹层里没有 " + value + "（可选范围只有今天到 7 天后）");
    }
    await sleep(450);
  }

  let read = null;
  for (let i = 0; i < 20; i++) {
    read = await pollModal(ctx);
    if (read.stop) return read.stop;
    if (read.value?.iso === ctx.schedule.text) break;
    await sleep(300);
  }
  if (read.value?.iso !== ctx.schedule.text) {
    return fail("SCHEDULE_UNCONFIRMED", read.value, "定时没有回读到 " + ctx.schedule.text);
  }

  const preview = await clickModalButton(ctx, "预览并定时发布");
  if (preview.stop) return preview.stop;
  if (!preview.value?.ok) return fail("SCHEDULE_CONFIRM_MISSING", preview.value, "弹层里没有「预览并定时发布」");
  await sleep(2500);

  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await page(
      ctx,
      "(() => JSON.stringify({ url: location.href, modal: !!document.querySelector('.common-timing-picker') && document.querySelector('.common-timing-picker').getBoundingClientRect().height > 8 }))()",
    );
    if (state.stop) return state.stop;
    const url = state.value?.url || "";
    if (url.includes("/graphic/articles") || url.includes("/manage/content")) {
      return pass({ mode: "schedule", at: ctx.schedule.text, readback: read.value, href: url });
    }
    if (state.value?.modal) {
      // 弹层还在：再确认一次时间，然后回到预览页
      const again = await clickModalButton(ctx, "预览并定时发布");
      if (again.stop) return again.stop;
      await sleep(1800);
      continue;
    }
    const submit = await clickPreviewSubmit(ctx);
    if (submit.stop) return submit.stop;
    if (!submit.value?.ok) return fail("SCHEDULE_SUBMIT_MISSING", submit.value, "预览页没有「定时发布」提交按钮");
    await sleep(2500);
  }
  return fail("SCHEDULE_SUBMIT_UNCONFIRMED", { at: ctx.schedule.text }, "点了提交但页面没有离开预览");
}

/** 定时稿不在 /graphic/articles 里，只能到作品管理按标题找「定时发布中」。 */
async function verifyScheduled(ctx) {
  const moved = await nav(MANAGE_URL, ctx.tabId);
  if (String(moved).startsWith("URL_UNREAD") || String(moved).startsWith("MISMATCH")) return blockedCall(moved);
  const [, month, day] = String(ctx.schedule.date).split("-");
  const expectTime = month + "-" + day + " " + ctx.schedule.time;
  const title = JSON.stringify(ctx.title);
  const script =
    "(() => {" +
    "const want = " + title + ";" +
    "const rows = (document.body.innerText || '').split('\\n').map((s) => s.trim()).filter(Boolean);" +
    "const idx = rows.findIndex((s) => s === want || s.includes(want));" +
    "if (idx < 0) return JSON.stringify({ hit: false, url: location.href });" +
    "const block = rows.slice(idx, idx + 8);" +
    "const joined = block.join('|');" +
    "const at = (joined.match(/将于\\s*(\\d{2}-\\d{2}\\s+\\d{2}:\\d{2})\\s*发布/) || [])[1] || '';" +
    "const images = (joined.match(/(\\d+)\\s*张/) || [])[1] || '';" +
    "return JSON.stringify({ hit: true, status: block.find((s) => /定时发布中|已发布|审核中|未通过/.test(s)) || '', at, images, url: location.href });" +
    "})()";
  let read = null;
  for (let i = 0; i < 15; i++) {
    read = await page(ctx, script);
    if (read.stop) return read.stop;
    if (read.value?.hit) break;
    await sleep(800);
  }
  if (!read.value?.hit) return fail("LIST_ROW_MISSING", read.value, "作品管理里没有这篇标题");
  // 刚提交的定时稿先显示「审核中」，审核过了才是「定时发布中」；两种都算定时成功，时间必须对得上
  if (!/定时发布中|审核中/.test(read.value.status)) {
    return fail("SCHEDULE_STATUS_UNEXPECTED", read.value, "状态不是定时发布中/审核中：" + read.value.status);
  }
  if (read.value.at !== expectTime) {
    return fail("SCHEDULE_TIME_MISMATCH", read.value, "定时时间回读 " + read.value.at + "，应为 " + expectTime);
  }
  return pass({
    platform: "toutiao",
    title: ctx.title,
    status: "定时",
    time: expectTime,
    images: read.value.images ? Number(read.value.images) : null,
    link: "待发布",
    href: read.value.url,
    options: ctx.options || null,
  });
}

async function readReceipt(ctx, platform) {
  const title = JSON.stringify(ctx.title);
  const script =
    "(() => {" +
    "const want = " + title + ";" +
    "const href = location.href;" +
    "const text = (document.body?.innerText || '').slice(0, 8000);" +
    "const hit = text.includes(want);" +
    "const linkEl = Array.from(document.querySelectorAll('a')).find((el) => (el.href || '').includes('toutiao.com/article'));" +
    "const link = linkEl ? linkEl.href : '';" +
    "const images = (text.match(/(\\d+)\\s*张/) || [])[1] || '';" +
    "let status = '';" +
    "if (/审核中/.test(text)) status = '审核中';" +
    "else if (/已发布|发布成功/.test(text)) status = '已发布';" +
    "else if (/定时|待发布/.test(text)) status = '定时';" +
    "const time = (text.match(/\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}/) || [])[0] || '';" +
    "return JSON.stringify({ hit, href, link, images, status, time });" +
    "})()";
  let read = await page(ctx, script);
  if (read.stop) return read.stop;
  if (!read.value?.hit) {
    await sleep(1200);
    read = await page(ctx, script);
    if (read.stop) return read.stop;
  }
  if (!read.value?.hit) return fail("LIST_ROW_MISSING", read.value, "列表里没有这篇标题");
  const where = await readHref(ctx);
  const link = read.value.link || (/审核中|定时/.test(read.value.status) ? "待回访" : "");
  if (!link) return fail("LINK_UNREAD", read.value, "没有公开链接，也不是审核中或定时");
  return pass({
    platform,
    title: ctx.title,
    time: read.value.time || "",
    status: read.value.status || "待回访",
    images: read.value.images ? Number(read.value.images) : null,
    link,
    href: where.ok ? where.detail.href : "",
    options: ctx.options || null,
  });
}
