// 视频发布统一入口（单进程，一次 MCP 会话）
// 用法：
//   node video.mjs --platform baijiahao --video <mp4> --title <标题> --cover-land <jpg> --cover-portrait <jpg> [--topics 搞笑,沙雕]
//   node video.mjs --platform baijiahao --video <mp4> --title-file <txt> --auto-cover --dry-run
//   node video.mjs --platform baijiahao --from setCover        # 续跑
//   node video.mjs --probe                                     # 只读现场，不填不发
//
// 与 publish.mjs 同一套纪律：
//   - 一个进程跑完整链路，不每步重开 MCP 会话（这是慢的根源）
//   - 编辑页带 owner 归属，只复用自己开的 tab，绝不接管别人的窗口
//   - 任一步失败即停，输出 step / code / tabId / 页面提示；--from 从失败步续跑
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baijiahaoVideo } from "./adapters/baijiahao-video.mjs";
import { envAllows, ledgerEnvFields, resolveEnv } from "./env-account.mjs";
import { activateEditor, blockedCall, captureAccountName, editorCandidates, enforceAccountGate, fail, page, pass, restoreActive } from "./page.mjs";
import { activeIdOf, call, exec, listEnvs, releaseRender, sessionStamp, sleep, tabRows, tabs, useTab, withEnv } from "./sparo.mjs";
import { appendLedger } from "./ledger.mjs";
import { coverOutputPath, generate as generateCover } from "./video-cover.mjs";

const ADAPTERS = { baijiahao: baijiahaoVideo };

export const STEPS = [
  "openWrite",
  "uploadVideo",
  "waitVideo",
  "probeCover",
  "fillTitle",
  "appendTopic",
  "setCover",
  "setCoverPortrait",
  "setDeclaration",
  "schedule",
  "publish",
  "verify",
];

export const USAGE = [
  "用法：node video.mjs --platform baijiahao --video <mp4> --title <标题> --topics 搞笑,沙雕,名场面,夫妻日常,生活",
  "      [--cover auto|always|never] [--cover-land <jpg>] [--cover-portrait <jpg>] [--schedule \"YYYY-MM-DD HH:mm\"] [--expect-dur <秒>]",
  "      [--tab <tabId>] [--env <envId>] [--title-file <txt>] [--auto-cover] [--at <秒>] [--from <步骤>] [--until <步骤>] [--dry-run] [--probe]",
  "步骤：" + STEPS.join(" → "),
  "话题：5–10 个，少于 5 个直接失败；每个都要走联想点选。",
  "封面：默认 --cover auto —— 平台已自动选好封面且无「不合格」提示就保留，不覆盖；always 强制重传；never 不碰。",
  "定时：--schedule 走「定时发布」，弹窗里的「定时发布」按钮即提交；提交后 publish 自动跳过。",
  "续跑：--from setCover（开跑前编辑页里必须已是这篇标题）；--until setDeclaration 可以分段跑。",
].join("\n");

