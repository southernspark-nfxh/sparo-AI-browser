// 今日头条。封面是硬校验；广告收益必须回读为已勾。
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
  runSchedule,
  setNativeValue,
  sleep,
  uploadPicked,
  waitEditor,
} from "../page.mjs";
import { nav } from "../sparo.mjs";

export const toutiao = {
  id: "toutiao",
  host: "mp.toutiao.com",
  writeUrl: "https://mp.toutiao.com/profile_v4/graphic/publish",
  writeMark: "/graphic/publish",
  listUrl: "https://mp.toutiao.com/profile_v4/graphic/articles",

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
    for (const file of ctx.images) {
      const opened = await page(
        ctx,
        "(() => {" +
          "const pm = document.querySelector('.ProseMirror');" +
          "if (pm) { pm.focus(); const sel = window.getSelection(); if (sel) { sel.selectAllChildren(pm); sel.collapseToEnd(); } }" +
          "const btn = document.querySelector('.syl-toolbar-tool.image .syl-toolbar-button');" +
          "if (!btn) return JSON.stringify({ ok: false });" +
          "btn.click();" +
          "return JSON.stringify({ ok: true });" +
          "})()",
      );
      if (opened.stop) return opened.stop;
      if (!opened.value?.ok) return fail("IMAGE_ENTRY_MISSING", file, "没有找到头条插图按钮");
      await sleep(800);
      const blocked = await guard(ctx);
      if (blocked) return blocked;
      const uploaded = await uploadPicked(ctx, file, ".mp-ic-img-drawer");
      if (!uploaded.ok) return uploaded;
      await sleep(700);
      const confirmed = await page(
        ctx,
        "(() => {" +
          "const drawer = document.querySelector('.mp-ic-img-drawer');" +
          "if (!drawer) return JSON.stringify({ ok: false });" +
          "const btn = Array.from(drawer.querySelectorAll('button, [role=button]')).find((el) => (el.innerText || '').replace(/\\s+/g, '') === '确定');" +
          "if (!btn) return JSON.stringify({ ok: false });" +
          "btn.click();" +
          "return JSON.stringify({ ok: true });" +
          "})()",
      );
      if (confirmed.stop) return confirmed.stop;
      if (!confirmed.value?.ok) return fail("IMAGE_CONFIRM_MISSING", file, await pageHint(ctx));
      await sleep(600);
    }
    const count = await page(
      ctx,
      "(() => JSON.stringify({ count: document.querySelectorAll('.ProseMirror .pgc-img').length, imgs: document.querySelectorAll('.ProseMirror img').length }))()",
    );
    if (count.stop) return count.stop;
    ctx.imageCount = count.value?.count ?? count.value?.imgs ?? 0;
    if (ctx.imageCount < 1) return fail("IMAGES_UNREAD", count.value, "正文图回读为 0");
    return pass({ count: ctx.imageCount });
  },

  async setCover(ctx) {
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
    const blocked = await guard(ctx);
    if (blocked) return blocked;
    const uploaded = await uploadPicked(ctx, ctx.cover, ".mp-ic-img-drawer", true);
    if (!uploaded.ok) return uploaded;
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
      "const ad = radios.find((item) => item.text.includes('投放广告赚收益'));" +
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
      "const label = Array.from(document.querySelectorAll('label')).find((el) => (el.innerText || '').includes('投放广告赚收益'));" +
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
    if (!state.adFound) return fail("AD_CONTROL_MISSING", state, "没有找到「投放广告赚收益」");
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
    if (!state.adChecked) return fail("AD_ASSERT_FAIL", state, "投放广告赚收益没有选中");
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
        "ad: Array.from(document.querySelectorAll('label')).some((el) => (el.innerText || '').includes('投放广告赚收益'))" +
        "}))()",
    );
    if (read.stop) return read.stop;
    return pass(read.value);
  },
};

async function schedule(ctx) {
  const human = await guard(ctx);
  if (human) return human;
  const filled = await runSchedule(ctx);
  if (!filled.ok) return filled;
  const confirm = await clickLabeled(ctx, "确定");
  if (!confirm.ok) return fail("SCHEDULE_CONFIRM_MISSING", filled.detail, await pageHint(ctx));
  return pass({ mode: "schedule", at: ctx.schedule.text, readback: filled.detail });
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
    images: read.value.images ? Number(read.value.images) : ctx.imageCount,
    link,
    href: where.ok ? where.detail.href : "",
    options: ctx.options || null,
  });
}
