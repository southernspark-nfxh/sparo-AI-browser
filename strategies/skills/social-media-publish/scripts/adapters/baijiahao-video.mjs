// 百家号视频发布适配器（2026-11-14 实测锚点）
// 与图文适配器同一套契约：每个 step 返回 { ok, code, hint, detail }。
// 铁律：
//   1. 只操作 owner 是自己的编辑页（由 openWriteTab 管），不接管别人的 tab。
//   2. 横版、竖版封面都必须换掉默认图；封面不能有边框、台标、字幕条。
//   3. 发布前先过质量门，再发真实鼠标点击；点完必须回读列表页。
import { call, exec, nav, sleep, uploadFile } from "../sparo.mjs";
import { blockedCall, enforceAccountGate, fail, page, pass, readBaijiahaoAccount } from "../page.mjs";

const TITLE_SEL = '[class*="contentEditable"][contenteditable="true"]';
const VIDEO_ACCEPT_RE = /\.(mp4|mov|mkv|avi|flv|mpeg|ogg|vob|webm|wmv|rmvb)/i;

function js(value) {
  return JSON.stringify(value);
}

// ---------- 通用小工具 ----------

async function readState(ctx) {
  const script =
    "(() => {" +
    "const t = document.querySelector(" + js(TITLE_SEL) + ");" +
    "const imgs = Array.from(document.querySelectorAll('[class*=cover-container] img')).map(i => ({ src: (i.src || '').slice(-24), w: Math.round(i.getBoundingClientRect().width) }));" +
    "const v = document.querySelector('video');" +
    "const hints = Array.from(document.querySelectorAll('[class*=error],[class*=warn],[class*=tip]')).map(e => ((e.innerText||'').replace(/\\s+/g,' ').trim())).filter(x => x && x.length < 60).slice(0, 8);" +
    "return JSON.stringify({ href: location.href, title: t ? (t.innerText || '').trim() : '', hasEditor: !!t, coverImgs: imgs, video: v ? (v.currentSrc || v.src || '').slice(0, 24) : '', hints, innerHeight: window.innerHeight });" +
    "})()";
  const read = await page(ctx, script);
  if (read.stop) return { stop: read.stop };
  return read.value || {};
}

async function waitFor(ctx, script, accept, timeoutMs = 20000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() <= deadline) {
    const read = await page(ctx, script);
    if (read.stop) return { stop: read.stop };
    last = read.value || {};
    if (accept(last)) return { value: last };
    await sleep(intervalMs);
  }
  return { value: last, timeout: true };
}

function tagFileInputByAccept(acceptRe) {
  return (
    "(() => {" +
    "const re = " + acceptRe.toString() + ";" +
    "const el = Array.from(document.querySelectorAll('input[type=file]')).find(i => re.test(i.accept || ''));" +
    "if (!el) return JSON.stringify({ selector: '' });" +
    "el.id = 'sparo-video-file' + Math.random().toString(16).slice(2);" +
    "return JSON.stringify({ selector: '#' + el.id, accept: el.accept || '' });" +
    "})()"
  );
}

// ---------- 步骤 ----------

/**
 * 草稿里挂着别的视频时，点「更换」把文件框重新叫出来。
 * 「更换」遮罩平时靠 :hover 显形，直接合成点击父容器即可。
 */
async function replaceDraftVideo(ctx) {
  const clicked = await page(
    ctx,
    "(() => { const all = Array.from(document.querySelectorAll('div,span,button,a'));" +
      "const hits = all.filter(e => (e.innerText || '').trim() === '更换' && e.getBoundingClientRect().width > 0);" +
      "if (!hits.length) return JSON.stringify({ ok: false, reason: 'no 更换' });" +
      "const el = hits[0];" +
      "['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));" +
      "return JSON.stringify({ ok: true }); })()",
  );
  if (clicked.stop) return clicked.stop;
  // 找不到「更换」也不算错：视频文件框本来就常驻在 DOM 里，直接塞文件即可
  const found = await waitFor(ctx, tagFileInputByAccept(VIDEO_ACCEPT_RE), (s) => !!s.selector, 8000, 400);
  if (found.stop) return found.stop;
  if (!found.value?.selector) return { ok: false, detail: clicked.value };
  const raw = await uploadFile(found.value.selector, ctx.video, ctx.tabId, ctx.host);
  const stopped = blockedCall(raw);
  if (stopped) return stopped;
  return { ok: true, selector: found.value.selector };
}

async function uploadVideo(ctx) {
  // 恢复的草稿可能已经挂着视频，这时页面上没有文件框，别再等也不再传
  const existing = await page(ctx, "(() => { const v = document.querySelector('video'); return JSON.stringify({ has: !!v && !!(v.currentSrc || v.src), dur: v ? Math.round((v.duration || 0) * 100) / 100 : 0 }); })()");
  if (existing.stop) return existing.stop;
  if (existing.value?.has) {
    const want = Number(ctx.videoDuration || 0);
    // 刚打开页面时 metadata 还没加载，duration 会是 0，必须等它出来再比，否则会误放过残留草稿
    const meta = await waitFor(ctx, "(() => { const v = document.querySelector('video'); return JSON.stringify({ dur: v ? Math.round((v.duration || 0) * 100) / 100 : 0 }); })()", (s) => Number(s.dur || 0) > 0, 12000, 400);
    if (meta.stop) return meta.stop;
    const got = Number(meta.value?.dur || 0);
    // 草稿里挂的视频必须就是这一条：平台会跨会话恢复草稿，时长对不上就是上一条的残留
    if (!want || !got || Math.abs(got - want) <= 1.5) return pass({ skipped: "已有视频", dur: got });
    const replaced = await replaceDraftVideo(ctx);
    if (replaced.stop) return replaced.stop;
    if (!replaced.ok) {
      return fail("DRAFT_VIDEO_MISMATCH", { want, got }, "草稿里挂的是别的视频（" + got + "s ≠ " + want + "s），换掉也没成功");
    }
  }
  // 上传组件是异步挂载的，立即查会空手
  const found = await waitFor(ctx, tagFileInputByAccept(VIDEO_ACCEPT_RE), (s) => !!s.selector, 20000, 400);
  if (found.stop) return found.stop;
  const picked = { value: found.value, stop: found.stop };
  if (!picked.value?.selector) return fail("NO_VIDEO_INPUT", "", "页面上没有视频文件框（等了 20s）");
  const raw = await uploadFile(picked.value.selector, ctx.video, ctx.tabId, ctx.host);
  const stopped = blockedCall(raw);
  if (stopped) return stopped;
  return pass({ selector: picked.value.selector, file: ctx.video });
}

async function waitVideo(ctx) {
  // 视频上传完成：出现 <video> 且 src 可读，或进度文案到 100%
  const want = Number(ctx.videoDuration || 0);
  const script =
    "(() => {" +
    "const v = document.querySelector('video');" +
    "const body = document.body.innerText || '';" +
    "const pct = (body.match(/(\\d{1,3})%/) || [])[1] || '';" +
    "const dur = v ? Math.round((v.duration || 0) * 100) / 100 : 0;" +
    "const done = /上传成功|上传完成|转码中|重新上传|更换视频/.test(body);" +
    "return JSON.stringify({ hasVideo: !!v, src: v ? (v.currentSrc || v.src || '').slice(0, 24) : '', dur, pct, done });" +
    "})()";
  // 换稿时旧视频会先留在页面上，所以时长对上才算上传完
  const waited = await waitFor(ctx, script, (s) => s.hasVideo && s.src && (!want || Math.abs(Number(s.dur || 0) - want) <= 1.5), 300000, 1000);
  if (waited.stop) return waited.stop;
  if (!waited.value?.hasVideo) return fail("VIDEO_NOT_READY", waited.value || {}, "视频没有出现在编辑页，可能还在上传");
  return pass({ src: waited.value.src, dur: waited.value.dur, pct: waited.value.pct || "" });
}

async function fillTitle(ctx) {
  const script =
    "(() => {" +
    "const el = document.querySelector(" + js(TITLE_SEL) + ");" +
    "if (!el) return JSON.stringify({ ok: false, reason: 'no title editor' });" +
    "const ed = el.__lexicalEditor;" +
    "if (!ed || !ed.parseEditorState) return JSON.stringify({ ok: false, reason: 'not lexical' });" +
    "const title = " + js(String(ctx.title || "")) + ";" +
    "const state = { root: { children: [{ children: [{ detail: 0, format: 0, mode: 'normal', style: '', text: title, type: 'text', version: 1 }], direction: 'ltr', format: '', indent: 0, type: 'paragraph', version: 1, textFormat: 0, textStyle: '' }], direction: 'ltr', format: '', indent: 0, type: 'root', version: 1 } };" +
    "ed.setEditorState(ed.parseEditorState(state));" +
    "return JSON.stringify({ ok: true, now: (el.innerText || '').trim() });" +
    "})()";
  const read = await page(ctx, script);
  if (read.stop) return read.stop;
  if (!read.value?.ok) return fail("TITLE_EDITOR_MISSING", read.value || {}, "没找到 Lexical 标题框");
  if (read.value.now !== String(ctx.title || "")) {
    return fail("TITLE_MISMATCH", { now: read.value.now }, "标题回读与目标不一致");
  }
  return pass({ title: read.value.now, length: [...read.value.now].length });
}

