// 统一入口：
// node publish.mjs --platform toutiao --article <目录> [--schedule "YYYY-MM-DD HH:mm"] [--dry-run]
// node publish.mjs --platforms toutiao,baijiahao,dayu,sohu --plan
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadArticle, toParagraphHtml } from "./article.mjs";

const PLATFORMS = ["toutiao", "baijiahao", "dayu", "sohu"];
const SCHEDULE_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/;

export const USAGE = [
  "用法：node publish.mjs --platform toutiao|baijiahao|dayu|sohu --article <目录> [--schedule \"YYYY-MM-DD HH:mm\"] [--from 步骤] [--dry-run] [--ai-images] [--probe] [--ledger <文件>]",
  "用法：node publish.mjs --platforms toutiao,baijiahao,dayu,sohu --plan",
  "平台：toutiao、baijiahao、dayu、sohu。--plan 只读规则表，不连接 Sparo，不打开编辑页，不填稿。",
  "文章目录：title.txt、body.md、cover.jpg、images/",
  "定时必须带时间。搜狐找不到定时入口会停手，不会改点发布。",
  "大鱼封面前正文要有 3 张不同的图。头条必勾「投放广告赚收益」。百家不勾「采用AI生成内容」。",
].join("\n");

export function parseArgs(argv) {
  const out = {
    platform: "",
    article: "",
    schedule: null,
    dryRun: false,
    aiImages: false,
    probe: false,
    ledger: "",
    selfCheck: false,
    from: "",
    platforms: [],
    plan: false,
    help: false,
    error: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--self-check") out.selfCheck = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--ai-images") out.aiImages = true;
    else if (arg === "--probe") out.probe = true;
    else if (arg === "--plan") out.plan = true;
    else if (arg === "--platform") out.platform = argv[++i] || "";
    else if (arg === "--platforms") {
      const next = argv[++i] || "";
      const ids = next.split(",").map((item) => item.trim()).filter(Boolean);
      if (!ids.length || ids.some((id) => !PLATFORMS.includes(id))) out.error = "平台只能是 " + PLATFORMS.join(" / ");
      else out.platforms = ids;
    }
    else if (arg === "--article") out.article = argv[++i] || "";
    else if (arg === "--ledger") out.ledger = argv[++i] || "";
    else if (arg === "--from") {
      const next = argv[++i] || "";
      const allowed = ["openBlank", "fillTitle", "fillBody", "insertImages", "setCover", "setOptions", "publishOrSchedule", "verify"];
      if (!allowed.includes(next)) out.error = "续跑步骤只能是 " + allowed.join(" / ");
      else out.from = next;
    } else if (arg === "--schedule") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--") || !SCHEDULE_RE.test(next)) {
        out.error = '定时发布要带时间：--schedule "YYYY-MM-DD HH:mm"';
      } else {
        const matched = SCHEDULE_RE.exec(argv[++i]);
        out.schedule = { date: matched[1], time: matched[2], text: matched[1] + " " + matched[2] };
      }
    } else {
      out.error = "不认识的参数：" + arg;
    }
    if (out.error) break;
  }
  if (!out.error && !out.help && !out.selfCheck) {
    if (out.plan) {
      if (!out.platforms.length && out.platform) out.platforms = [out.platform];
      if (!out.platforms.length) out.error = "缺少 --platforms " + PLATFORMS.join(",");
      else if (out.platform && !PLATFORMS.includes(out.platform)) out.error = "平台只能是 " + PLATFORMS.join(" / ");
    } else if (out.platforms.length > 1) {
      out.error = "--platforms 多个平台只配合 --plan；单平台发布仍用 --platform";
    } else {
      if (!out.platform && out.platforms.length === 1) out.platform = out.platforms[0];
      if (!PLATFORMS.includes(out.platform)) out.error = "平台只能是 " + PLATFORMS.join(" / ");
      else if (!out.probe && !out.article) out.error = "缺少 --article <目录>";
    }
  }
  return out;
}