function parseArgs(argv) {
  const out = {
    platform: "",
    video: "",
    title: "",
    description: "",
    titleFile: "",
    coverLand: "",
    coverPortrait: "",
    topics: [],
    at: 0,
    autoCover: false,
    dryRun: false,
    probe: false,
    from: "",
    env: "",
    ledger: "",
    tab: "",
    coverMode: "auto",
    scheduleAt: "",
    expectDur: 0,
    until: "",
    selfCheck: false,
    help: false,
    error: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--probe") out.probe = true;
    else if (arg === "--auto-cover") out.autoCover = true;
    else if (arg === "--platform") out.platform = argv[++i] || "";
    else if (arg === "--video") out.video = argv[++i] || "";
    else if (arg === "--title") out.title = argv[++i] || "";
    else if (arg === "--description") out.description = argv[++i] || "";
    else if (arg === "--title-file") out.titleFile = argv[++i] || "";
    else if (arg === "--cover-land") out.coverLand = argv[++i] || "";
    else if (arg === "--cover-portrait") out.coverPortrait = argv[++i] || "";
    else if (arg === "--topics") out.topics = String(argv[++i] || "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    else if (arg === "--at") out.at = Number(argv[++i] || 0);
    else if (arg === "--self-check") out.selfCheck = true;
    else if (arg === "--ledger") out.ledger = argv[++i] || "";
    else if (arg === "--tab") out.tab = argv[++i] || "";
    else if (arg === "--cover") {
      const mode = argv[++i] || "";
      if (!["auto", "always", "never"].includes(mode)) out.error = "--cover 只能是 auto / always / never";
      else out.coverMode = mode;
    }
    else if (arg === "--schedule") out.scheduleAt = argv[++i] || "";
    else if (arg === "--expect-dur") out.expectDur = Number(argv[++i] || 0);
    else if (arg === "--until") {
      const next = argv[++i] || "";
      if (!STEPS.includes(next)) out.error = "--until 只能是 " + STEPS.join(" / ");
      else out.until = next;
    }
    else if (arg === "--env") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--") || !next.trim()) out.error = "--env 后面要跟环境 id 或环境名";
      else out.env = argv[++i];
    }
    else if (arg === "--from") {
      const next = argv[++i] || "";
      if (!STEPS.includes(next)) out.error = "续跑步骤只能是 " + STEPS.join(" / ");
      else out.from = next;
    } else out.error = "不认识的参数：" + arg;
    if (out.error) break;
  }
  if (out.error || out.help || out.selfCheck) return out;
  if (!ADAPTERS[out.platform]) out.error = "平台只能是 " + Object.keys(ADAPTERS).join(" / ");
  else if (!out.probe) {
    if (!out.video || !fs.existsSync(out.video)) out.error = "缺少可读的 --video <mp4>";
    if (!out.title && out.titleFile) out.title = fs.readFileSync(out.titleFile, "utf8").trim();
    if (!out.title) out.error = "缺少 --title 或 --title-file";
  }
  if (out.error) return out;
  if (out.autoCover && !out.probe) {
    const dir = path.dirname(path.resolve(out.video));
    out.coverLand = out.coverLand || coverOutputPath(dir, "land");
    out.coverPortrait = out.coverPortrait || coverOutputPath(dir, "portrait");
  }
  if (!out.probe && !out.from && !out.autoCover && out.coverMode !== "never") {
    if (!out.coverLand || !fs.existsSync(out.coverLand)) out.error = "缺少 --cover-land（或加 --auto-cover）";
  }
  return out;
}

/** --auto-cover：真正调用抽帧生成器，把两张封面写回统一的 land / portrait 路径。 */
export function prepareAutoCover(args, generate = generateCover) {
  if (!args || !args.autoCover || args.probe) return args;
  const video = path.resolve(String(args.video || ""));
  const dir = path.dirname(video);
  const out = generate({ video, at: Number(args.at) || 0, outDir: dir });
  args.coverLand = out?.land || coverOutputPath(dir, "land");
  args.coverPortrait = out?.portrait || coverOutputPath(dir, "portrait");
  return args;
}

function line(ctx, step, result) {
  const reason = result.ok ? "ok" : result.code || "FAIL";
  const hint = result.hint || (typeof result.detail === "string" ? result.detail : "");
  return [ctx.platform, step, reason, "tab=" + (ctx.tabId || "-"), hint].filter((v, i) => i < 4 || v).join(" / ");
}

function tabIdFrom(raw) {
  try {
    const text = JSON.stringify(JSON.parse(raw));
    const m = text.match(/"(?:tabId|id)"\s*:\s*"([0-9a-z]{6,12})"/i);
    if (m) return m[1];
  } catch {
    /* 返回不是 JSON 就走 diff 兜底 */
  }
  return "";
}

/**
 * 开自己的编辑页。
 * 关键：navigate 不带 tabId 会打到活动标签（会抢用户的窗口），所以用 new_tab。
 * 复用也只复用 owner 是自己的编辑页，别的 agent 的 tab 一律不碰。
 */
