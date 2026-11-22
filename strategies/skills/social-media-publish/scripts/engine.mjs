import { baijiahao } from "./adapters/baijiahao.mjs";
import { dayu } from "./adapters/dayu.mjs";
import { sohu } from "./adapters/sohu.mjs";
import { toutiao } from "./adapters/toutiao.mjs";
import { weixin } from "./adapters/weixin.mjs";
import { planImages } from "./article.mjs";
import { ledgerEnvFields, resolveEnv } from "./env-account.mjs";
import { activateEditor, blockedCall, canResume, captureAccountName, editorCandidates, enforceAccountGate, restoreActive } from "./page.mjs";
import { appendLedger } from "./ledger.mjs";
import { activeIdOf, listEnvs, releaseRender, sessionStamp, tabRows, tabs, useTab } from "./sparo.mjs";

export const ADAPTERS = { toutiao, baijiahao, dayu, sohu, weixin };

export const STEPS = [
  "openBlank",
  "fillTitle",
  "fillBody",
  "insertImages",
  "setCover",
  "setOptions",
  "publishOrSchedule",
  "verify",
];

export function planSteps(from, probe) {
  if (probe) return ["openBlank", "probe"];
  if (!from) return STEPS.slice();
  const index = STEPS.indexOf(from);
  if (index < 0) return null;
  return STEPS.slice(index);
}

/** docx 模式下用 importDocx 顶掉 fillBody + insertImages；标题仍由 fillTitle 覆盖文件名。
 *  有 formatBody 的平台在落稿后统一排版（微信：种下划线/字号/图片圆角）。 */
export function routeSteps(steps, { docxMode = false, format = false } = {}) {
  if (!steps) return steps;
  const out = [];
  for (const step of steps) {
    if (step === "fillTitle") {
      if (docxMode) {
        out.push("importDocx");
        if (format) out.push("formatBody");
      }
      out.push("fillTitle");
    } else if (step === "fillBody") {
      if (docxMode) continue;
      out.push("fillBody");
    } else if (step === "insertImages") {
      if (docxMode) continue;
      out.push("insertImages");
      if (format) out.push("formatBody");
    } else {
      out.push(step);
    }
  }
  return out;
}

function line(ctx, step, result) {
  const reason = result.ok ? "ok" : result.code || "FAIL";
  const hint = result.hint || (typeof result.detail === "string" ? result.detail : "");
  return [ctx.platform, step, reason, "tab=" + (ctx.tabId || "-"), hint].filter((part, index) => index < 4 || part).join(" / ");
}

function expose(ctx, report) {
  return {
    ...report,
    envId: ctx?.envId || report.envId || "",
    envName: ctx?.envName || report.envName || "",
    accountName: ctx?.accountName || ctx?.expectedAccountName || report.accountName || "",
  };
}

function accountReader(adapter) {
  return typeof adapter.readAccountName === "function" ? (ctx) => adapter.readAccountName(ctx) : null;
}

async function resolveRequestedEnv(query) {
  const text = String(query || "").trim();
  if (!text) return { ok: true, envId: "", envName: "" };
  let roster;
  try {
    roster = await listEnvs();
  } catch (error) {
    return {
      ok: false,
      code: "ENV_NOT_FOUND",
      input: text,
      envs: [],
      hint: "读不到账号名册，没有改走默认登录态：" + (error?.message || error),
    };
  }
  return resolveEnv(roster, text);
}

function stopReport(ctx, report) {
  const stamped = expose(ctx, report);
  if (!ctx?.dryRun && !ctx?.probe) writeLedger(ctx, stamped);
  console.log(JSON.stringify(stamped));
  return stamped;
}