/**
 * 关掉还挂着的封面弹窗。实测：确定点一次常常吞掉（内部 loading 未落），
 * 弹窗会一直挡着，必须在开下一个槽位前清干净。
 */
async function closeCoverModal(ctx) {
  for (let i = 0; i < 3; i++) {
    // 同样不用 id 跨调用：残留的旧节点会抢走 getElementById，直接定位可见弹窗里的关闭按钮
    const raw = await page(
      ctx,
      "(() => { const ms = Array.from(document.querySelectorAll('.cheetah-modal')).filter(x => x.getBoundingClientRect().width > 0 && /封面预览/.test(x.innerText || ''));" +
        "const m = ms[ms.length - 1];" +
        "if (!m) return JSON.stringify({ open: false });" +
        "const x = m.querySelector('.cheetah-modal-close'); if (!x) return JSON.stringify({ open: true, clicked: false });" +
        "x.click(); return JSON.stringify({ open: true, clicked: true }); })()",
    );
    if (raw.stop) return raw.stop;
    if (!raw.value?.open) return pass({ closed: true });
    if (!raw.value?.clicked) return fail("COVER_MODAL_STUCK", raw.value, "封面弹窗挡着且找不到关闭按钮");
    const gone = await waitFor(
      ctx,
      "(() => { const m = Array.from(document.querySelectorAll('.cheetah-modal')).find(x => x.getBoundingClientRect().width > 0 && /封面预览/.test(x.innerText || '')); return JSON.stringify({ open: !!m }); })()",
      (s) => !s.open,
      3000,
      300,
    );
    if (gone.stop) return gone.stop;
    if (!gone.value?.open) return pass({ closed: true, tries: i + 1 });
  }
  return fail("COVER_MODAL_STUCK", { tries: 3 }, "封面弹窗连续关 3 次仍在");
}

/**
 * 关掉除「定时发文」以外的可见弹窗（创作声明等）。
 * 声明弹窗用 JS click 点「确定」经常被内部校验吞掉，所以点完必须回读，没关就再来一次。
 */
async function dismissOtherModals(ctx, keepRe) {
  const keep = keepRe || "定时发文";
  for (let i = 0; i < 4; i++) {
    const raw = await page(
      ctx,
      "(() => { const ms = Array.from(document.querySelectorAll('.cheetah-modal')).filter(x => x.getBoundingClientRect().width > 0)" +
        // 关闭动画残留的「幽灵弹窗」按钮是 pointer-events:none，点它等于没点，必须排掉
        ".filter(x => Array.from(x.querySelectorAll('button')).some(b => getComputedStyle(b).pointerEvents !== 'none'));" +
        "const rest = ms.filter(x => !new RegExp(" + js(keep) + ").test(x.innerText || ''));" +
        "const m = rest[rest.length - 1];" +
        "if (!m) return JSON.stringify({ open: false, total: ms.length });" +
        "const btns = Array.from(m.querySelectorAll('button'));" +
        "const btn = btns.find(b => (b.innerText || '').trim() === '确定' && !b.disabled)" +
        " || btns.find(b => (b.innerText || '').trim() === '取消' && !b.disabled)" +
        " || m.querySelector('.cheetah-modal-close');" +
        "const text = (m.innerText || '').replace(/\\s+/g, ' ').slice(0, 40);" +
        "if (!btn) return JSON.stringify({ open: true, clicked: false, text });" +
        "['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));" +
        "return JSON.stringify({ open: true, clicked: true, text }); })()",
    );
    if (raw.stop) return raw.stop;
    if (!raw.value?.open) return pass({ cleared: true, tries: i });
    if (!raw.value?.clicked) return pass({ cleared: false, stuck: raw.value.text });
    await sleep(600);
  }
  return pass({ cleared: false, tries: 4 });
}

/**
 * 打开封面弹窗。kind = land | portrait
 * 横版：点封面缩略图；竖版：点右侧小图。弹窗标题会写明「横版封面预览 (16:9)」「竖版封面预览 (3:4)」。
 */
async function openCoverModal(ctx, kind) {
  const label = kind === "portrait" ? "竖版封面预览" : "横版封面预览";
  // 上一个槽位的弹窗没关干净时，会挡住点击并让 kind 校验误判
  const existing = await page(
    ctx,
    "(() => { const ms = Array.from(document.querySelectorAll('.cheetah-modal')).filter(m => m.getBoundingClientRect().width > 0 && /封面预览/.test(m.innerText || ''));" +
      "return JSON.stringify({ open: ms.length > 0, right: ms.some(m => (m.innerText || '').includes(" + js(label) + ")) }); })()",
  );
  if (existing.stop) return existing.stop;
  if (existing.value?.open && !existing.value?.right) {
    const closed = await closeCoverModal(ctx);
    if (!closed.ok) return closed;
  }
  // 长视频的封面区是后挂载的：刚填完话题时 [class*=cover-container] 还没渲染出来，
  // 直接找 hovercontent 会误判 COVER_TRIGGER_MISSING（176s 的 dFGuReJZ-iA 就是这么连挂 3 次）。
  const ready = await waitFor(
    ctx,
    "(() => { const n = Array.from(document.querySelectorAll('[class*=cover-container]')).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length; return JSON.stringify({ n }); })()",
    (s) => Number(s.n) > 0,
    60000,
    1000,
  );
  if (ready.stop) return ready.stop;
  const tagScript =
    "(() => {" +
    "const isPortrait = " + (kind === "portrait") + ";" +
    "const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };" +
    "const already = Array.from(document.querySelectorAll('.cheetah-modal')).find(m => isVisible(m) && (m.innerText || '').includes(" + js(label) + "));" +
    "if (already) return JSON.stringify({ tagged: '', already: true });" +
    // 两个槽位按从左到右排序：第 0 个横版，第 1 个竖版
    "const conts = Array.from(document.querySelectorAll('[class*=cover-container]')).filter(isVisible)" +
    ".sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);" +
    "const cont = conts[isPortrait ? 1 : 0];" +
    "if (!cont) return JSON.stringify({ tagged: '', reason: 'no cover container', count: conts.length });" +
    // 「编辑封面」遮罩默认 display:none，靠 CSS :hover 显形，JS 无法伪造 :hover。
    // 做法：手动把它 display:block 铺满封面区，再 CDP 真实点击它。
    // 注意 id 必须按槽位区分：两个槽位同时挂同一个 id 会点到横版那个。
    "Array.from(document.querySelectorAll('[class*=hovercontent]')).forEach(e => { e.id = ''; e.style.display = ''; });" +
    "const hv = cont.querySelector('[class*=hovercontent]');" +
    "if (!hv) return JSON.stringify({ tagged: '', reason: 'no hovercontent', count: conts.length });" +
    "hv.style.display = 'block';" +
    "hv.id = 'sparo-cover-trigger-" + kind + "';" +
    "const r = hv.getBoundingClientRect();" +
    "return JSON.stringify({ tagged: '#sparo-cover-trigger-" + kind + "', text: (hv.innerText || '').trim().slice(0, 12), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });" +
    "})()";
  const tagged = await page(ctx, tagScript);
  if (tagged.stop) return tagged.stop;
  if (!tagged.value?.tagged && !tagged.value?.already) {
    return fail("COVER_TRIGGER_MISSING", tagged.value || {}, "找不到封面入口：" + label);
  }
  if (!tagged.value?.already) {
    // 前台可见的标签里，CDP 真实鼠标会先触发 React hover 重渲染、把节点换掉，点不开弹窗；
    // 原生 el.click() 走同一套事件委托，反而稳定。先 JS 再 CDP 兜底。
    const rawJs = await exec(
      "(() => { const el = document.getElementById('sparo-cover-trigger-" + kind + "'); if (!el) return JSON.stringify({ ok: false }); el.click(); return JSON.stringify({ ok: true }); })()",
      ctx.tabId,
      ctx.host,
    );
    const jsStopped = blockedCall(rawJs);
    if (jsStopped) return jsStopped;
    await sleep(600);
    const peek = await page(
      ctx,
      "(() => { const ms = Array.from(document.querySelectorAll('.cheetah-modal')).filter(m => m.getBoundingClientRect().width > 0); return JSON.stringify({ open: ms.length > 0 }); })()",
    );
    if (!peek.stop && !peek.value?.open) {
      const raw = await call("click", { selector: tagged.value.tagged, tabId: ctx.tabId });
      const stopped = blockedCall(raw);
      if (stopped) return stopped;
    }
  }
  const waited = await waitFor(
    ctx,
    "(() => { const ms = Array.from(document.querySelectorAll('.cheetah-modal')).filter(m => m.getBoundingClientRect().width > 0);" +
      "const m = ms.find(x => (x.innerText||'').includes(" + js(label) + ")) || ms[0];" +
      "return JSON.stringify({ open: !!m, text: m ? (m.innerText||'').replace(/\\s+/g,' ').slice(0, 120) : '' }); })()",
    (s) => s.open,
    10000,
    300,
  );
  if (waited.stop) return waited.stop;
  if (!waited.value?.open) return fail("COVER_MODAL_MISSING", { tagged: tagged.value, modal: waited.value }, "封面弹窗没有打开：" + label);
  if (!(waited.value.text || "").includes(label)) {
    return fail("COVER_MODAL_KIND_MISMATCH", waited.value, "打开的封面弹窗不是「" + label + "」");
  }
  return pass({ kind, label, rect: tagged.value.rect });
}