async function openOwnEditor(ctx) {
  // 用户在某个标签里已经登录了指定账号时，直接复用这个标签，绝不开新标签
  // （Sparo 的 new_tab 可能落到另一套登录态，会把作品发到别的号上）
  if (ctx.tabIdArg) {
    const pin = await useTab(ctx.tabIdArg, ctx.host);
    const stopped = blockedCall(String(pin));
    if (stopped) return stopped;
    await exec("(() => { location.replace(" + JSON.stringify(ctx.writeUrl) + "); return JSON.stringify({ ok: true }); })()", ctx.tabIdArg, ctx.host);
    for (let i = 0; i < 50; i++) {
      await sleep(400);
      const again = await page({ ...ctx, tabId: ctx.tabIdArg }, "(() => { const e = document.querySelector('[class*=\"contentEditable\"][contenteditable=\"true\"]'); return JSON.stringify({ ready: !!e, href: location.href }); })()");
      if (again.stop) break;
      if (again.value?.ready) break;
    }
    ctx.tabId = ctx.tabIdArg;
    return pass({ tabId: ctx.tabIdArg, reused: true, via: "user-tab" });
  }
  const stamp = await sessionStamp();
  const before = await tabs();
  const rows = tabRows(before);
  const picked = editorCandidates(rows, {
    host: ctx.host,
    writeMark: ctx.writeMark,
    editExisting: ctx.editExisting,
    stamp,
    envId: ctx.envId || "",
  });
  const reusable = picked.accepted[0];
  if (reusable) {
    const pin = await useTab(reusable.id, ctx.host);
    const stopped = blockedCall(String(pin));
    if (!stopped) {
      // 复用前先看有没有未完成的草稿：空页才重载，避免把别人的半成品刷掉
      const read = await page({ ...ctx, tabId: reusable.id }, "(() => { const e = document.querySelector('[class*=\"contentEditable\"][contenteditable=\"true\"]'); return JSON.stringify({ title: e ? (e.innerText || '').trim() : '' }); })()");
      if (!read.stop && !read.value?.title) {
        // is_from_cms=1 这类残留状态会让上传不触发，必须重载成干净编辑页
        await exec("(() => { location.replace(" + JSON.stringify(ctx.writeUrl) + "); return JSON.stringify({ ok: true }); })()", reusable.id, ctx.host);
        for (let i = 0; i < 40; i++) {
          await sleep(300);
          const again = await page({ ...ctx, tabId: reusable.id }, "(() => { const e = document.querySelector('[class*=\"contentEditable\"][contenteditable=\"true\"]'); return JSON.stringify({ ready: !!e, href: location.href }); })()");
          if (again.stop) break;
          if (again.value?.ready) break;
        }
      }
      ctx.tabId = reusable.id;
      return pass({ tabId: reusable.id, reused: true, owner: stamp.owner, envId: reusable.envId || "" });
    }
  }
  const wantEnv = String(ctx.envId || "").trim();
  const raw = await call("new_tab", withEnv(ctx.writeUrl, wantEnv));
  const id = tabIdFrom(raw);
  const deadline = Date.now() + 20000;
  while (Date.now() <= deadline) {
    const listed = await tabs();
    const list = tabRows(listed);
    const hit = list.find(
      (t) =>
        (id ? t.id === id : !rows.some((b) => b.id === t.id)) &&
        String(t.url || "").includes(ctx.host) &&
        !/auth\/page\/login|passport/i.test(String(t.url || "")),
    );
    if (hit) {
      if (wantEnv && !String(hit.envId || "")) continue;
      if (wantEnv && String(hit.envId || "") !== wantEnv) {
        return fail("ENV_MISMATCH", { expectedEnvId: wantEnv, actualEnvId: hit.envId || "", tabId: hit.id, excluded: picked.excluded }, "新标签不在目标账号环境");
      }
      if (!wantEnv && String(hit.envId || "").trim()) continue;
      const pin = await useTab(hit.id, ctx.host);
      const stopped = blockedCall(String(pin));
      if (!stopped) {
        ctx.tabId = hit.id;
        return pass({ tabId: hit.id, reused: false, via: id ? "new_tab:id" : "new_tab:diff", owner: stamp.owner });
      }
      if (stopped.code !== "URL_UNREAD") return stopped;
    }
    await sleep(300);
  }
  return fail("NO_EDITOR_TAB", { raw, excluded: picked.excluded, envId: wantEnv, tabs: tabRows(await tabs()) }, "new_tab 后没拿到百家号编辑页");
}