export async function runPublish(args, article) {
  const adapter = ADAPTERS[args.platform];
  const resolved = await resolveRequestedEnv(args.env);
  if (!resolved.ok) {
    const failedCtx = {
      platform: args.platform,
      title: article?.title || "",
      ledgerPath: args.ledger,
      from: args.from || "",
      schedule: args.schedule,
      dryRun: args.dryRun,
      probe: args.probe,
      envId: "",
      envName: "",
      accountName: "",
    };
    return stopReport(failedCtx, {
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
  const ctx = {
    platform: args.platform,
    host: adapter.host,
    writeUrl: adapter.writeUrl,
    writeMark: adapter.writeMark,
    editExisting: adapter.editExisting || null,
    dryRun: args.dryRun,
    probe: args.probe,
    schedule: args.schedule,
    aiImages: args.aiImages,
    ledgerPath: args.ledger,
    from: args.from || "",
    tabId: "",
    imageCount: 0,
    theme: args.theme || "editorial",
    ...article,
    imagePlan: null,
    docxMode: false,
    envId: resolved.envId,
    envName: resolved.envName,
    expectedAccountName: "",
    accountName: "",
  };
  const imagePlan = planImages(article, {
    docxImport: args.docxImport,
    images: args.images,
    forceDocx: ctx.platform === "weixin" && !args.noDocx,
  });
  ctx.imagePlan = imagePlan;
  ctx.docxMode = imagePlan.mode === "docx";
  if (ctx.docxMode && typeof adapter.importDocx !== "function") {
    return stopReport(ctx, {
      ok: false,
      platform: ctx.platform,
      step: "imagePlan",
      reason: "DOCX_UNSUPPORTED",
      tabId: "",
      hint: ctx.platform + " 还没有接文档导入，去掉 --docx-import 或换平台",
      log: [],
    });
  }
  const listedAtStart = await tabs();
  const previousActiveId = activeIdOf(listedAtStart);
  ctx.previousActiveId = previousActiveId;
  try {
  const log = [];
  if (imagePlan.mode === "docx" && typeof adapter.formatBody === "function") {
    log.push({ step: "formatPlan", theme: ctx.theme });
    console.log(line(ctx, "formatPlan", { ok: true, hint: "theme=" + ctx.theme }));
  }
  log.push({ step: "imagePlan", mode: imagePlan.mode, textLen: imagePlan.textLen, images: imagePlan.total, use: imagePlan.count, reason: imagePlan.reason });
  console.log(line(ctx, "imagePlan", { ok: true, hint: imagePlan.mode + " 图=" + imagePlan.count + "/" + imagePlan.total + " 字=" + imagePlan.textLen + " " + imagePlan.reason }));
  const steps = routeSteps(planSteps(args.from, args.probe), {
    docxMode: ctx.docxMode,
    format: typeof adapter.formatBody === "function",
  });
  if (!steps) {
    return stopReport(ctx, {
      ok: false,
      platform: ctx.platform,
      step: args.from || "",
      reason: "BAD_FROM",
      tabId: "",
      hint: "续跑步骤不存在，请从头跑",
      log,
    });
  }
  if (args.from && args.from !== "openBlank" && !args.probe) {
    const listed = await tabs();
    const stamp = await sessionStamp();
    const picked = editorCandidates(tabRows(listed), {
      host: adapter.host,
      writeMark: adapter.writeMark,
      editExisting: adapter.editExisting,
      stamp,
      envId: ctx.envId || "",
    });
    const editors = picked.accepted;
    let gate = {
      ok: false,
      code: picked.excluded.some((item) => item.reason === "env") && !editors.length ? "NO_EDITOR_TAB" : "RESUME_NOT_EDITOR",
      hint: "没有找到可续跑的编辑页，请从头跑",
      detail: { envId: ctx.envId || "", excluded: picked.excluded },
    };
    for (const tab of editors) {
      const pin = await useTab(tab.id, adapter.host);
      const stopped = blockedCall(pin);
      if (stopped) continue;
      ctx.tabId = tab.id;
      const titleRead = typeof adapter.readTitle === "function" ? await adapter.readTitle(ctx) : { ok: false };
      gate = titleRead.ok
        ? canResume({
            href: titleRead.detail?.href || "",
            writeMark: adapter.writeMark,
            pageTitle: titleRead.detail?.title || "",
            title: ctx.title,
          })
        : { ok: false, code: titleRead.code || "RESUME_NO_TITLE", hint: titleRead.hint || "编辑页没有这篇标题，请从头跑" };
      if (gate.ok) break;
    }
    log.push({ step: "openBlank", ok: gate.ok, resume: true, tabId: ctx.tabId || "" });
    if (!gate.ok) {
      ctx.tabId = "";
      console.log(line(ctx, args.from, { ok: false, code: gate.code, hint: gate.hint }));
      return stopReport(ctx, {
        ok: false,
        platform: ctx.platform,
        step: args.from,
        reason: gate.code,
        tabId: "",
        hint: gate.hint,
        excluded: picked.excluded,
        log,
      });
    }
    const named = await captureAccountName(ctx, accountReader(adapter));
    log.push({ step: "accountName", ...named });
    if (!named.ok) {
      return stopReport(ctx, {
        ok: false,
        platform: ctx.platform,
        step: "accountName",
        reason: named.code || "ACCOUNT_NAME_UNAVAILABLE",
        tabId: ctx.tabId || "",
        hint: named.hint || "",
        log,
      });
    }
    console.log(line(ctx, "openBlank", { ok: true, hint: "续跑定位" }));
  }
  for (const step of steps) {
    if (ctx.tabId && !ctx.renderReady) {
      const ready = await activateEditor(ctx);
      ctx.renderReady = !!ready.ok;
      ctx.innerHeight = ready.detail?.innerHeight || 0;
      log.push({ step: "render", ...ready });
      console.log(line(ctx, "render", ready.ok ? { ok: true, hint: "innerHeight=" + ctx.innerHeight } : ready));
      if (!ready.ok) {
        return stopReport(ctx, {
          ok: false,
          platform: ctx.platform,
          step: "render",
          reason: ready.code || "RENDER_NOT_READY",
          tabId: ctx.tabId || "",
          hint: ready.hint || "",
          diagnosis: ready.diagnosis || ready.hint || "",
          next: ready.next || [],
          log,
        });
      }
    }
    if (step === "publishOrSchedule") {
      const account = await enforceAccountGate(ctx, accountReader(adapter));
      log.push({ step: "accountGate", ...account });
      console.log(line(ctx, "accountGate", account.ok ? { ok: true, hint: account.detail?.accountName || account.detail?.skipped || "" } : account));
      if (!account.ok) {
        return stopReport(ctx, {
          ok: false,
          platform: ctx.platform,
          step: "accountGate",
          reason: account.code || "ACCOUNT_NAME_UNAVAILABLE",
          tabId: ctx.tabId || "",
          hint: account.hint || "",
          log,
        });
      }
    }
    if (!ctx.cover && (step === "setCover" || step === "publishOrSchedule" || step === "verify")) {
      const hint = step === "publishOrSchedule"
        ? "没有封面，没有点发布。标题和正文已经写入，请人补封面后再发。"
        : "没有封面。标题和正文照常写入，封面留给人补。";
      log.push({ step, ok: true, skipped: "no-cover", hint });
      console.log(line(ctx, step, { ok: true, hint }));
      ctx.missingCover = true;
      continue;
    }
    if (args.dryRun && (step === "publishOrSchedule" || step === "verify")) {
      const skipped = { ok: true, skipped: "dry-run", clicks: 0 };
      log.push({ step, ...skipped });
      console.log(line(ctx, step, { ok: true, hint: "dry-run" }));
      continue;
    }
    const result = await adapter[step](ctx);
    log.push({ step, ...result });
    console.log(line(ctx, step, result));
    if (!result?.ok) {
      return stopReport(ctx, {
        ok: false,
        platform: ctx.platform,
        step,
        reason: result.code || "FAIL",
        tabId: ctx.tabId || "",
        hint: result.hint || result.detail || "",
        log,
      });
    }
    if (step === "openBlank") {
      const named = await captureAccountName(ctx, accountReader(adapter));
      log.push({ step: "accountName", ...named });
      console.log(line(ctx, "accountName", named.ok ? { ok: true, hint: named.detail?.accountName || named.detail?.skipped || "" } : named));
      if (!named.ok) {
        return stopReport(ctx, {
          ok: false,
          platform: ctx.platform,
          step: "accountName",
          reason: named.code || "ACCOUNT_NAME_UNAVAILABLE",
          tabId: ctx.tabId || "",
          hint: named.hint || "",
          log,
        });
      }
    }
  }
  const report = expose(ctx, {
    ok: true,
    platform: ctx.platform,
    dryRun: args.dryRun,
    probe: args.probe,
    tabId: ctx.tabId,
    innerHeight: ctx.innerHeight || 0,
    previousActiveId,
    missingCover: Boolean(ctx.missingCover || !ctx.cover),
    hint: ctx.missingCover || !ctx.cover ? "没有封面。标题和正文已写入，封面请人补上后再发。" : "",
    log,
  });
  if (!args.dryRun && !args.probe) writeLedger(ctx, report);
  console.log(JSON.stringify(report));
  return report;
  } finally {
    await restoreActive(previousActiveId);
    if (ctx.renderHeld) await releaseRender();
  }
}

function writeLedger(ctx, report) {
  const verify = report.log?.find((item) => item.step === "verify" && item.ok);
  const detail = verify?.detail || {};
  appendLedger(ctx.ledgerPath, {
    at: new Date().toISOString(),
    platform: ctx.platform,
    title: ctx.title,
    tabId: ctx.tabId || "",
    ...ledgerEnvFields(ctx),
    ok: report.ok,
    step: report.step || "verify",
    reason: report.reason || "",
    status: detail.status || (report.ok && ctx.schedule ? "定时 " + ctx.schedule.text : ""),
    time: detail.time || (report.ok ? ctx.schedule?.text || "" : ""),
    images: verify ? (detail.images ?? null) : null,
    link: detail.link || "",
    hint: typeof report.hint === "string" ? report.hint : "",
    from: ctx.from || "",
  });
}
