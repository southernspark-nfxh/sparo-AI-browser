// 大鱼号。封面只能从正文里选，所以正文要先有 3 张不同的图。
import {
  clickLabeled,
  fail,
  guard,
  openWriteTab,
  page,
  pageHint,
  pass,
  setNativeValue,
  sleep,
  uploadPicked,
  waitEditor,
} from "../page.mjs";
import { nav } from "../sparo.mjs";
import { loadProfile } from "../profile.mjs";

const profile = loadProfile("dayu");
const DISTINCT_IMAGES = profile.limits.minDistinctImages;
const COVER_MODE = profile.image.coverMode;
const SOURCE_PLAIN = profile.switches.defaults.find((item) => item.id === "source").label;

export const dayu = {
  id: profile.id,
  host: profile.entry.host,
  writeUrl: profile.entry.writeUrl,
  writeMark: "/dashboard/article/write",
  listUrl: profile.entry.listUrl,

  async openBlank(ctx) {
    const opened = await openWriteTab(ctx);
    if (!opened.ok) return opened;
    const editor = await waitEditor(ctx, "#ueditor_0");
    if (!editor.ok) return editor;
    return pass({ tabId: ctx.tabId, href: editor.detail.href });
  },

  async fillTitle(ctx) {
    const selectors = [".article-write_box-title-input", 'input[placeholder*="标题"]'];
    let last = null;
    for (const selector of selectors) {
      last = await page(ctx, setNativeValue(selector, ctx.title));
      if (last.mismatch) return fail("MISMATCH", last.mismatch);
      if (last.value?.ok) return pass({ len: last.value.len });
    }
    return fail("TITLE_UNREAD", last?.value || "NO_INPUT", "标题回读不一致");
  },

  async fillBody(ctx) {
    const script =
      "(() => {" +
      "const iframe = document.querySelector('#ueditor_0');" +
      "if (!iframe) return JSON.stringify({ ok: false, code: 'NO_IFRAME' });" +
      "const html = " + JSON.stringify(ctx.bodyHtml) + ";" +
      "try {" +
      "const ue = iframe.contentWindow.UE;" +
      "const editor = ue && ue.getEditor && ue.getEditor('ueditor_0');" +
      "if (editor && editor.setContent) { editor.setContent(html); return JSON.stringify({ ok: true, len: editor.getContentLength(true) }); }" +
      "} catch (err) {}" +
      "const body = iframe.contentDocument.body;" +
      "body.innerHTML = html;" +
      "return JSON.stringify({ ok: (body.innerText || '').trim().length > 0, len: (body.innerText || '').trim().length });" +
      "})()";
    const read = await page(ctx, script);
    if (read.mismatch) return fail("MISMATCH", read.mismatch);
    if (!read.value?.ok) return fail("BODY_UNREAD", read.value, "正文没有写进去");
    return pass({ len: read.value.len });
  },

  async insertImages(ctx) {
    if (ctx.images.length < DISTINCT_IMAGES) {
      return fail(
        "NEED_3_DISTINCT_IMAGES",
        { have: ctx.images.length, droppedDuplicates: ctx.droppedDuplicates || 0, need: DISTINCT_IMAGES },
        "大鱼封面要从正文选 " + DISTINCT_IMAGES + " 张不同的图，images/ 里现在不够",
      );
    }
    const files = ctx.images.slice(0, DISTINCT_IMAGES);
    for (const file of files) {
      const opened = await page(
        ctx,
        "(() => {" +
          "const iframe = document.querySelector('#ueditor_0');" +
          "iframe?.contentWindow?.focus();" +
          "const btn = document.querySelector('.edui-for-pic, .edui-for-insertimage');" +
          "if (!btn) return JSON.stringify({ ok: false });" +
          "btn.click();" +
          "return JSON.stringify({ ok: true });" +
          "})()",
      );
      if (opened.mismatch) return fail("MISMATCH", opened.mismatch);
      if (!opened.value?.ok) return fail("IMAGE_ENTRY_MISSING", file, "没有找到大鱼插图按钮");
      await sleep(800);
      const blocked = await guard(ctx);
      if (blocked) return blocked;
      const uploaded = await uploadPicked(ctx, file, "body");
      if (!uploaded.ok) return uploaded;
      await sleep(700);
      const confirmed = await clickLabeled(ctx, "确定");
      if (!confirmed.ok) return fail("IMAGE_CONFIRM_MISSING", file, await pageHint(ctx));
      await sleep(500);
    }
    const counted = await countImages(ctx);
    if (!counted.ok) return counted;
    if (counted.detail.distinct < DISTINCT_IMAGES) {
      return fail("NEED_3_DISTINCT_IMAGES", counted.detail, "正文里不同图片不足 " + DISTINCT_IMAGES + " 张，封面步骤不会开始");
    }
    ctx.imageCount = counted.detail.distinct;
    return pass(counted.detail);
  },

  async setCover(ctx) {
    const counted = await countImages(ctx);
    if (!counted.ok) return counted;
    if (counted.detail.distinct < DISTINCT_IMAGES) {
      return fail("NEED_3_DISTINCT_IMAGES", counted.detail, "封面前正文必须先有 " + DISTINCT_IMAGES + " 张不同的图");
    }
    const opened = await page(
      ctx,
      "(() => {" +
        "const options = Array.from(document.querySelectorAll('.article-write-article-cover_normal-option, label, span, div'));" +
        "const triple = options.find((el) => {" +
        "const t = (el.innerText || '').replace(/\\s+/g, '');" +
        "return t === " + JSON.stringify(COVER_MODE) + " || t === '三封面' || t.includes(" + JSON.stringify(COVER_MODE) + ");" +
        "});" +
        "if (triple) triple.click();" +
        "const choose = Array.from(document.querySelectorAll('button, span, a')).find((el) => (el.innerText || '').includes('从正文中选择'));" +
        "if (!choose) return JSON.stringify({ ok: false, triple: !!triple });" +
        "const rect = choose.getBoundingClientRect();" +
        "if (rect.width < 10 || rect.height < 10) return JSON.stringify({ ok: false, hidden: true });" +
        "choose.click();" +
        "return JSON.stringify({ ok: true });" +
        "})()",
    );
    if (opened.mismatch) return fail("MISMATCH", opened.mismatch);
    if (!opened.value?.ok) return fail("COVER_ENTRY_MISSING", opened.value, "大鱼封面只能从正文选，入口没出现");
    await sleep(800);
    const picked = await page(
      ctx,
      "(() => {" +
        "const imgs = Array.from(document.querySelectorAll('img')).filter((img) => {" +
        "const src = img.getAttribute('src') || '';" +
        "const rect = img.getBoundingClientRect();" +
        "return src && rect.width > 10 && rect.height > 10;" +
        "});" +
        "const seen = new Set();" +
        "let n = 0;" +
        "for (const img of imgs) {" +
        "const src = img.getAttribute('src');" +
        "if (seen.has(src)) continue;" +
        "seen.add(src);" +
        "(img.closest('[class*=\"item\"], [class*=\"cover\"]') || img).click();" +
        "n += 1;" +
        "if (n >= " + DISTINCT_IMAGES + ") break;" +
        "}" +
        "return JSON.stringify({ ok: n >= " + DISTINCT_IMAGES + ", n });" +
        "})()",
    );
    if (picked.mismatch) return fail("MISMATCH", picked.mismatch);
    if (!picked.value?.ok) return fail("COVER_REJECTED", picked.value, COVER_MODE + "封面没选满 " + DISTINCT_IMAGES + " 张不同的图");
    const confirmed = await clickLabeled(ctx, "确定");
    if (!confirmed.ok) return fail("COVER_CONFIRM_MISSING", "确定", await pageHint(ctx));
    const hint = await pageHint(ctx);
    if (/三图|封面/.test(hint) && /请完成|失败|不符/.test(hint)) return fail("COVER_REJECTED", hint, hint);
    ctx.coverCount = DISTINCT_IMAGES;
    return pass({ cover: 3, distinct: counted.detail.distinct });
  },

  async setOptions(ctx) {
    const want = ctx.aiImages ? "AI生成" : SOURCE_PLAIN;
    const script =
      "(() => {" +
      "const want = " + JSON.stringify(want) + ";" +
      "const label = Array.from(document.querySelectorAll('label, .ant-radio-wrapper')).find((el) => (el.innerText || '').replace(/\\s+/g, '').includes(want));" +
      "if (!label) return JSON.stringify({ found: false, want });" +
      "label.click();" +
      "const checked = document.querySelector('.ant-radio-wrapper-checked');" +
      "const text = (checked?.innerText || '').replace(/\\s+/g, '');" +
      "return JSON.stringify({ found: true, ok: text.includes(want), text, want });" +
      "})()";
    const read = await page(ctx, script);
    if (read.mismatch) return fail("MISMATCH", read.mismatch);
    if (!read.value?.found) return fail("SOURCE_CONTROL_MISSING", read.value, "没有找到信息来源「" + want + "」");
    if (!read.value.ok) return fail("SOURCE_ASSERT_FAIL", read.value, "信息来源回读不是「" + want + "」");
    ctx.options = { source: want, aiImages: !!ctx.aiImages };
    return pass(ctx.options);
  },

  async publishOrSchedule(ctx) {
    const blocked = await guard(ctx);
    if (blocked) return blocked;
    const options = await this.setOptions(ctx);
    if (!options.ok) return options;
    const counted = await countImages(ctx);
    if (!counted.ok) return counted;
    if (counted.detail.distinct < DISTINCT_IMAGES) return fail("NEED_3_DISTINCT_IMAGES", counted.detail, "发表前正文不同图片不足 " + DISTINCT_IMAGES + " 张");
    if (ctx.schedule) {
      const opened = await clickLabeled(ctx, "定时发布");
      if (!opened.ok) return fail("SCHEDULE_ENTRY_MISSING", "定时发布", "大鱼没有找到定时发布入口，已停手，没有点发表");
      await sleep(600);
      const clock = await fillClock(ctx);
      if (!clock.ok) return clock;
    }
    const publish = await clickLabeled(ctx, "发表");
    if (!publish.ok) return fail("PUBLISH_BUTTON_MISSING", "发表", await pageHint(ctx));
    await sleep(1000);
    const human = await guard(ctx);
    if (human) return human;
    const confirm = await clickLabeled(ctx, "确认发表");
    if (!confirm.ok) return fail("PUBLISH_CONFIRM_MISSING", "确认发表", await pageHint(ctx));
    await sleep(1200);
    return pass({ mode: ctx.schedule ? "schedule" : "now", at: ctx.schedule?.text || "" });
  },

  async verify(ctx) {
    const moved = await nav(this.listUrl, ctx.tabId);
    if (String(moved).startsWith("MISMATCH")) return fail("MISMATCH", moved);
    await sleep(1500);
    const script =
      "(() => {" +
      "const want = " + JSON.stringify(ctx.title) + ";" +
      "const text = (document.body?.innerText || '').slice(0, 8000);" +
      "let status = '';" +
      "if (/已发布/.test(text)) status = '已发布';" +
      "else if (/审核中/.test(text)) status = '审核中';" +
      "else if (/定时|待发布/.test(text)) status = '定时';" +
      "const images = /3\\s*张/.test(text) ? 3 : null;" +
      "return JSON.stringify({ hit: text.includes(want), status, images, href: location.href });" +
      "})()";
    const read = await page(ctx, script);
    if (read.mismatch) return fail("MISMATCH", read.mismatch);
    if (!read.value?.hit) return fail("LIST_ROW_MISSING", read.value, "内容管理里没有这篇标题");
    return pass({
      platform: this.id,
      title: ctx.title,
      time: ctx.schedule?.text || "",
      status: read.value.status || "待回访",
      images: read.value.images ?? ctx.imageCount,
      link: /审核中|定时/.test(read.value.status || "") ? "待回访" : read.value.href,
      href: read.value.href,
      options: ctx.options || null,
    });
  },

  async probe(ctx) {
    const images = await countImages(ctx);
    return pass({ href: (await page(ctx, "(() => JSON.stringify({ href: location.href }))()")).value?.href, images: images.detail || images });
  },
};