async function uploadCoverInModal(ctx, kind, file) {
  const modalExpr = "Array.from(document.querySelectorAll('.cheetah-modal')).find(x => (x.innerText||'').includes(" +
    js(kind === "portrait" ? "竖版封面预览" : "横版封面预览") + ") && x.getBoundingClientRect().width > 0)";
  const picker = await page(
    ctx,
    "(() => { const m = " + modalExpr + "; if (!m) return JSON.stringify({ selector: '' });" +
      // 弹窗左下角是「+ 本地上传」方块，文件框在它内部或就近祖先里
      "const up = Array.from(m.querySelectorAll('*')).find(e => e.children.length === 0 && (e.innerText || '').trim() === '本地上传');" +
      "let el = null;" +
      "for (let cur = up, i = 0; cur && i < 4; cur = cur.parentElement, i++) { const hit = cur.querySelector && cur.querySelector('input[type=file]'); if (hit) { el = hit; break; } }" +
      "if (!el) el = m.querySelector('input[type=file][accept*=\"image\"]') || m.querySelector('input[type=file]');" +
      "if (!el) return JSON.stringify({ selector: '' });" +
      "el.id = 'sparo-cover-file'; return JSON.stringify({ selector: '#sparo-cover-file', accept: el.accept || '', via: up ? '本地上传' : 'fallback' }); })()",
  );
  if (picker.stop) return picker.stop;
  if (!picker.value?.selector) return fail("COVER_INPUT_MISSING", kind, "弹窗里没有本地上传的文件框");
  const raw = await uploadFile(picker.value.selector, file, ctx.tabId, ctx.host);
  const stopped = blockedCall(raw);
  if (stopped) return stopped;
  // 上传后弹窗内部还在 loading，此时点「确定」会被吞（按钮看起来可点但 onClick 直接 return）
  await sleep(2500);
  // 不再拿「预览图 src 有没有变」判上传成功：重复上传同一张图时 src 本来就不变。
  // 统一等「确定」从 disabled 变可点，那才是质检放行的信号。
  const confirm = await waitFor(
    ctx,
    "(() => { const m = " + modalExpr + "; if (!m) return JSON.stringify({ ok: false, gone: true });" +
      "const btns = Array.from(m.querySelectorAll('button'));" +
      "const btn = btns.find(b => (b.innerText || '').trim() === '确定' && b.getBoundingClientRect().width > 0);" +
      "if (!btn) return JSON.stringify({ ok: false, reason: 'no confirm', texts: btns.map(b => (b.innerText||'').trim()) });" +
      // 图片上传后质检期间确定是 disabled，必须等到可点，不能一看到就判失败
      "if (btn.disabled) return JSON.stringify({ ok: false, reason: 'confirm disabled', disabled: true });" +
      "const r = btn.getBoundingClientRect();" +
      "return JSON.stringify({ ok: true, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });" +
      "})()",
    (s) => s.ok,
    40000,
    500,
  );
  if (confirm.stop) return confirm.stop;
  if (!confirm.value?.ok) return fail("COVER_CONFIRM_MISSING", confirm.value || {}, "封面弹窗没有可点的确定（等 40s 仍不可点）");
  // 关键：不要跨调用用 id 定位按钮。横版弹窗关掉后 DOM 节点仍留在页面里（只是不可见），
  // 同 id 会让 getElementById 命中那个残留副本，点了等于没点，白白空等几十秒。
  const clickConfirmExpr =
    "(() => { const ms = Array.from(document.querySelectorAll('.cheetah-modal')).filter(m => m.getBoundingClientRect().width > 0 && (m.innerText||'').includes(" +
    js(kind === "portrait" ? "竖版封面预览" : "横版封面预览") + "));" +
    "const m = ms[ms.length - 1]; if (!m) return JSON.stringify({ ok: false, reason: 'no visible modal' });" +
    "const b = Array.from(m.querySelectorAll('button')).find(x => (x.innerText||'').trim() === '确定' && !x.disabled && x.getBoundingClientRect().width > 0);" +
    "if (!b) return JSON.stringify({ ok: false, reason: 'no confirm btn' }); b.click(); return JSON.stringify({ ok: true }); })()";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const rawJs = await exec(clickConfirmExpr, ctx.tabId, ctx.host);
    const jsStopped = blockedCall(rawJs);
    if (jsStopped) return jsStopped;
    let closed = await waitFor(
      ctx,
      "(() => { const m = " + modalExpr + "; return JSON.stringify({ open: !!m }); })()",
      (s) => !s.open,
      3000,
      300,
    );
    if (closed.stop) return closed.stop;
    if (!closed.value?.open) return pass({ kind, file, attempts: attempt, via: "js-click" });
    // 兜底：清掉所有旧 id 再给「当前可见弹窗」的确定打唯一 id，用 CDP 真实鼠标点
    const retag = await page(
      ctx,
      "(() => { document.querySelectorAll('[id^=\"sparo-cover-ok\"]').forEach(e => e.removeAttribute('id'));" +
        "const ms = Array.from(document.querySelectorAll('.cheetah-modal')).filter(m => m.getBoundingClientRect().width > 0 && (m.innerText||'').includes(" +
        js(kind === "portrait" ? "竖版封面预览" : "横版封面预览") + "));" +
        "const m = ms[ms.length - 1]; if (!m) return JSON.stringify({ ok: false });" +
        "const b = Array.from(m.querySelectorAll('button')).find(x => (x.innerText||'').trim() === '确定' && !x.disabled);" +
        "if (!b) return JSON.stringify({ ok: false }); b.id = 'sparo-cover-ok'; return JSON.stringify({ ok: true }); })()",
    );
    if (retag.stop) return retag.stop;
    if (!retag.value?.ok) continue;
    const rawClick = await call("click", { selector: "#sparo-cover-ok", tabId: ctx.tabId });
    const clickStopped = blockedCall(rawClick);
    if (clickStopped) return clickStopped;
    closed = await waitFor(
      ctx,
      "(() => { const m = " + modalExpr + "; return JSON.stringify({ open: !!m }); })()",
      (s) => !s.open,
      4000,
      300,
    );
    if (closed.stop) return closed.stop;
    if (!closed.value?.open) return pass({ kind, file, attempts: attempt, via: "cdp-click" });
  }
  // 实测：封面已生效，但这个弹窗有时不自动关。点右上角关闭兜底
  // 最后兜底：直接点可见弹窗右上角的 ×，点完统一走 closeCoverModal 确认真的关了
  const taggedClose = await page(
    ctx,
    "(() => { const m = " + modalExpr + "; if (!m) return JSON.stringify({ ok: true, gone: true });" +
      "const x = m.querySelector('.cheetah-modal-close'); if (!x) return JSON.stringify({ ok: false });" +
      "x.click(); return JSON.stringify({ ok: true }); })()",
  );
  if (taggedClose.stop) return taggedClose.stop;
  if (taggedClose.value?.gone) return pass({ kind, file, alreadyClosed: true });
  if (!taggedClose.value?.ok) return fail("COVER_MODAL_STUCK", kind, "点了确定但封面弹窗没关，也找不到关闭按钮");
  const closedAfter = await closeCoverModal(ctx);
  if (!closedAfter.ok) return closedAfter;
  return pass({ kind, file, forcedClose: true });
}

/**
 * 封面现状探针。
 * 用户策略：上传视频后平台常会自动挑一张封面并给 4 张「智能推荐封面」；
 * 只要自动封面在、且没有「不合格/请上传」提示，就不要覆盖它；否则才补传自己的图。
 */