/**
 * 续跑定位：只认同 owner + 同环境的编辑页。
 * fillTitle 之前（标题还没写）允许认领唯一一个空标题草稿；多个空草稿就失败关闭，不替人挑。
 */
export async function findResumeEditor(ctx, adapter, from, io) {
  const deps = io || { sessionStamp, tabs, useTab };
  const stamp = await deps.sessionStamp();
  const rows = tabRows(await deps.tabs());
  const writeMark = from === "verify" ? "/builder/rc/content" : ctx.writeMark;
  const picked = editorCandidates(rows, {
    host: ctx.host,
    writeMark,
    editExisting: writeMark === ctx.writeMark ? ctx.editExisting : null,
    stamp,
    envId: ctx.envId || "",
  });
  const reads = [];
  const empties = [];
  let resumed = null;
  if (from === "verify") {
    // 刚发完可能停在 clue 引导页，退一步认自己名下的百家号任意页
    const hasOwner = rows.some((tab) => Object.prototype.hasOwnProperty.call(tab, "owner"));
    const ours = (tab) => (hasOwner ? String(tab.owner || "") === stamp.owner : true) && envAllows(tab, ctx.envId || "");
    resumed = rows.find((tab) => /\/builder\/rc\/content/.test(String(tab.url || "")) && ours(tab))
      || rows.find((tab) => /baijiahao\.baidu\.com/.test(String(tab.url || "")) && ours(tab))
      || null;
  }
  const beforeTitle = ["openWrite", "uploadVideo", "waitVideo", "probeCover", "fillTitle"].includes(from);
  for (const tab of resumed ? [] : picked.accepted) {
    const pin = await deps.useTab(tab.id, ctx.host);
    if (blockedCall(String(pin))) continue;
    const read = await adapter.readTitle({ ...ctx, tabId: tab.id });
    reads.push(tab.id);
    const title = String(read?.detail?.title || "");
    if (read?.ok && title.startsWith(ctx.title || "")) {
      resumed = tab;
      break;
    }
    if (beforeTitle && !title) empties.push(tab);
  }
  if (!resumed && beforeTitle) {
    if (empties.length === 1) resumed = empties[0];
    else if (empties.length > 1) return { resumed: null, ambiguous: true, picked, reads };
  }
  return { resumed, ambiguous: false, picked, reads };
}

/** probe 只读现场，但必须按显式环境过滤，并带上环境和账号字段。 */
export function buildProbeReport(ctx, listed) {
  const rows = tabRows(listed);
  const want = String(ctx.envId || "").trim();
  const mine = rows.filter((tab) => envAllows(tab, want));
  const row = (tab) => ({
    id: tab.id,
    url: tab.url || "",
    owner: tab.owner || "",
    envId: String(tab.envId || ""),
    envName: String(tab.envName || ""),
    accountName: String(tab.accountName || ""),
  });
  return {
    ok: true,
    probe: true,
    activeId: listed?.activeId || activeIdOf(listed),
    envId: want,
    envName: String(ctx.envName || ""),
    accountName: String(ctx.accountName || ctx.expectedAccountName || ""),
    editors: mine.filter((tab) => String(tab.url || "").includes(ctx.host) && String(tab.url || "").includes(ctx.writeMark)).map(row),
    tabs: mine.map(row),
  };
}

async function runProbe(ctx) {
  return finish(ctx, buildProbeReport(ctx, await tabs()));
}

async function resolveRequestedEnv(query) {
  const text = String(query || "").trim();
  if (!text) return { ok: true, envId: "", envName: "" };
  let roster;
  try {
    roster = await listEnvs();
  } catch (error) {
    return { ok: false, code: "ENV_NOT_FOUND", input: text, envs: [], hint: "读不到账号名册，没有改走默认登录态：" + (error?.message || error) };
  }
  return resolveEnv(roster, text);
}

