// 搜狐号。定时入口没探测到就停，不改点「发布」。
import { clickExact, clickLabeled, fail, guard, page, pageHint, pass, setNativeValue, sleep, uploadPicked, waitEditor } from "../page.mjs";
import { call, nav, tabRows, tabs, useTab } from "../sparo.mjs";

const LIST_URL = "https://mp.sohu.com/mpfe/v4/contentManagement/first/page";

export const sohu = {
  id: "sohu",
  host: "mp.sohu.com",
  writeUrl: LIST_URL,
  writeMark: "addarticle",
  listUrl: LIST_URL,

  async openBlank(ctx) {
    const list = tabRows(await tabs());
    const mine = list.filter((tab) => String(tab.url || "").includes(ctx.host));
    const editor = mine.find((tab) => String(tab.url || "").includes("addarticle"));
    const home = mine.find((tab) => String(tab.url || "").includes("contentManagement/first"));
    let tabId = editor?.id || home?.id || "";
    if (!tabId) {
      const before = new Set(list.map((tab) => tab.id));
      await call("navigate", { url: LIST_URL });
      await sleep(1000);
      const created = tabRows(await tabs()).find((tab) => !before.has(tab.id) && String(tab.url || "").includes(ctx.host));
      if (!created?.id) return fail("NO_TAB", LIST_URL, "没有打开搜狐号标签");
      tabId = created.id;
    }
    const pin = await useTab(tabId, ctx.host);
    if (String(pin).startsWith("MISMATCH")) return fail("MISMATCH", pin);
    ctx.tabId = tabId;
    const href = await page(ctx, "(() => JSON.stringify({ href: location.href }))()");
    if (href.mismatch) return fail("MISMATCH", href.mismatch);
    if (/clientAuth|login/i.test(href.value?.href || "")) return fail("LOGIN", href.value.href, "搜狐号要短信验证，交给用户");
    if (!String(href.value?.href || "").includes("addarticle")) {
      if (!String(href.value?.href || "").includes("contentManagement/first")) {
        const moved = await nav(LIST_URL, ctx.tabId);
        if (String(moved).startsWith("MISMATCH")) return fail("MISMATCH", moved);
        await sleep(800);
      }
      const entry = await clickLabeled(ctx, "发布内容");
      if (!entry.ok) return fail("ENTRY_NOT_FOUND", "发布内容", "搜狐后台入口没出现");
      await sleep(500);
      const article = await clickLabeled(ctx, "文章");
      if (!article.ok) return fail("ENTRY_NOT_FOUND", "文章", "没有点到搜狐发文章");
      await sleep(1000);
    }
    const ready = await waitEditor(ctx, ".ql-editor");
    if (!ready.ok) return ready;
    return pass({ tabId: ctx.tabId, href: ready.detail.href });
  },

  async fillTitle(ctx) {
    const read = await page(ctx, setNativeValue('input[placeholder*="请输入标题"]', ctx.title));
    if (read.mismatch) return fail("MISMATCH", read.mismatch);
    if (!read.value?.ok) return fail("TITLE_UNREAD", read.value, "标题回读不一致");
    return pass({ len: read.value.len });
  },

  async fillBody(ctx) {
    const script =
      "(() => {" +
      "const editor = document.querySelector('.ql-editor');" +
      "if (!editor) return JSON.stringify({ ok: false, code: 'NO_EDITOR' });" +
      "editor.focus();" +
      "const plain = " + JSON.stringify(ctx.body) + ";" +
      "const dt = new DataTransfer();" +
      "dt.setData('text/plain', plain);" +
      "editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));" +
      "const len = (editor.innerText || '').trim().length;" +
      "return JSON.stringify({ ok: len > 0, len });" +
      "})()";
    const read = await page(ctx, script);
    if (read.mismatch) return fail("MISMATCH", read.mismatch);
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
          "const btn = document.querySelector('.editor-icon.mp-icon-image');" +
          "if (!btn) return JSON.stringify({ ok: false });" +
          "btn.click();" +
          "return JSON.stringify({ ok: true });" +
          "})()",
      );
      if (opened.mismatch) return fail("MISMATCH", opened.mismatch);
      if (!opened.value?.ok) return fail("IMAGE_ENTRY_MISSING", file, "没有找到搜狐插图按钮");
      await sleep(700);
      const blocked = await guard(ctx);
      if (blocked) return blocked;
      const uploaded = await uploadPicked(ctx, file, ".win-mask");
      if (!uploaded.ok) return uploaded;
      await sleep(700);
      const confirmed = await page(
        ctx,
        "(() => {" +
          "const masks = Array.from(document.querySelectorAll('.win-mask'));" +
          "const top = masks[masks.length - 1];" +
          "const btn = top?.querySelector('p.button.positive-button');" +
          "if (!btn) return JSON.stringify({ ok: false });" +
          "btn.click();" +
          "return JSON.stringify({ ok: true });" +
          "})()",
      );
      if (confirmed.mismatch) return fail("MISMATCH", confirmed.mismatch);
      if (!confirmed.value?.ok) return fail("IMAGE_CONFIRM_MISSING", file, await pageHint(ctx));
      await sleep(500);
    }
    const count = await page(ctx, "(() => JSON.stringify({ count: document.querySelectorAll('.ql-editor img').length }))()");
    if (count.mismatch) return fail("MISMATCH", count.mismatch);
    ctx.imageCount = count.value?.count || 0;
    if (ctx.imageCount < 1) return fail("IMAGES_UNREAD", count.value, "正文图回读为 0");
    return pass({ count: ctx.imageCount });
  },

  async setCover(ctx) {
    const opened = await clickLabeled(ctx, "上传图片");
    if (!opened.ok) return fail("COVER_ENTRY_MISSING", "上传图片", await pageHint(ctx));
    await sleep(500);
    await clickLabeled(ctx, "本地上传");
    const uploaded = await uploadPicked(ctx, ctx.cover, ".win-mask");
    if (!uploaded.ok) return uploaded;
    await sleep(800);
    const confirmed = await page(
      ctx,
      "(() => {" +
        "const btn = document.querySelector('.win-mask p.button.positive-button');" +
        "if (!btn) return JSON.stringify({ ok: false });" +
        "btn.click();" +
        "return JSON.stringify({ ok: true });" +
        "})()",
    );
    if (confirmed.mismatch) return fail("MISMATCH", confirmed.mismatch);
    if (!confirmed.value?.ok) return fail("COVER_CONFIRM_MISSING", "确定", await pageHint(ctx));
    const hint = await pageHint(ctx);
    if (/封面/.test(hint) && /失败|不符|太小|请/.test(hint)) return fail("COVER_REJECTED", hint, hint);
    ctx.coverCount = 1;
    return pass({ cover: 1 });
  },

  async setOptions(ctx) {
    const script =
      "(() => {" +
      "const radios = Array.from(document.querySelectorAll('.el-radio, label'));" +
      "const plain = radios.find((el) => (el.innerText || '').replace(/\\s+/g, '').includes('无需声明'));" +
      "const ai = radios.find((el) => /AI生成|含有AI/.test(el.innerText || ''));" +
      "if (plain) plain.click();" +
      "const checkedText = radios.filter((el) => el.className.includes('is-checked') || el.querySelector('input')?.checked).map((el) => (el.innerText || '').trim());" +
      "return JSON.stringify({ found: !!plain, aiChecked: !!(ai && (ai.className.includes('is-checked') || ai.querySelector('input')?.checked)), checkedText });" +
      "})()";
    const read = await page(ctx, script);
    if (read.mismatch) return fail("MISMATCH", read.mismatch);
    if (!read.value?.found) return fail("DECLARE_CONTROL_MISSING", read.value, "没有找到「无需声明」");
    if (read.value.aiChecked) return fail("AI_STILL_CHECKED", read.value, "搜狐创作声明勾在了 AI 上");
    const again = await page(ctx, script);
    if (again.mismatch) return fail("MISMATCH", again.mismatch);
    if (!again.value?.checkedText?.some((text) => text.includes("无需声明"))) {
      return fail("DECLARE_ASSERT_FAIL", again.value, "创作声明回读不是「无需声明」");
    }
    ctx.options = { declare: "无需声明", aiChecked: false };
    return pass(ctx.options);
  },

  async publishOrSchedule(ctx) {
    const blocked = await guard(ctx);
    if (blocked) return blocked;
    const options = await this.setOptions(ctx);
    if (!options.ok) return options;
    if (ctx.schedule) {
      const found = await page(
        ctx,
        "(() => {" +
          "const nodes = Array.from(document.querySelectorAll('button,[role=\"button\"],a,label,span,li,div'));" +
          "const hits = [];" +
          "for (const el of nodes) {" +
          "const t = (el.innerText || '').replace(/\\s+/g, '').trim();" +
          "if (!t || t.length > 12 || !/定时/.test(t)) continue;" +
          "const r = el.getBoundingClientRect();" +
          "if (r.width < 8 || r.height < 8) continue;" +
          "hits.push(t);" +
          "}" +
          "return JSON.stringify({ hits: Array.from(new Set(hits)).slice(0, 8) });" +
          "})()",
      );
      if (found.mismatch) return fail("MISMATCH", found.mismatch);
      const hits = found.value?.hits || [];
      if (!hits.length) {
        return fail("SCHEDULE_ENTRY_MISSING", hits, "搜狐号没有找到定时发布入口，已停手，没有点发布");
      }
      const opened = await page(ctx, clickExact(hits.includes("定时发布") ? "定时发布" : hits[0]));
      if (opened.mismatch) return fail("MISMATCH", opened.mismatch);
      if (!opened.value?.ok) return fail("SCHEDULE_ENTRY_MISSING", hits, "搜狐定时入口点不开，已停手，没有点发布");
      await sleep(700);
      const clock = await page(
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
          "return JSON.stringify({ dateOk: set(document.querySelector('input[type=\"date\"]'), " + JSON.stringify(ctx.schedule.date) + "), timeOk: set(document.querySelector('input[type=\"time\"]'), " + JSON.stringify(ctx.schedule.time) + ") });" +
          "})()",
      );
      if (clock.mismatch) return fail("MISMATCH", clock.mismatch);
      if (!clock.value?.dateOk || !clock.value?.timeOk) {
        return fail("SCHEDULE_CONTROLS_MISSING", { hits, clock: clock.value }, "搜狐定时入口在，但时间控件没写上。已停手，没有点发布");
      }
      const confirm = await clickLabeled(ctx, "确定");
      if (!confirm.ok) return fail("SCHEDULE_CONFIRM_MISSING", clock.value, "定时时间已回读，确认按钮没找到。没有点发布");
      return pass({ mode: "schedule", at: ctx.schedule.text, hits });
    }
    const publish = await page(
      ctx,
      "(() => {" +
        "const btn = document.querySelector('li.publish-report-btn.active.positive-button') || Array.from(document.querySelectorAll('li,button')).find((el) => (el.innerText || '').trim() === '发布');" +
        "if (!btn) return JSON.stringify({ ok: false });" +
        "btn.click();" +
        "return JSON.stringify({ ok: true });" +
        "})()",
    );
    if (publish.mismatch) return fail("MISMATCH", publish.mismatch);
    if (!publish.value?.ok) return fail("PUBLISH_BUTTON_MISSING", "发布", await pageHint(ctx));
    await sleep(1500);
    const human = await guard(ctx);
    if (human) return human;
    return pass({ mode: "now" });
  },

  async verify(ctx) {
    const moved = await nav(LIST_URL, ctx.tabId);
    if (String(moved).startsWith("MISMATCH")) return fail("MISMATCH", moved);
    await sleep(1500);
    const script =
      "(() => {" +
      "const want = " + JSON.stringify(ctx.title) + ";" +
      "const text = (document.body?.innerText || '').slice(0, 8000);" +
      "let status = '';" +
      "if (/审核中/.test(text)) status = '审核中';" +
      "else if (/已发布/.test(text)) status = '已发布';" +
      "else if (/定时|待发布/.test(text)) status = '定时';" +
      "const time = (text.match(/\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}/) || [])[0] || '';" +
      "return JSON.stringify({ hit: text.includes(want), status, time, href: location.href });" +
      "})()";
    const read = await page(ctx, script);
    if (read.mismatch) return fail("MISMATCH", read.mismatch);
    if (!read.value?.hit) return fail("LIST_ROW_MISSING", read.value, "搜狐列表里没有这篇标题");
    return pass({
      platform: this.id,
      title: ctx.title,
      time: read.value.time || ctx.schedule?.text || "",
      status: read.value.status || "待回访",
      images: ctx.imageCount || 0,
      link: /审核中|定时/.test(read.value.status || "") ? "待回访" : read.value.href,
      href: read.value.href,
      options: ctx.options || null,
    });
  },

  async probe(ctx) {
    const read = await page(
      ctx,
      "(() => {" +
        "const nodes = Array.from(document.querySelectorAll('button,a,label,span,li,div'));" +
        "const schedule = Array.from(new Set(nodes.map((el) => (el.innerText || '').replace(/\\s+/g, '').trim()).filter((t) => t && t.length < 12 && /定时/.test(t)))).slice(0, 8);" +
        "return JSON.stringify({ href: location.href, editor: !!document.querySelector('.ql-editor'), schedule });" +
        "})()",
    );
    if (read.mismatch) return fail("MISMATCH", read.mismatch);
    return pass(read.value);
  },
};