async function uploadEmptySlot(ctx, index, file) {
  // 平台没生成 AI 封面时，槽位是空的 cheetah-upload 占位框：没有 hovercontent，
  // 只能直接往槽位自己的 input[type=file] 塞图，塞完会弹「封面截取」再点确定。
  const tag = await page(
    ctx,
    "(() => {" +
      "document.querySelectorAll('[id^=\"sparo-empty-cover\"]').forEach(e => e.removeAttribute('id'));" +
      "const cs = Array.from(document.querySelectorAll('[class*=cover-container]')).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })" +
      ".sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);" +
      "const c = cs[" + index + "]; if (!c) return JSON.stringify({ ok: false, reason: 'no slot' });" +
      "const inp = c.querySelector('input[type=file]'); if (!inp) return JSON.stringify({ ok: false, reason: 'no input' });" +
      "inp.id = 'sparo-empty-cover-" + index + "';" +
      "return JSON.stringify({ ok: true, accept: inp.accept || '' }); })()",
  );
  if (tag.stop) return tag.stop;
  if (!tag.value?.ok) return fail("COVER_SLOT_MISSING", { index, detail: tag.value }, "第 " + index + " 个封面槽位里没有文件框");
  const raw = await uploadFile("#sparo-empty-cover-" + index, file, ctx.tabId, ctx.host);
  const stopped = blockedCall(raw);
  if (stopped) return stopped;
  await sleep(2500);
  const modalExpr2 =
    "Array.from(document.querySelectorAll('.cheetah-modal')).filter(m => m.getBoundingClientRect().width > 0)" +
    ".find(m => /封面截取|封面预览/.test(m.innerText || ''))";
  const confirm = await waitFor(
    ctx,
    "(() => { const m = " + modalExpr2 + "; if (!m) return JSON.stringify({ ok: false, gone: true });" +
      "const b = Array.from(m.querySelectorAll('button')).find(x => (x.innerText || '').trim() === '确定');" +
      "if (!b) return JSON.stringify({ ok: false, reason: 'no confirm' });" +
      "if (b.disabled) return JSON.stringify({ ok: false, reason: 'disabled' });" +
      "return JSON.stringify({ ok: true }); })()",
    (s) => s.ok || s.gone,
    40000,
    500,
  );
  if (confirm.stop) return confirm.stop;
  if (!confirm.value?.ok && !confirm.value?.gone) return fail("COVER_CONFIRM_MISSING", confirm.value || {}, "空槽传图后截取弹窗没有可点的确定");
  if (confirm.value?.ok) {
    const clicked = await page(
      ctx,
      "(() => { const m = " + modalExpr2 + "; if (!m) return JSON.stringify({ ok: true, gone: true });" +
        "const b = Array.from(m.querySelectorAll('button')).find(x => (x.innerText || '').trim() === '确定' && !x.disabled);" +
        "if (!b) return JSON.stringify({ ok: false }); b.click(); return JSON.stringify({ ok: true }); })()",
    );
    if (clicked.stop) return clicked.stop;
  }
  const closed = await waitFor(
    ctx,
    "(() => { const m = " + modalExpr2 + "; return JSON.stringify({ open: !!m }); })()",
    (s) => !s.open,
    8000,
    400,
  );
  if (closed.stop) return closed.stop;
  if (closed.value?.open) return fail("COVER_MODAL_STUCK", closed.value, "空槽传图后封面截取弹窗没关");
  return pass({ index, file, via: "空槽直传" });
}

async function probeCover(ctx) {
  const raw = await page(
    ctx,
    "(() => {" +
      "const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 8 && r.height > 8; };" +
      "const conts = Array.from(document.querySelectorAll('[class*=cover-container]')).filter(isVisible)" +
      ".sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);" +
      "const slots = conts.map((c, i) => { const img = c.querySelector('img'); const r = img ? img.getBoundingClientRect() : { width: 0 };" +
      "return { i, hasImg: !!img && !!(img.currentSrc || img.src), w: Math.round(r.width || 0) }; });" +
      "const body = document.body.innerText || '';" +
      // 只认真正的负面提示，别把「优质横竖版封面，有助于获得更多流量」这种文案算进去
      "const m = body.match(/封面[^\\n]{0,10}(不合格|不符合|不清晰|模糊|建议更换)|请(上传|设置|选择)封面|封面(未上传|待上传)/);" +
      "return JSON.stringify({ count: slots.length, slots, hasLand: !!(slots[0] && slots[0].hasImg), hasPortrait: !!(slots[1] && slots[1].hasImg), warn: m ? m[0] : '' });" +
      "})()",
  );
  if (raw.stop) return { stop: raw.stop };
  return raw.value || { count: 0, slots: [], hasLand: false, hasPortrait: false, warn: "" };
}

async function coverProbeStep(ctx) {
  const probe = await probeCover(ctx);
  if (probe.stop) return probe.stop;
  // 只有「有自动封面且没有负面提示」才算 AI 已选好
  const aiPicked = probe.hasLand && !probe.warn;
  return pass({ ...probe, aiPicked, decision: aiPicked ? "保留 AI 封面，不覆盖" : "需要补传封面" });
}

async function setCover(ctx) {
  const probe = await probeCover(ctx);
  if (probe.stop) return probe.stop;
  if (ctx.coverMode === "never") return pass({ skipped: "coverMode=never", probe });
  if (ctx.coverMode !== "always" && probe.hasLand && !probe.warn) {
    return pass({ skipped: "AI 已选横版封面，且无不合格提示", probe });
  }
  // 空槽（平台没生成 AI 封面）没有 hovercontent，只能往槽位的文件框直传
  if (!probe.hasLand) {
    const empty = await uploadEmptySlot(ctx, 0, ctx.coverLand);
    if (!empty.ok) return empty;
    return pass({ land: true, via: "空槽直传", file: ctx.coverLand, probe });
  }
  const land = await openCoverModal(ctx, "land");
  if (!land.ok) return land;
  const up = await uploadCoverInModal(ctx, "land", ctx.coverLand);
  if (!up.ok) return up;
  return pass({ land: true, file: ctx.coverLand, probe });
}

async function setCoverPortrait(ctx) {
  // 竖版同样走弹窗：点竖版槽位 → 「上传本地图片」→ 确定（预览区会写「竖版封面预览 (3:4)」）
  const probe = await probeCover(ctx);
  if (probe.stop) return probe.stop;
  if (ctx.coverMode === "never") return pass({ skipped: "coverMode=never", probe });
  // 横屏视频常常只给一个横版槽位，没有第二个容器就没什么可传
  if (probe.count < 2) return pass({ skipped: "页面只有 " + probe.count + " 个封面槽位，无竖版", probe });
  if (ctx.coverMode !== "always" && probe.hasPortrait && !probe.warn) {
    return pass({ skipped: "AI 已选竖版封面，且无不合格提示", probe });
  }
  if (!ctx.coverPortrait) return fail("COVER_PORTRAIT_REQUIRED", probe, "缺少竖版封面图，但页面要求补传");
  if (!probe.hasPortrait) {
    const empty = await uploadEmptySlot(ctx, 1, ctx.coverPortrait);
    if (!empty.ok) return empty;
    return pass({ portrait: true, via: "空槽直传", file: ctx.coverPortrait, probe });
  }
  const open = await openCoverModal(ctx, "portrait");
  if (!open.ok) return open;
  const up = await uploadCoverInModal(ctx, "portrait", ctx.coverPortrait);
  if (!up.ok) return up;
  return pass({ portrait: true, file: ctx.coverPortrait, probe });
}

/**
 * 话题。
 * 关键事实：视频页没有独立话题框，也没有独立标题输入框——「作品描述」就是唯一那个 Lexical 编辑器。
 * 做法：光标移到末尾 → insertText 打 # + 话题词 → 等联想列表 → 点含 #话题# 的那条 → 回读实体数。
 * 平台上限 10 个（输入框旁显示「# 话题 n/10」）；策略要求不低于 5 个。
 */
const MIN_TOPICS = 5;
const MAX_TOPICS = 10;

async function topicState(ctx) {
  const raw = await page(
    ctx,
    "(() => { const el = document.querySelector(" + js(TITLE_SEL) + ");" +
      "if (!el) return JSON.stringify({ ok: false, count: 0, tags: [], now: '' });" +
      "const norm = (s) => String(s || '').replace(/\\s+/g, '');" +
      "const nodes = Array.from(el.querySelectorAll('[data-tag-type=\"topic\"]'));" +
      "return JSON.stringify({ ok: true, count: nodes.length, tags: nodes.map(n => norm(n.innerText)), now: (el.innerText || '').trim() }); })()",
  );
  if (raw.stop) return { stop: raw.stop };
  return raw.value || { ok: false, count: 0, tags: [], now: "" };
}