/** 环境解析失败也要留痕：非 dry-run / 非 probe 写一条失败台账，但绝不开页。 */
export function resolveEnvFailure(args, resolved) {
  const adapter = ADAPTERS[args.platform];
  const ctx = {
    platform: args.platform,
    host: adapter?.host || "",
    title: args.title || "",
    from: args.from || "",
    ledgerPath: args.ledger || "",
    dryRun: Boolean(args.dryRun),
    probe: Boolean(args.probe),
    envId: "",
    envName: "",
    accountName: "",
    tabId: "",
  };
  return finish(ctx, {
    ok: false,
    platform: args.platform,
    step: "resolveEnv",
    reason: resolved.code,
    tabId: "",
    hint: resolved.hint || "",
    input: resolved.input || args.env || "",
    envs: resolved.envs || [],
    log: [],
  });
}

export async function runVideoPublish(args) {
  const adapter = ADAPTERS[args.platform];
  const resolved = await resolveRequestedEnv(args.env);
  if (!resolved.ok) return resolveEnvFailure(args, resolved);
  const ctx = {
    platform: args.platform,
    host: adapter.host,
    writeUrl: adapter.writeUrl,
    writeMark: adapter.writeMark,
    editExisting: adapter.editExisting || null,
    dryRun: args.dryRun,
    probe: args.probe,
    from: args.from,
    tabIdArg: args.tab,
    ledgerPath: args.ledger,
    video: args.video,
    title: args.title,
    description: args.description || args.title,
    coverLand: args.coverLand,
    coverPortrait: args.coverPortrait,
    topics: args.topics,
    coverMode: args.coverMode,
    scheduleAt: args.scheduleAt,
    videoDuration: args.expectDur || 0,
    envId: resolved.envId,
    envName: resolved.envName,
    expectedAccountName: "",
    accountName: "",
    tabId: "",
  };
  const before = await tabs();
  const previousActiveId = activeIdOf(before);
  const log = [];
  try {
    if (!args.probe && args.autoCover) {
      try {
        prepareAutoCover(args);
        ctx.coverLand = args.coverLand;
        ctx.coverPortrait = args.coverPortrait;
      } catch (error) {
        return finish(ctx, { ok: false, platform: ctx.platform, step: "autoCover", reason: "COVER_GENERATE_FAILED", tabId: "", hint: "自动抽帧没有生成封面：" + (error?.message || error), log });
      }
    }
    if (args.probe) {
      const report = await runProbe(ctx);
      return { ...report, log };
    }

    let steps = STEPS.slice();
    if (args.from) steps = STEPS.slice(STEPS.indexOf(args.from));

    // 续跑：只认自己 owner 的编辑页，别人的一律不碰
    if (args.from && args.from !== "openWrite") {
      const picked = await findResumeEditor(ctx, adapter, args.from);
      if (picked.ambiguous) {
        const report = {
          ok: false,
          platform: ctx.platform,
          step: args.from,
          reason: "RESUME_AMBIGUOUS",
          tabId: "",
          hint: "有多个空标题草稿，不能替你挑，请去掉 --from 从头跑",
          excluded: picked.picked.excluded,
          envId: ctx.envId || "",
          log,
        };
        console.log(line(ctx, args.from, { ok: false, code: report.reason, hint: report.hint }));
        return finish(ctx, report);
      }
      const resumed = picked.resumed;
      if (resumed) {
        const pin = await useTab(resumed.id, ctx.host);
        const stopped = blockedCall(String(pin));
        if (stopped) return finish(ctx, { ok: false, platform: ctx.platform, step: args.from, reason: stopped.code, tabId: resumed.id, hint: stopped.hint || "", log });
      }
      if (!resumed) {
        const envBlocked = picked.picked.excluded.some((item) => item.reason === "env");
        const report = {
          ok: false,
          platform: ctx.platform,
          step: args.from,
          reason: envBlocked ? "NO_EDITOR_TAB" : "RESUME_TAB_NOT_FOUND",
          tabId: "",
          hint: "没找到同一账号下的编辑页，请去掉 --from 从头跑",
          excluded: picked.picked.excluded,
          envId: ctx.envId || "",
          log,
        };
        console.log(line(ctx, args.from, { ok: false, code: report.reason, hint: report.hint }));
        return finish(ctx, report);
      }
      ctx.tabId = resumed.id;
      log.push({ step: "openWrite", ok: true, resumed: true, tabId: ctx.tabId });
      console.log(line(ctx, "openWrite", { ok: true, hint: "续跑 " + ctx.tabId }));
    } else {
      const opened = await openOwnEditor(ctx);
      log.push({ step: "openWrite", ...opened });
      console.log(line(ctx, "openWrite", opened));
      if (!opened.ok) return finish(ctx, { ok: false, platform: ctx.platform, step: "openWrite", reason: opened.code || "FAIL", tabId: "", hint: opened.hint || "", log });
    }

    if (ctx.tabId) {
      const ready = await activateEditor(ctx);
      log.push({ step: "render", ...ready });
      console.log(line(ctx, "render", ready.ok ? { ok: true, hint: "innerHeight=" + (ready.detail?.innerHeight || 0) } : ready));
      if (!ready.ok) {
        return finish(ctx, { ok: false, platform: ctx.platform, step: "render", reason: ready.code, tabId: ctx.tabId, hint: ready.hint || "", diagnosis: ready.diagnosis || "", next: ready.next || [], log });
      }
      ctx.renderReady = true;
      ctx.innerHeight = ready.detail?.innerHeight || 0;
    }

    const named = await captureAccountName(ctx, typeof adapter.readAccountName === "function" ? (item) => adapter.readAccountName(item) : null);
    log.push({ step: "accountName", ...named });
    if (!named.ok) {
      return finish(ctx, { ok: false, platform: ctx.platform, step: "accountName", reason: named.code || "ACCOUNT_NAME_UNAVAILABLE", tabId: ctx.tabId || "", hint: named.hint || "", log });
    }

    for (const step of steps) {
      if (step === "openWrite") continue;
      if (step === "publish") {
        const account = await enforceAccountGate(ctx, typeof adapter.readAccountName === "function" ? (item) => adapter.readAccountName(item) : null);
        log.push({ step: "accountGate", ...account });
        console.log(line(ctx, "accountGate", account.ok ? { ok: true, hint: account.detail?.accountName || account.detail?.skipped || "" } : account));
        if (!account.ok) {
          return finish(ctx, { ok: false, platform: ctx.platform, step: "accountGate", reason: account.code || "ACCOUNT_NAME_UNAVAILABLE", tabId: ctx.tabId || "", hint: account.hint || "", log });
        }
      }
      if (args.dryRun && (step === "publish" || step === "verify")) {
        log.push({ step, ok: true, skipped: "dry-run", clicks: 0 });
        console.log(line(ctx, step, { ok: true, hint: "dry-run" }));
        continue;
      }
      const result = await adapter[step](ctx);
      log.push({ step, ...result });
      console.log(line(ctx, step, result));
      if (!result?.ok) {
        return finish(ctx, { ok: false, platform: ctx.platform, step, reason: result.code || "FAIL", tabId: ctx.tabId || "", hint: result.hint || "", log });
      }
      if (args.until && step === args.until) {
        return finish(ctx, { ok: true, platform: ctx.platform, stopped: "until:" + args.until, tabId: ctx.tabId, previousActiveId, log });
      }
    }
    return finish(ctx, { ok: true, platform: ctx.platform, dryRun: args.dryRun, tabId: ctx.tabId, innerHeight: ctx.innerHeight || 0, previousActiveId, log });
  } finally {
    await restoreActive(previousActiveId);
    if (ctx.renderHeld) await releaseRender();
  }
}