async function selfCheck() {
  const missing = parseArgs(["--platform", "sohu", "--schedule"]);
  if (!String(missing.error).includes("定时发布要带时间")) throw new Error("缺时间时应拒绝开跑");
  const ok = parseArgs(["--platform", "toutiao", "--article", "demo", "--schedule", "2026-11-11 12:00", "--dry-run"]);
  if (ok.error || ok.schedule.text !== "2026-11-11 12:00" || !ok.dryRun) throw new Error("定时参数没有解析出来");
  const fromCover = parseArgs(["--platform", "baijiahao", "--article", "demo", "--from", "setCover"]);
  if (fromCover.error || fromCover.from !== "setCover") throw new Error("--from setCover 没有解析出来");
  const badFrom = parseArgs(["--platform", "toutiao", "--article", "demo", "--from", "nope"]);
  if (!String(badFrom.error).includes("续跑步骤")) throw new Error("非法 --from 应拒绝");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-article-"));
  fs.writeFileSync(path.join(root, "title.txt"), "标题");
  fs.writeFileSync(path.join(root, "body.md"), "第一段\n\n第二段");
  fs.writeFileSync(path.join(root, "cover.jpg"), "cover");
  fs.mkdirSync(path.join(root, "images"));
  fs.writeFileSync(path.join(root, "images", "a.jpg"), "same");
  fs.writeFileSync(path.join(root, "images", "b.jpg"), "same");
  fs.writeFileSync(path.join(root, "images", "c.jpg"), "other");
  const article = loadArticle(root);
  if (article.images.length !== 2) throw new Error("相同内容的图应该并成一张");
  if (!toParagraphHtml(article.body).includes("<p>第一段</p>")) throw new Error("正文没有拆成段落");
  // 正文里的 Markdown 语法必须转成标签，不能把 ** 和 ## 原样发到平台
  const rich = toParagraphHtml("# 小标题\n\n**粗体**和*斜体*", {});
  if (rich.includes("##") || rich.includes("**") || !rich.includes("<strong>") || !rich.includes("<em>")) {
    throw new Error("Markdown 语法没有渲染成 HTML：" + rich);
  }
  if (!toParagraphHtml("## 小标题", {}).includes("<h3>")) throw new Error("## 没有转成小标题");
  if (!toParagraphHtml("# 我的标题\n\n正文", { title: "我的标题" }).startsWith("<p>正文</p>")) {
    throw new Error("正文首行重复标题没有被去掉");
  }
  const read = (name) => fs.readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
  const baijia = read("./adapters/baijiahao.mjs");
  const toutiaoSrc = read("./adapters/toutiao.mjs");
  const pageSrc = read("./page.mjs");
  const sparoSrc = read("./sparo.mjs");
  if (!baijia.includes("ue.setContent(html);")) throw new Error("百家号 setContent 调用丢了");
  if (/setContent\(\s*html\s*,/.test(baijia)) throw new Error("百家号 setContent 传了第二个参数");
  if (!/call\(\s*["']switch_tab["']/.test(pageSrc) && !/switchTab\(/.test(pageSrc)) throw new Error("发布没有临时切到编辑标签");
  if (/window\.focus\(/.test(pageSrc) || /window\.focus\(/.test(sparoSrc) || /restore\(/.test(sparoSrc)) {
    throw new Error("用了 focus 或 restore");
  }
  if (!sparoSrc.includes("activeId")) throw new Error("tabs() 没有保留 activeId");
  if (!pageSrc.includes("RENDER_NOT_READY")) throw new Error("高度为 0 时没有 RENDER_NOT_READY");
  if (!toutiaoSrc.includes("firstLaunch")) throw new Error("头条首发没有单独标记");
  if (/firstInput\.checked\)\s*first\.click|first\.click\(/.test(toutiaoSrc)) throw new Error("头条首发仍会被点一下");
  if (baijia.includes("execCommand") || baijia.includes("innerHTML = ''") || baijia.includes("slice(0, 12)")) {
    throw new Error("百家号标题还在用 execCommand 或截断比对");
  }
  if (!baijia.includes("value === text") || !baijia.includes("root.clear")) throw new Error("百家号标题没有全文回读");
  if (!baijia.includes("editExisting")) throw new Error("百家号没有排除「修改已发布文章」的编辑页");
  if (!pageSrc.includes("ctx.editExisting")) throw new Error("openWriteTab 没有按 editExisting 过滤可复用编辑页");
  if (baijia.includes('input[type="date"]') || toutiaoSrc.includes('input[type="date"]')) {
    throw new Error("定时还在找原生日期框");
  }
  // 2026-11-11 跑通的定时与配图经验，写成断言，防止下次改回去又从头试错
  if (!pageSrc.includes("scrollMinuteListScript") || !pageSrc.includes("pickMinuteScript")) {
    throw new Error("定时下拉又回到按行高估算，没有边滑边找");
  }
  if (!pageSrc.includes('[data-sparo-widget="1"]')) throw new Error("定时下拉没有改用真实鼠标点击");
  if (!pageSrc.includes("aria-hidden")) throw new Error("判断下拉是否打开没有过滤淡出浮层（aria-hidden）");
  if (!baijia.includes("cheetah-modal-confirm-btns button.cheetah-btn-primary")) throw new Error("定时确认没有点页脚 primary 按钮");
  if (!baijia.includes(".timepublish-wrap")) throw new Error("定时回读没有限定 .timepublish-wrap");
  if (!baijia.includes("closeScheduleModal")) throw new Error("续跑前没有先关掉残留的定时弹层");
  if (!baijia.includes("withImageSlots")) throw new Error("正文图没有按段落均分，会全堆文末");
  for (const marker of ["closeAiAssistant", "data-sparo-caret", "caret: true", "IMAGE_CARET_UNPROVEN", "data-sparo-image-confirm", "IMAGE_CONFIRM_DISABLED", "drawerVisible", ".pgc-img"]) {
    if (!toutiaoSrc.includes(marker)) throw new Error("头条插图实测断言丢了：" + marker);
  }
  if (toutiaoSrc.includes("range.selectNodeContents(target)")) throw new Error("头条插图退回了未验证的 JS Range 光标");
  if (!pageSrc.includes("for (let attempt = 0; attempt < 3")) throw new Error("execute 回空串没有重试");
  if (!baijia.includes("AI_STILL_CHECKED") || baijia.includes("checked = true")) throw new Error("百家号 AI 声明断言丢了");
  if (!toutiaoSrc.includes("投放广告赚收益") || !toutiaoSrc.includes("adChecked")) throw new Error("头条广告收益断言丢了");
  // 2026-11-11 头条实测：定时是两步；图片抽屉要先点「上传图片」才有文件框；定时稿只在作品管理可见
  if (!toutiaoSrc.includes(".common-timing-picker")) throw new Error("头条定时弹层选择器丢了");
  if (!toutiaoSrc.includes("预览并定时发布") || !toutiaoSrc.includes("clickPreviewSubmit")) {
    throw new Error("头条定时没有走「弹层预览 → 预览页提交」两步");
  }
  if (!toutiaoSrc.includes("button.publish-btn")) throw new Error("头条提交按钮不再按 publish-btn 找");
  if (toutiaoSrc.includes("runSchedule(")) throw new Error("头条还在用百家号的定时控件");
  if (toutiaoSrc.includes("chooseWidget")) throw new Error("头条退回百家号的虚拟列表选时了");
  if (!toutiaoSrc.includes("上传图片") || !toutiaoSrc.includes("input[type=file]")) {
    throw new Error("头条图片抽屉没有先点「上传图片」");
  }
  if (!toutiaoSrc.includes("for (let i = 0; i < 100; i++)")) throw new Error("头条大图上传等待过短，会提前误报没有确定");
  if (!toutiaoSrc.includes("定时发布中") || !toutiaoSrc.includes("/manage/content/all")) {
    throw new Error("头条定时稿没有到作品管理回读");
  }
  if (!toutiaoSrc.includes("审核中")) throw new Error("头条定时稿刚提交是「审核中」，回读不能只认「定时发布中」");
  if (!toutiaoSrc.includes("NO_THUMB") && !pageSrc.includes("NO_THUMB")) throw new Error("封面确认前没有点缩略图");
  if (!pageSrc.includes("img,.img-span") || !pageSrc.includes("backgroundImage") || !toutiaoSrc.includes("img,.img-span")) {
    throw new Error("封面上传预览只认 img，会把 .img-span 背景图误报成 NO_THUMB");
  }
  if (!toutiaoSrc.includes(".article-cover img")) throw new Error("头条封面回读丢了");
  // 2026-11-12 发布实测：预览层、空包兜底、行内核验、0 张上传、失败台账
  if (!pageSrc.includes('class*=\\"preview\\"')) throw new Error("点击证明没有计入预览层，头条立即发布会停在 CLICK_UNPROVEN");
  if (!toutiaoSrc.includes("IMAGE_CONFIRM_CLICK_FAILED") || !toutiaoSrc.includes("ASSISTANT_CLOSE_FAILED")) {
    throw new Error("头条点击空包兜底丢了");
  }
  if (toutiaoSrc.includes("read.value.images ? Number(read.value.images) : ctx.imageCount")) {
    throw new Error("头条核验读不到图片数时还在用 ctx.imageCount 猜");
  }
  if (baijia.includes(".slice(0, 12000)")) throw new Error("百家号核验还在整页搜状态");
  if (!baijia.includes("预计") || !baijia.includes("idx + 7")) throw new Error("百家号核验没有限定在标题所在行附近");
  if (!baijia.includes("count >= 1") || !baijia.includes("UPLOAD_FAILED")) throw new Error("百家号插图把 0 张上传成功当成完成");
  if (!sparoSrc.includes("SPARO_CLIENT") || sparoSrc.includes("social-media-publish#")) {
    throw new Error("clientId 还在随进程变化");
  }
  if (!pageSrc.includes("NO_EDITOR_TAB")) throw new Error("打开编辑页失败时没有带出落点");
  if (!sparoSrc.includes("URL_UNREAD")) throw new Error("空地址还是 MISMATCH");
  const { classifyHref, activeIdOf, tabRows } = await import("./sparo.mjs");
  const listed = { tabs: [{ id: "editor" }], activeId: "user-tab" };
  if (activeIdOf(listed) !== "user-tab" || tabRows(listed)[0].id !== "editor") throw new Error("activeId 没有从标签列表留下");
  if (classifyHref("", "mp.toutiao.com") !== "URL_UNREAD") throw new Error("空地址应是 URL_UNREAD");
  const mismatch = classifyHref("https://mp.toutiao.com/graphic/publish", "baijiahao.baidu.com");
  if (!mismatch.startsWith("MISMATCH:") || !mismatch.includes("toutiao.com")) throw new Error("地址不对时应带上读到的 URL");
  if (classifyHref("https://mp.toutiao.com/graphic/publish", "mp.toutiao.com") !== "") throw new Error("正确地址不应拦截");
  const { titlesEqual, scheduleMatches, canResume, renderGate, explainReach, chooseEditorTab, findOwnedEditor } = await import("./page.mjs");
  const hidden = renderGate(0);
  if (!hidden || hidden.code !== "RENDER_NOT_READY") throw new Error("innerHeight 为 0 时应是 RENDER_NOT_READY");
  if (renderGate(800)) throw new Error("有高度时不应拦截");
  const stamp = { clientId: "social-media-publish", owner: "agent:social-media-publish" };
  const foreign = { id: "other", url: "https://baijiahao.baidu.com/builder/rc/edit?type=news", owner: "agent:other" };
  const refused = chooseEditorTab({
    before: { tabs: [foreign], activeId: "other" },
    after: { tabs: [foreign], activeId: "other" },
    stamp,
    writeMark: "/builder/rc/edit",
  });
  if (refused.ok || refused.code !== "NO_EDITOR_TAB") throw new Error("别人的编辑页被接管了");
  const mine = { id: "mine", url: "https://baijiahao.baidu.com/builder/rc/content", owner: stamp.owner };
  const became = { ...mine, url: "https://baijiahao.baidu.com/builder/rc/edit?type=news" };
  const reused = chooseEditorTab({
    before: { tabs: [mine], activeId: "user" },
    after: { tabs: [became], activeId: "user" },
    stamp,
    writeMark: "/builder/rc/edit",
  });
  if (!reused.ok || reused.via !== "url-became-editor" || reused.tab.id !== "mine") throw new Error("同地址复用后没有认回自己的编辑页");
  if (!findOwnedEditor([became], stamp, "/builder/rc/edit")) throw new Error("自己的编辑页没有被复用");
  if (findOwnedEditor([foreign], stamp, "/builder/rc/edit")) throw new Error("按 owner 仍会拿别人的标签");
  const diagnosis = explainReach(
    "定时发布",
    { viewport: { w: 0, h: 0 }, target: { left: 12, top: -49, right: 100, bottom: -13 }, inside: { x: false, y: false }, scrollers: [], blockers: [] },
    ["inline", "scroll-ancestor", "scroll-doc"],
    ["request-layout", "manual"],
  );
  if (!diagnosis.includes("目标「定时发布」") || !diagnosis.includes("视口 0×0") || !diagnosis.includes("视口高度为 0") || !diagnosis.includes("试过 inline") || !diagnosis.includes("还剩 request-layout")) {
    throw new Error("点击诊断缺了目标、量测、尝试或下一步");
  }
  if (pageSrc.includes("BUTTON_OFFSCREEN") || pageSrc.includes("else if (left > innerWidth)")) throw new Error("点击还在按单一原因分支");
  const longTitle = "马斯克，Musk：放弃过民主党，押注过共和党，唯独没放弃中国";
  if (!titlesEqual(longTitle, longTitle) || titlesEqual(longTitle.slice(0, 12), longTitle)) throw new Error("标题必须全文相等");
  const schedule = { date: "2026-11-11", time: "19:30" };
  if (!scheduleMatches({ date: "2026-11-11", hour: "19", minute: "30" }, schedule)) throw new Error("定时回读三项没有对齐");
  if (scheduleMatches({ date: "2026-11-11", hour: "19", minute: "00" }, schedule)) throw new Error("分钟不对也算通过了");
  const { planSteps } = await import("./engine.mjs");
  const resumed = planSteps("setCover", false);
  if (resumed[0] !== "setCover" || resumed.includes("fillTitle") || resumed.includes("fillBody")) {
    throw new Error("--from setCover 仍会重写标题或正文");
  }
  if (canResume({ href: "https://www.baidu.com/", writeMark: "/builder/rc/edit", pageTitle: longTitle, title: longTitle }).code !== "RESUME_NOT_EDITOR") {
    throw new Error("不在编辑页也应允许续跑");
  }
  if (canResume({ href: "https://baijiahao.baidu.com/builder/rc/edit?type=news", writeMark: "/builder/rc/edit", pageTitle: "", title: longTitle }).code !== "RESUME_NO_TITLE") {
    throw new Error("没有标题也应允许续跑");
  }
  if (!canResume({ href: "https://baijiahao.baidu.com/builder/rc/edit?type=news", writeMark: "/builder/rc/edit", pageTitle: longTitle, title: longTitle }).ok) {
    throw new Error("编辑页已有标题却拒绝续跑");
  }
  const { renderFailure } = await import("./page.mjs");
  const minimized = renderFailure({ targetHeight: 0, activeHeight: 0 });
  if (minimized?.code !== "WINDOW_MINIMIZED" || minimized.diagnosis !== "窗口最小化，全部标签未排版") {
    throw new Error("活动标签也是 0 时没有标成窗口最小化");
  }
  if (!minimized.next?.includes("ensure-render")) throw new Error("窗口最小化没有给出下一步");
  const layout = renderFailure({ targetHeight: 0, activeHeight: 800 });
  if (layout?.code !== "RENDER_NOT_READY" || layout.code === "WINDOW_MINIMIZED") throw new Error("活动标签正常时被标成窗口最小化");
  if (renderFailure({ targetHeight: 900, activeHeight: 0 })) throw new Error("目标标签已排版仍报失败");
  const heightOk = pageSrc.indexOf("if (first.height > 0)");
  const ensureAt = pageSrc.indexOf("ensureRender(");
  if (heightOk < 0 || ensureAt < 0 || ensureAt < heightOk) throw new Error("高度已经大于 0 仍会申请渲染");
  if (/win\.focus\(/.test(pageSrc) || /win\.show\(/.test(pageSrc) || /win\.focus\(/.test(sparoSrc) || /win\.show\(/.test(sparoSrc)) {
    throw new Error("技能里调用了 win.focus 或 win.show");
  }
  const engineSrc = read("./engine.mjs");
  if (!engineSrc.includes("releaseRender")) throw new Error("任务结束没有归还渲染");
  if (!engineSrc.includes("report.ok && ctx.schedule")) throw new Error("失败台账仍会写成已定时");
  console.log("SELF_CHECK_OK");
}

function runningAsCli() {
  if (!process.argv[1]) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || process.argv.slice(2).length === 0) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 2);
  }
  if (args.selfCheck) {
    await selfCheck();
    return;
  }
  if (args.error) {
    console.error(args.error);
    console.error(USAGE);
    process.exit(2);
  }
  if (args.plan) {
    const { printPlans } = await import("./profile.mjs");
    printPlans(args.platforms);
    return;
  }
  let article = { title: "", body: "", bodyHtml: "", cover: "", images: [], droppedDuplicates: 0, dir: "" };
  if (!args.probe) article = loadArticle(args.article);
  const { runPublish } = await import("./engine.mjs");
  const report = await runPublish(args, article);
  process.exit(report.ok ? 0 : 1);
}

if (runningAsCli()) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(2);
  });
}