async function appendOneTopic(ctx, topic) {
  const tag = "#" + topic + "#";
  const before = await topicState(ctx);
  if (before.stop) return before.stop;
  if ((before.tags || []).includes(tag)) return pass({ topic, skipped: "已是话题实体" });

  // 只有编辑器里一个话题实体都没有时，才允许整段重写清掉纯文字 #话题#
  // （整段重写会把已有话题实体一起抹掉，拿到第 2 个话题时绝不能走这里）
  if (!before.count) {
    const cleaned = await page(
      ctx,
      "(() => { const el = document.querySelector(" + js(TITLE_SEL) + "); if (!el) return JSON.stringify({ ok: false });" +
        "const ed = el.__lexicalEditor;" +
        "const text = (el.innerText || '').replace(/#[^#\\n]{1,15}#/g, '').trim();" +
        "if (ed && ed.parseEditorState) ed.setEditorState(ed.parseEditorState({ root: { children: [{ children: [{ detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1 }], direction: 'ltr', format: '', indent: 0, type: 'paragraph', version: 1, textFormat: 0, textStyle: '' }], direction: 'ltr', format: '', indent: 0, type: 'root', version: 1 } }));" +
        "return JSON.stringify({ ok: true }); })()",
    );
    if (cleaned.stop) return cleaned.stop;
  }

  // 关键：必须「先打 # → 等一拍 → 再打话题词」。一次性 insertText('#宠物') 时
  // Lexical 把两次改动并成一批，联想列表根本不触发；拆成两步实测 100% 出联想。
  const typed = await page(
    ctx,
    "(() => {" +
      "const el = document.querySelector(" + js(TITLE_SEL) + ");" +
      "if (!el) return JSON.stringify({ ok: false, reason: 'no editor' });" +
      "el.focus();" +
      "const sel = window.getSelection(); const range = document.createRange();" +
      "range.selectNodeContents(el); range.collapse(false);" +
      "sel.removeAllRanges(); sel.addRange(range);" +
      "document.execCommand('insertText', false, '#');" +
      "return JSON.stringify({ ok: true });" +
      "})()",
  );
  if (typed.stop) return typed.stop;
  if (!typed.value?.ok) return fail("EDITOR_MISSING", typed.value || {}, "打 # 时找不到作品描述框");
  await sleep(800);
  const word = await page(
    ctx,
    "(() => { const el = document.querySelector(" + js(TITLE_SEL) + ");" +
      "if (!el) return JSON.stringify({ ok: false });" +
      "document.execCommand('insertText', false, " + js(topic) + ");" +
      "return JSON.stringify({ ok: true, now: (el.innerText || '').trim() }); })()",
  );
  if (word.stop) return word.stop;
  if (!word.value?.ok) return fail("EDITOR_MISSING", word.value || {}, "打话题词时找不到作品描述框");

  // 联想项文案是「# 搞笑 #」带空格，class 固定带 topicName；按去空格后的文本比
  const pickerExpr =
    "(() => { const want = " + js(tag) + ";" +
    "const norm = (s) => String(s || '').replace(/\\s+/g, '');" +
    "const pool = Array.from(document.querySelectorAll('[class*=topicName]')).filter(e => e.getBoundingClientRect().width > 0);" +
    "return pool.find(e => norm(e.innerText) === want) || pool.find(e => norm(e.innerText).startsWith(" + js("#" + topic) + ")) || null; })()";
  const listed = await waitFor(
    ctx,
    "(() => { const leaf = " + pickerExpr + "; return JSON.stringify({ found: !!leaf, text: leaf ? (leaf.innerText || '').trim() : '' }); })()",
    (s) => s.found,
    8000,
    300,
  );
  if (listed.stop) return listed.stop;

  if (listed.value?.found) {
    const picked = await page(
      ctx,
      "(() => { const leaf = " + pickerExpr + ";" +
        "if (!leaf) return JSON.stringify({ ok: false });" +
        "['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => leaf.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));" +
        "return JSON.stringify({ ok: true, text: (leaf.innerText || '').trim() }); })()",
    );
    if (picked.stop) return picked.stop;
    // 用「实体数 +1」判定，比文本包含更可靠（多个话题时文本一定都包含）
    const applied = await waitFor(
      ctx,
      "(() => { const el = document.querySelector(" + js(TITLE_SEL) + "); if (!el) return JSON.stringify({ ok: false, count: 0 });" +
        "const c = el.querySelectorAll('[data-tag-type=\"topic\"]').length;" +
        "return JSON.stringify({ ok: c > " + Number(before.count || 0) + ", count: c }); })()",
      (s) => s.ok,
      5000,
      300,
    );
    if (applied.stop) return applied.stop;
    if (applied.value?.ok) return pass({ topic, via: "联想点选", count: applied.value.count });
  }

  // 联想没出来就停在这一步。绝不塞纯文字 #话题#：发布时会被「未匹配的话题」拦下
  return fail("TOPIC_NOT_MATCHED", { topic, listed: listed.value || {}, now: typed.value?.now || "" }, "联想列表里没有「#" + topic + "#」，别硬塞纯文字");
}