function finish(ctx, report) {
  const stamped = {
    ...report,
    envId: ctx?.envId || report.envId || "",
    envName: ctx?.envName || report.envName || "",
    accountName: ctx?.accountName || ctx?.expectedAccountName || report.accountName || "",
  };
  if (!ctx.dryRun && !ctx.probe) {
    const verify = stamped.log?.find((i) => i.step === "verify" && i.ok);
    appendLedger(ctx.ledgerPath, {
      at: new Date().toISOString(),
      platform: ctx.platform + ":video",
      title: ctx.title,
      tabId: ctx.tabId || "",
      ...ledgerEnvFields(ctx),
      ok: stamped.ok,
      step: stamped.step || "verify",
      reason: stamped.reason || "",
      status: verify?.detail?.status || "",
      link: verify?.detail?.href || "",
      hint: typeof stamped.hint === "string" ? stamped.hint : "",
      from: ctx.from || "",
    });
  }
  console.log(JSON.stringify(stamped));
  return stamped;
}

async function selfCheck() {
  const bare = parseArgs(["--env"]);
  if (!String(bare.error).includes("--env")) throw new Error("缺 --env 值时应拒绝开跑");
  const blank = parseArgs(["--self-check", "--env", "   "]);
  if (!String(blank.error).includes("--env")) throw new Error("纯空白 --env 不应被当成默认登录态");
  const named = parseArgs(["--self-check", "--env", "百家号二"]);
  if (named.error || !named.selfCheck || named.env !== "百家号二") throw new Error("视频 --env 没有原样收下");
  const omitted = parseArgs(["--self-check"]);
  if (omitted.env) throw new Error("视频没写 --env 却自动选了环境");
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  if (!src.includes('call("new_tab", withEnv(ctx.writeUrl, wantEnv))')) throw new Error("视频 new_tab 没有带上环境");
  if (!src.includes("enforceAccountGate")) throw new Error("视频提交前没有硬门");
  const { runEnvFixtures } = await import("./env-account.mjs");
  const { assertEnvEditorFixtures } = await import("./page.mjs");
  const { withEnv } = await import("./sparo.mjs");
  runEnvFixtures();
  assertEnvEditorFixtures();
  const opened = withEnv("https://baijiahao.baidu.com/builder/rc/edit?type=video", "ad0fe9db");
  if (opened.envId !== "ad0fe9db") throw new Error("视频 new_tab 参数没有 envId");

  const { coverOutputPath } = await import("./video-cover.mjs");
  if (!coverOutputPath(os.tmpdir(), "port").endsWith("cover_portrait.jpg")) throw new Error("竖版封面文件名没有统一成 cover_portrait.jpg");
  if (!coverOutputPath(os.tmpdir(), "land").endsWith("cover_land.jpg")) throw new Error("横版封面文件名没有统一成 cover_land.jpg");
  const generated = [];
  const seeded = prepareAutoCover(
    { video: path.join(os.tmpdir(), "demo.mp4"), at: 18, autoCover: true, probe: false, coverLand: "", coverPortrait: "" },
    (input) => {
      generated.push(input);
      return { land: coverOutputPath(input.outDir, "land"), portrait: coverOutputPath(input.outDir, "portrait") };
    },
  );
  if (generated.length !== 1 || generated[0].at !== 18) throw new Error("--auto-cover 没有真正调用抽帧生成器");
  if (!seeded.coverPortrait.endsWith("cover_portrait.jpg")) throw new Error("--auto-cover 没有回填竖版封面路径");

  const stamp = { owner: "agent:social-media-publish" };
  const rows = [
    { id: "right", url: "https://baijiahao.baidu.com/builder/rc/edit?type=video", owner: stamp.owner, envId: "ad0fe9db" },
    { id: "other-env", url: "https://baijiahao.baidu.com/builder/rc/edit?type=video", owner: stamp.owner, envId: "3c8b923f" },
    { id: "other-owner", url: "https://baijiahao.baidu.com/builder/rc/edit?type=video", owner: "someone-else", envId: "ad0fe9db" },
    { id: "list", url: "https://baijiahao.baidu.com/builder/rc/content?type=video", owner: stamp.owner, envId: "ad0fe9db" },
  ];
  const ctx = { host: "baijiahao.baidu.com", writeMark: "/builder/rc/edit", editExisting: null, envId: "ad0fe9db", title: "本任务标题" };
  const io = (list) => ({
    sessionStamp: async () => stamp,
    tabs: async () => ({ activeId: "right", tabs: list }),
    useTab: async (id) => id,
  });
  const emptyTitle = { readTitle: async (item) => ({ ok: true, detail: { title: item.tabId === "right" ? "" : "别的稿" } }) };
  const resumed = await findResumeEditor(ctx, emptyTitle, "waitVideo", io(rows));
  if (resumed.resumed?.id !== "right") throw new Error("视频续跑没有认领同 owner + 同环境的空草稿");
  if (resumed.reads.some((id) => id === "other-env" || id === "other-owner")) throw new Error("视频续跑读了别的账号的标签");
  const twoEmpty = { readTitle: async (item) => ({ ok: true, detail: { title: ["right", "second"].includes(item.tabId) ? "" : "别的稿" } }) };
  const ambiguous = await findResumeEditor(ctx, twoEmpty, "waitVideo", io([
    ...rows,
    { id: "second", url: "https://baijiahao.baidu.com/builder/rc/edit?type=video", owner: stamp.owner, envId: "ad0fe9db" },
  ]));
  if (!ambiguous.ambiguous || ambiguous.resumed) throw new Error("多个空草稿没有失败关闭");
  const titled = await findResumeEditor(ctx, { readTitle: async () => ({ ok: true, detail: { title: "" } }) }, "setCover", io(rows));
  if (titled.resumed) throw new Error("没有这篇标题时仍然续跑");
  const verify = await findResumeEditor(ctx, emptyTitle, "verify", io(rows));
  if (verify.resumed?.id !== "list") throw new Error("视频 verify 没有按 owner + env 找到作品页");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-video-env-"));
  const ledger = path.join(dir, "ledger.jsonl");
  resolveEnvFailure({ platform: "baijiahao", env: "不存在", ledger, title: "t" }, { code: "ENV_NOT_FOUND", hint: "x" });
  const written = fs.readFileSync(ledger, "utf8").trim().split(/\r?\n/).filter(Boolean).map((item) => JSON.parse(item));
  if (written.length !== 1 || written[0].ok || written[0].step !== "resolveEnv" || written[0].reason !== "ENV_NOT_FOUND" || written[0].envId !== "") {
    throw new Error("视频环境解析失败没有写失败台账");
  }
  const dryLedger = path.join(dir, "dry.jsonl");
  resolveEnvFailure({ platform: "baijiahao", env: "不存在", ledger: dryLedger, dryRun: true }, { code: "ENV_NOT_FOUND" });
  if (fs.existsSync(dryLedger)) throw new Error("dry-run 环境失败不应写台账");

  const probe = buildProbeReport({ ...ctx, envName: "百家号2", expectedAccountName: "" }, { activeId: "right", tabs: rows });
  if (probe.tabs.length !== 3 || probe.editors.length !== 2 || probe.tabs.some((tab) => tab.id === "other-env")) throw new Error("probe 没有按环境过滤标签");
  if (probe.envId !== "ad0fe9db" || probe.tabs.some((tab) => tab.envId !== "ad0fe9db")) throw new Error("probe 报告没有带环境字段");
  console.log("SELF_CHECK_OK");
}

function runningAsCli() {
  return Boolean(process.argv[1]) && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
}

if (runningAsCli()) {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfCheck) {
    selfCheck()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(error.message || error);
        process.exit(1);
      });
  } else if (args.help || process.argv.slice(2).length === 0) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 2);
  } else if (args.error) {
    console.error(args.error);
    console.error(USAGE);
    process.exit(2);
  } else runVideoPublish(args)
    .then((report) => process.exit(report.ok ? 0 : 1))
    .catch((error) => {
      console.error(error.message || error);
      process.exit(2);
    });
}

export { parseArgs };