async function countImages(ctx) {
  const read = await page(
    ctx,
    "(() => {" +
      "const iframe = document.querySelector('#ueditor_0');" +
      "if (!iframe?.contentDocument) return JSON.stringify({ ok: false });" +
      "const srcs = Array.from(iframe.contentDocument.querySelectorAll('img')).map((img) => img.getAttribute('src') || '').filter(Boolean);" +
      "return JSON.stringify({ ok: true, count: srcs.length, distinct: new Set(srcs).size });" +
      "})()",
  );
  if (read.mismatch) return fail("MISMATCH", read.mismatch);
  if (!read.value?.ok) return fail("NO_IFRAME", read.value, "没有读到大鱼正文框");
  return pass(read.value);
}

async function fillClock(ctx) {
  const read = await page(
    ctx,
    "(() => {" +
      "const set = (el, val) => {" +
      "if (!el) return false;" +
      "const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;" +
      "if (setter) setter.call(el, val); else el.value = val;" +
      "el.dispatchEvent(new Event('input', { bubbles: true }));" +
      "el.dispatchEvent(new Event('change', { bubbles: true }));" +
      "return el.value === val;" +
      "};" +
      "const dateOk = set(document.querySelector('input[type=\"date\"]'), " + JSON.stringify(ctx.schedule.date) + ");" +
      "const timeOk = set(document.querySelector('input[type=\"time\"]'), " + JSON.stringify(ctx.schedule.time) + ");" +
      "return JSON.stringify({ dateOk, timeOk });" +
      "})()",
  );
  if (read.mismatch) return fail("MISMATCH", read.mismatch);
  if (!read.value?.dateOk || !read.value?.timeOk) {
    return fail("SCHEDULE_CONTROLS_MISSING", read.value, "定时控件没有回读到 " + ctx.schedule.text);
  }
  return pass(read.value);
}