async function appendTopic(ctx) {
  const topics = (Array.isArray(ctx.topics) ? ctx.topics : [])
    .map((t) => String(t || "").replace(/^#+|#+$/g, "").trim())
    .filter(Boolean);
  if (topics.length > MAX_TOPICS) {
    return fail("TOPICS_TOO_MANY", { topics, max: MAX_TOPICS }, "话题最多 " + MAX_TOPICS + " 个，现在给了 " + topics.length + " 个");
  }
  if (topics.length < MIN_TOPICS) {
    return fail("TOPICS_TOO_FEW", { topics, min: MIN_TOPICS }, "话题不许少于 " + MIN_TOPICS + " 个，现在只给了 " + topics.length + " 个");
  }
  const done = [];
  for (const t of topics) {
    const r = await appendOneTopic(ctx, t);
    if (!r.ok) return r;
    done.push(t);
  }
  const final = await topicState(ctx);
  if (final.stop) return final.stop;
  if (final.count < MIN_TOPICS) {
    return fail("TOPICS_TOO_FEW", final, "话题实体只落地了 " + final.count + " 个");
  }
  return pass({ topics: done, count: final.count });
}

async function setDeclaration(ctx) {
  const findScript =
    "(() => {" +
    "const el = Array.from(document.querySelectorAll('input,[class*=declar]')).find(e => /创作声明/.test(e.placeholder || '') || /创作声明/.test(((e.innerText)||'')));" +
    "if (!el) return JSON.stringify({ found: false });" +
    "el.click(); return JSON.stringify({ found: true });" +
    "})()";
  const clicked = await page(ctx, findScript);
  if (clicked.stop) return clicked.stop;
  if (!clicked.value?.found) return pass({ skipped: "没有创作声明字段" });
  const waited = await waitFor(
    ctx,
    "(() => { const m = Array.from(document.querySelectorAll('.cheetah-modal')).find(x => /声明/.test(x.innerText||'')); return JSON.stringify({ open: !!m, text: m ? (m.innerText||'').replace(/\\s+/g,' ').slice(0, 80) : '' }); })()",
    (s) => s.open,
    8000,
    250,
  );
  if (waited.stop) return waited.stop;
  if (!waited.value?.open) return pass({ skipped: "声明弹窗没出现", probe: clicked.value });
  const choose = await page(
    ctx,
    "(() => {" +
      "const m = Array.from(document.querySelectorAll('.cheetah-modal')).find(x => /声明/.test(x.innerText||''));" +
      "const label = Array.from(m.querySelectorAll('label,span,div')).find(e => (e.innerText||'').trim() === '无需声明');" +
      "if (!label) return JSON.stringify({ ok: false }); label.click(); return JSON.stringify({ ok: true });" +
      "})()",
  );
  if (choose.stop) return choose.stop;
  if (!choose.value?.ok) return fail("DECLARE_OPTION_MISSING", waited.value, "声明弹窗里没有「无需声明」");
  // 确定必须回读确认弹窗真的关了：没关掉会挡住后面的「定时发布」
  const closed = await dismissOtherModals(ctx);
  if (closed.stop) return closed.stop;
  if (!closed.detail?.cleared) return fail("DECLARE_MODAL_STUCK", closed.detail || {}, "声明弹窗关不掉");
  return pass({ declaration: "无需声明", closed: closed.detail });
}

function assertPublishReady(state) {
  const problems = [];
  if (!state.hasEditor) problems.push("TITLE_EDITOR_MISSING");
  if (!state.title) problems.push("TITLE_EMPTY");
  if (!state.video) problems.push("VIDEO_MISSING");
  // 封面只要有一张（AI 自动选的也算）就算齐活，不再强制两张都换
  if (!(state.coverImgs || []).length) problems.push("COVER_INCOMPLETE");
  const blockers = (state.hints || []).filter((h) => /请上传|请填写|不能为空|未通过|不合格/.test(h));
  if (blockers.length) problems.push("PAGE_BLOCKED:" + blockers.join("|"));
  return problems;
}

/**
 * 作品描述上限 50 字：标题 + 每个话题按「#话题#」计。超了平台直接拒收，必须先拦住。
 * 立即发布和定时发布都要过这一关。
 */
async function assertTextBudget(ctx) {
  const counter = await page(
    ctx,
    "(() => { const m = (document.body.innerText || '').match(/(\\d{1,3})\\s*\\/\\s*(50)\\b/);" +
      "return JSON.stringify({ n: m ? Number(m[1]) : -1, limit: m ? Number(m[2]) : 50 }); })()",
  );
  if (counter.stop) return counter.stop;
  const used = Number(counter.value?.n ?? -1);
  if (used > 50) {
    return fail("TEXT_TOO_LONG", counter.value, "作品描述 " + used + "/50，标题+话题超字数，平台会拒收，先删话题或缩标题");
  }
  return pass({ used });
}

/**
 * 定时发布。
 * ctx.scheduleAt 形如 "2026-11-15 05:00"。平台入口是底部「定时发布」按钮，点开要选日期+时间。
 */
async function schedule(ctx) {
  const at = String(ctx.scheduleAt || "").trim();
  if (!at) return pass({ skipped: "未指定 --schedule" });
  const m = at.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) return fail("SCHEDULE_BAD_FORMAT", { at }, "定时时间要写成 YYYY-MM-DD HH:mm");
  const date = m[1];
  const time = String(m[2]).padStart(2, "0") + ":" + m[3];

  const budget = await assertTextBudget(ctx);
  if (!budget.ok) return budget;

  // 创作声明之类的残留弹窗会挡住底部工具栏，先把它们清干净
  const cleared = await dismissOtherModals(ctx);
  if (cleared.stop) return cleared.stop;

  const openBtn = await page(
    ctx,
    "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.innerText||'').trim() === '定时发布' && !x.disabled && !x.closest('.cheetah-modal'));" +
      "if (!b) return JSON.stringify({ ok: false }); b.scrollIntoView({ block: 'center' }); b.id = 'sparo-schedule-btn';" +
      "const r = b.getBoundingClientRect(); return JSON.stringify({ ok: true, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }); })()",
  );
  if (openBtn.stop) return openBtn.stop;
  if (!openBtn.value?.ok) {
    // 按钮在但 disabled：不是找不到，而是平台不让发（今日额度已满 / 账号被限制）。
    // 实测：本账号当天 2 条已发布 + 3 条定时的第 6 条起，「定时发布」「发布」同时变灰。
    const dis = await page(
      ctx,
      "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.innerText||'').trim() === '定时发布');" +
        "if (!b) return JSON.stringify({ exists: false });" +
        "const pub = Array.from(document.querySelectorAll('button')).find(x => (x.innerText||'').trim() === '发布');" +
        "return JSON.stringify({ exists: true, disabled: b.disabled, publishDisabled: !!pub && pub.disabled }); })()",
    );
    if (dis.stop) return dis.stop;
    if (dis.value?.exists && dis.value?.disabled) {
      return fail("PUBLISH_DISABLED", dis.value, "「定时发布」按钮被平台禁用（发布和定时同时变灰）：当日发布额度已满或账号被限制，换时间再发");
    }
    return fail("SCHEDULE_BUTTON_MISSING", openBtn.value || {}, "没找到「定时发布」按钮");
  }

  // 弹窗是「定时发文」：三个 cheetah-select（日期 / 小时 / 分钟），input 全 readOnly，写 value 没用，
  // 只能点开下拉点选项。默认值 = 当前时间 +1 小时，所以必须显式改。
  const modalExpr =
    "Array.from(document.querySelectorAll('.cheetah-modal')).filter(x => x.getBoundingClientRect().width > 0)" +
    ".find(x => /定时发文|定时发布|选择时间/.test(x.innerText || ''));";
  const probeExpr =
    "(() => { const m = " + modalExpr + "; if (!m) return JSON.stringify({ open: false });" +
    "const sels = Array.from(m.querySelectorAll('.cheetah-select')).map(s => (s.innerText || '').replace(/\\s+/g, ' ').trim());" +
    "const btns = Array.from(m.querySelectorAll('button')).map(b => (b.innerText || '').trim()).filter(Boolean);" +
    "return JSON.stringify({ open: true, sels, btns, text: (m.innerText || '').replace(/\\s+/g, ' ').slice(0, 120) }); })()";
  // 点一次不一定出弹窗（视频还在转码时点了会被吞），最多点 3 次，每次前先把挡路的弹窗清掉
  let opened = null;
  for (let i = 0; i < 3 && !opened; i++) {
    if (i > 0) {
      const again = await dismissOtherModals(ctx);
      if (again.stop) return again.stop;
    }
    // 上一轮残留的弹窗还开着就别再点了，直接用
    const pre = await page(ctx, probeExpr);
    if (pre.stop) return pre.stop;
    if (pre.value?.open) {
      opened = pre.value;
      break;
    }
    const clickExpr =
      "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.innerText||'').trim() === '定时发布' && !x.disabled && !x.closest('.cheetah-modal'));" +
      "if (!b) return JSON.stringify({ ok: false });" +
      "['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));" +
      "return JSON.stringify({ ok: true }); })()";
    const rawJs = await exec(clickExpr, ctx.tabId, ctx.host);
    const jsStopped = blockedCall(rawJs);
    if (jsStopped) return jsStopped;
    const waited = await waitFor(ctx, probeExpr, (s) => s.open, 5000, 300);
    if (waited.stop) return waited.stop;
    if (waited.value?.open) opened = waited.value;
  }
  if (!opened) return fail("SCHEDULE_MODAL_MISSING", { btn: openBtn.value, cleared: cleared.detail }, "点了 3 次定时发布都没出弹窗");
  if ((opened.sels || []).length < 3) {
    return fail("SCHEDULE_MODAL_UNEXPECTED", opened, "定时弹窗里没有「日期/小时/分钟」三个下拉");
  }

  const dateValue = date;
  const dateLabel = Number(m[1].split("-")[1]) + "月" + Number(m[1].split("-")[2]) + "日";
  const hourValue = String(Number(m[2]));
  const hourLabel = hourValue + "点";
  const minuteValue = String(Number(m[3]));
  const minuteLabel = minuteValue + "分";

  // 三个下拉都是 rc-virtual-list 虚拟列表。页面在后台（document.hidden）时 requestAnimationFrame 被暂停，
  // 改 scrollTop 不会触发重渲染，选项永远只渲染前 9 项（9点–17点），18 点以后根本点不到。
  // 所以直接调 Select 组件自身的 onChange —— 和用户点选走同一个入口，不依赖任何渲染。
  const setSelect = async (index, want) => {
    const expr =
      "(() => { const m = " + modalExpr + "; if (!m) return JSON.stringify({ ok: false, reason: 'no modal' });" +
      "const s = m.querySelectorAll('.cheetah-select')[" + index + "]; if (!s) return JSON.stringify({ ok: false, reason: 'no select' });" +
      "const key = Object.keys(s).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));" +
      "if (!key) return JSON.stringify({ ok: false, reason: 'no fiber' });" +
      "let f = s[key], target = null, opts = null;" +
      "while (f) { const p = f.memoizedProps || {};" +
      "if (typeof p.onChange === 'function' && ('popupClassName' in p || 'suffixIcon' in p)) target = f;" +
      "if (!opts && p.value && Array.isArray(p.value.options)) opts = p.value.options;" +
      "f = f.return; }" +
      "if (!target) return JSON.stringify({ ok: false, reason: 'no onChange' });" +
      "if (!opts) return JSON.stringify({ ok: false, reason: 'no options' });" +
      "const list = opts.map(o => ({ v: String(o.value), label: (Array.isArray(o.children) ? o.children.join('') : String(o.children || '')) }));" +
      "const hit = list.find(o => o.v === " + js(want) + ");" +
      "if (!hit) return JSON.stringify({ ok: false, reason: 'not in options', n: list.length, head: list.slice(0, 2).map(o => o.v), tail: list.slice(-2).map(o => o.v) });" +
      "target.memoizedProps.onChange(hit.v, { value: hit.v, label: hit.label });" +
      "return JSON.stringify({ ok: true, label: hit.label, before: String(target.memoizedProps.value) }); })()";
    const r = await page(ctx, expr);
    if (r.stop) return { stop: r.stop };
    await sleep(400);
    return r.value || {};
  };

  const picks = [];
  for (const [i, want, label] of [
    [0, dateValue, dateLabel],
    [1, hourValue, hourLabel],
    [2, minuteValue, minuteLabel],
  ]) {
    const r = await setSelect(i, want);
    if (r.stop) return r.stop;
    if (!r.ok) {
      return fail("SCHEDULE_TIME_UNSETTABLE", { index: i, want, label, detail: r }, "定时弹窗里没有可选值「" + label + "」");
    }
    picks.push({ index: i, value: want, label: r.label, already: r.before === want });
  }

  // 回读三个下拉，确认日期/小时/分钟都对上了
  const check = await page(
    ctx,
    "(() => { const m = " + modalExpr + "; if (!m) return JSON.stringify({ ok: false });" +
      "const sels = Array.from(m.querySelectorAll('.cheetah-select')).map(s => (s.innerText || '').replace(/\\s+/g, ' ').trim());" +
      "const ok = sels[0] === " + js(dateLabel) + " && sels[1] === " + js(hourLabel) + " && sels[2] === " + js(minuteLabel) + ";" +
      "return JSON.stringify({ ok, sels, text: (m.innerText || '').replace(/\\s+/g, ' ').slice(0, 100) }); })()",
  );
  if (check.stop) return check.stop;
  if (!check.value?.ok) return fail("SCHEDULE_TIME_MISMATCH", check.value, "定时时间没设成 " + date + " " + time);

  // 弹窗里的「定时发布」= 提交（不是「确定」）
  const confirmed = await page(
    ctx,
    "(() => { const m = " + modalExpr + "; if (!m) return JSON.stringify({ ok: false, reason: 'no modal' });" +
      "const b = Array.from(m.querySelectorAll('button')).find(x => (x.innerText || '').trim() === '定时发布' && !x.disabled);" +
      "if (!b) return JSON.stringify({ ok: false, reason: 'no submit', btns: Array.from(m.querySelectorAll('button')).map(x => (x.innerText || '').trim()).filter(Boolean) });" +
      "b.click(); return JSON.stringify({ ok: true }); })()",
  );
  if (confirmed.stop) return confirmed.stop;
  if (!confirmed.value?.ok) return fail("SCHEDULE_CONFIRM_MISSING", confirmed.value, "定时弹窗里找不到「定时发布」提交按钮");

  // 提交成功后平台会跳走（rc/clue?...），编辑页里的弹窗 DOM 是 SPA 残留，不能用「弹窗还在」判失败
  const closed = await waitFor(
    ctx,
    "(() => { const m = " + modalExpr + "; return JSON.stringify({ open: !!m, href: location.href }); })()",
    (s) => !s.open || !/\/rc\/edit/.test(String(s.href || "")),
    15000,
    400,
  );
  if (closed.stop) return closed.stop;
  const left = !/\/rc\/edit/.test(String(closed.value?.href || ""));
  if (closed.value?.open && !left) return fail("SCHEDULE_MODAL_STUCK", closed.value, "提交后定时弹窗仍开着");

  ctx.scheduledSubmitted = true;
  return pass({ at, date, time, picks, sels: check.value.sels, href: closed.value?.href || "" });
}

async function publish(ctx) {
  // 定时任务在「定时发布」弹窗点确定那一刻就已经提交，页面会离开编辑器；这里不能再点「发布」
  if (ctx.scheduledSubmitted) return pass({ skipped: "定时任务已提交，无需再点发布" });
  const budget = await assertTextBudget(ctx);
  if (!budget.ok) return budget;
  const account = await enforceAccountGate(ctx, (item) => readBaijiahaoAccount(item));
  if (!account.ok) return account;
  const state = await readState(ctx);
  if (state.stop) return state.stop;
  const problems = assertPublishReady(state);
  if (problems.length) {
    return fail("PUBLISH_NOT_READY", state, "发布前检查没过：" + problems.join("、"));
  }
  // 定了时就必须点「定时发布」那个按钮；点「发布」会立刻发出去，把定时作废
  const publishLabel = ctx.scheduleAt ? "定时发布" : "发布";
  const findBtn =
    "(() => {" +
    "const btn = Array.from(document.querySelectorAll('button')).find(b => ((b.innerText||'').trim() === " + js(publishLabel) + ") && !b.disabled);" +
    "if (!btn) return JSON.stringify({ ok: false });" +
    "const r = btn.getBoundingClientRect();" +
    "btn.id = 'sparo-publish-btn';" +
    "return JSON.stringify({ ok: true, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], inView: r.top >= 0 && r.bottom <= window.innerHeight });" +
    "})()";
  const found = await page(ctx, findBtn);
  if (found.stop) return found.stop;
  if (!found.value?.ok) return fail("PUBLISH_BUTTON_MISSING", { label: publishLabel }, "没找到可点的「" + publishLabel + "」按钮");
  // 底部工具条可能被 AI 助手浮层/吸底条挡住，先滚到视口中间再点
  await page(ctx, "(() => { const b = document.getElementById('sparo-publish-btn'); if (b) b.scrollIntoView({ block: 'center' }); return JSON.stringify({ ok: true }); })()");
  await sleep(300);
  // 发布时可能弹「作品描述中存在未匹配的话题/@内容」：优先点「自动匹配」把话题词变成真话题
  let after = null;
  let resolved = false;
  let attempts = 0;
  // 点一次可能被吞（实测），按效果判成败并自动补点
  for (let attempt = 1; attempt <= 3; attempt++) {
    attempts = attempt;
    const btn = await page(
      ctx,
      "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => ((x.innerText||'').trim() === " + js(publishLabel) + ") && !x.disabled);" +
        "if (!b) return JSON.stringify({ ok: false }); b.id = 'sparo-publish-btn'; const r = b.getBoundingClientRect();" +
        "return JSON.stringify({ ok: true, inView: r.top >= 0 && r.bottom <= window.innerHeight }); })()",
    );
    if (btn.stop) return btn.stop;
    if (!btn.value?.ok) return fail("PUBLISH_BUTTON_MISSING", btn.value || {}, "找不到可点的「" + publishLabel + "」按钮");
    // 前台可见标签优先原生 click（CDP 会被 React 重渲染吞），不行再 CDP
    const rawJs = await exec(
      "(() => { const b = document.getElementById('sparo-publish-btn'); if (!b) return JSON.stringify({ ok: false }); b.click(); return JSON.stringify({ ok: true }); })()",
      ctx.tabId,
      ctx.host,
    );
    const jsStopped = blockedCall(rawJs);
    if (jsStopped) return jsStopped;
    await sleep(800);
    const early = await page(
      ctx,
      "(() => { const body = document.body.innerText || ''; return JSON.stringify({ ok: /发布成功|提交成功|审核中|已发布/.test(body) || !location.href.includes('edit'), href: location.href }); })()",
    );
    if (!early.stop && !early.value?.ok) {
      const raw = await call("click", { selector: "#sparo-publish-btn", tabId: ctx.tabId });
      const stopped = blockedCall(raw);
      if (stopped) return stopped;
    }
    const deadline = Date.now() + 20000;
    while (Date.now() <= deadline) {
      const read = await page(
        ctx,
        "(() => {" +
          "const body = document.body.innerText || '';" +
          "const ok = /发布成功|提交成功|审核中|已发布/.test(body) || !location.href.includes('edit');" +
          "const ms = Array.from(document.querySelectorAll('.cheetah-modal')).filter(m => m.getBoundingClientRect().width > 0);" +
          "const unmatched = ms.find(m => /未匹配的话题/.test(m.innerText || ''));" +
          "return JSON.stringify({ ok, href: location.href, unmatched: !!unmatched, modal: ms.map(m => (m.innerText||'').replace(/\\s+/g,' ').slice(0, 80)) });" +
          "})()",
      );
      if (read.stop) return read.stop;
      after = read.value || {};
      if (after.ok) break;
      if (after.unmatched && !resolved) {
        const answered = await page(
          ctx,
          "(() => { const m = Array.from(document.querySelectorAll('.cheetah-modal')).find(x => x.getBoundingClientRect().width > 0 && /未匹配的话题/.test(x.innerText || ''));" +
            "if (!m) return JSON.stringify({ ok: false });" +
            "const btns = Array.from(m.querySelectorAll('button')).filter(b => b.getBoundingClientRect().width > 0);" +
            "const want = ['自动匹配', '不处理'];" +
            "let btn = null, via = '';" +
            "for (const w of want) { btn = btns.find(b => (b.innerText || '').trim() === w); if (btn) { via = w; break; } }" +
            "if (!btn) return JSON.stringify({ ok: false, texts: btns.map(b => (b.innerText||'').trim()) });" +
            "btn.id = 'sparo-topic-resolve'; return JSON.stringify({ ok: true, via }); })()",
        );
        if (answered.stop) return answered.stop;
        if (answered.value?.ok) {
          // 和封面确定一样，这个按钮只认 CDP 真实鼠标
          const rawPick = await call("click", { selector: "#sparo-topic-resolve", tabId: ctx.tabId });
          const pickStopped = blockedCall(rawPick);
          if (pickStopped) return pickStopped;
          resolved = true;
          after.answeredUnmatched = answered.value.via;
        }
      }
      await sleep(500);
    }
    if (after?.ok) break;
  }
  if (!after?.ok) return fail("PUBLISH_CLICK_NO_EFFECT", { ...(after || {}), attempts }, "点了发布 " + attempts + " 次仍没有跳转或提示");
  return pass({ href: after.href, unmatched: !!after.answeredUnmatched, attempts });
}

async function verify(ctx) {
  // 实测：视频页(type=videoV2)发出去的短片，作品列表里归在「小视频」tab(type=shortVideo)；
  // 定时任务的条目挂在 type=video 的「待发布」页签；发布成功后会先落到 /builder/rc/clue 引导页。
  const LIST_VIDEO = "https://baijiahao.baidu.com/builder/rc/content?currentPage=1&pageSize=10&search=&type=video";
  const LIST_SHORT = "https://baijiahao.baidu.com/builder/rc/content?currentPage=1&pageSize=10&search=&type=shortVideo";
  const probeExpr =
    "(() => { const body = document.body.innerText || ''; return JSON.stringify({ href: location.href, onList: /\\/builder\\/rc\\/content/.test(location.href), hit: body.includes(" + js(String(ctx.title || "")) + "), status: (body.match(/审核中|已发布|定时发布|待发布|预计[\\s\\S]{0,20}发布|发布失败|未通过/) || [''])[0] }); })()";

  let list = await page(ctx, probeExpr);
  if (list.stop) return list.stop;

  const gotoList = async (url) => {
    const raw = await nav(url, ctx.tabId, ctx.host);
    const stopped = blockedCall(raw);
    if (stopped) return { stop: stopped };
    const waited = await waitFor(ctx, probeExpr, (s) => s.onList && s.hit, 20000, 800);
    if (waited.stop) return { stop: waited.stop };
    return { value: waited.value };
  };

  if (!list.value?.hit) {
    // 先看视频（含定时/待发布）
    const v = await gotoList(LIST_VIDEO);
    if (v.stop) return v.stop;
    list = { value: v.value };
    if (!list.value?.hit) {
      // 定时条目在「待发布」页签里
      const tab = await page(
        ctx,
        "(() => { const c = Array.from(document.querySelectorAll('div,span,li,a,button')).filter(e => e.children.length === 0 && (e.innerText||'').trim() === '待发布' && e.getBoundingClientRect().width > 0);" +
          "if (!c.length) return JSON.stringify({ ok: false }); const el = c[c.length - 1]; el.id = 'sparo-tab-pending'; el.click(); return JSON.stringify({ ok: true }); })()",
      );
      if (tab.stop) return tab.stop;
      if (tab.value?.ok) {
        const waited = await waitFor(ctx, probeExpr, (s) => s.onList && s.hit, 12000, 600);
        if (waited.stop) return waited.stop;
        list = { value: waited.value };
      }
    }
  }

  if (!list.value?.hit) {
    // 再看小视频
    const s = await gotoList(LIST_SHORT);
    if (s.stop) return s.stop;
    list = { value: s.value };
    if (list.value?.onList && !list.value?.hit) {
      const tab = await page(
        ctx,
        "(() => { const b = Array.from(document.querySelectorAll('.cheetah-tabs-tab-btn')).find(e => (e.innerText||'').trim() === '小视频' && e.getBoundingClientRect().top < 110);" +
          "if (!b) return JSON.stringify({ ok: false }); (b.closest('.cheetah-tabs-tab') || b).id = 'sparo-tab-shortvideo'; return JSON.stringify({ ok: true }); })()",
      );
      if (tab.stop) return tab.stop;
      if (tab.value?.ok) {
        const tr = await call("click", { selector: "#sparo-tab-shortvideo", tabId: ctx.tabId });
        const tStopped = blockedCall(tr);
        if (tStopped) return tStopped;
        const waited = await waitFor(ctx, probeExpr, (s2) => s2.onList && s2.hit, 20000, 800);
        if (waited.stop) return waited.stop;
        list = { value: waited.value };
      }
    }
  }

  if (!list.value?.onList) return fail("VERIFY_NOT_ON_LIST", list.value || {}, "没能回到作品列表页核对");
  if (!list.value?.hit) return fail("VERIFY_NOT_FOUND", list.value || {}, "列表页没读回这条标题");
  return pass({ status: list.value.status || "已提交", href: list.value.href });
}

/**
 * 上错号兜底：把刚挂进编辑页的视频删掉，绝不留在别人的号里。
 * 先点视频模块里的「删除」并确认；页面没有删除入口（或删不掉）就清本地 videoV2 草稿。
 */
async function removeVideo(ctx) {
  const hasVideoScript = "(() => { const v = document.querySelector('video'); return JSON.stringify({ has: !!v && !!(v.currentSrc || v.src) }); })()";
  const clicked = await page(
    ctx,
    "(() => {" +
      "const inVideo = (el) => { let p = el; for (let i = 0; i < 6 && p; i++, p = p.parentElement) { const c = typeof p.className === 'string' ? p.className : ''; if (/video/i.test(c)) return true; } return false; };" +
      "const hits = Array.from(document.querySelectorAll('div,span,button,a')).filter((el) => {" +
      "const t = (el.innerText || '').trim();" +
      "if (t !== '删除' && t !== '删除视频') return false;" +
      "if (el.children.length) return false;" +
      "const box = el.getBoundingClientRect();" +
      "return box.width > 0 && box.height > 0 && inVideo(el);" +
      "});" +
      "if (!hits.length) return JSON.stringify({ clicked: false });" +
      "const el = hits[hits.length - 1];" +
      "['pointerdown','mousedown','pointerup','mouseup','click'].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));" +
      "return JSON.stringify({ clicked: true, text: (el.innerText || '').trim() });" +
      "})()",
  );
  if (clicked.stop) return clicked.stop;
  let via = "";
  if (clicked.value?.clicked) {
    via = "delete-button";
    await sleep(1500);
    const confirmed = await page(
      ctx,
      "(() => {" +
        "const modals = Array.from(document.querySelectorAll('.cheetah-modal')).filter((m) => m.getBoundingClientRect().width > 0);" +
        "const box = modals[modals.length - 1];" +
        "if (!box) return JSON.stringify({ confirmed: false });" +
        "const btn = Array.from(box.querySelectorAll('button, [class*=btn]')).find((b) => /^(确定|删除|确认)$/.test((b.innerText || '').trim()) && b.getBoundingClientRect().width > 0);" +
        "if (!btn) return JSON.stringify({ confirmed: false });" +
        "btn.click();" +
        "return JSON.stringify({ confirmed: true, text: (btn.innerText || '').trim() });" +
        "})()",
    );
    if (confirmed.stop) return confirmed.stop;
    await sleep(1500);
  }
  const still = await page(ctx, hasVideoScript);
  if (still.stop) return still.stop;
  if (!still.value?.has) return pass({ deleted: true, via: via || "already-gone" });
  const cleared = await page(
    ctx,
    "(() => { const keys = Object.keys(localStorage).filter((k) => /^edit-.*-videoV2$/.test(k)); keys.forEach((k) => localStorage.removeItem(k)); return JSON.stringify({ cleared: keys.length, keys }); })()",
  );
  if (cleared.stop) return cleared.stop;
  if (!Number(cleared.value?.cleared || 0)) return fail("VIDEO_REMOVE_FAILED", { clicked: clicked.value || {}, cleared: cleared.value || {} }, "视频没删掉，也没找到可清的草稿，请人工处理这个号");
  return pass({ deleted: false, draftCleared: cleared.value.cleared, via: via || "draft" });
}

export const baijiahaoVideo = {
  host: "baijiahao.baidu.com",
  writeUrl: "https://baijiahao.baidu.com/builder/rc/edit?type=video",
  writeMark: "/builder/rc/edit",
  editExisting: /article_id=|online_modify/,
  readTitle: async (ctx) => {
    const state = await readState(ctx);
    if (state.stop) return state.stop;
    return pass({ href: state.href, title: state.title });
  },
  uploadVideo,
  waitVideo,
  fillTitle,
  appendTopic,
  probeCover: coverProbeStep,
  setCover,
  setCoverPortrait,
  setDeclaration,
  schedule,
  publish,
  verify,
  removeVideo,
  readAccountName: (ctx) => readBaijiahaoAccount(ctx),
};
