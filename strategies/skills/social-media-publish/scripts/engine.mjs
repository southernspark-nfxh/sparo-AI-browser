import { baijiahao } from "./adapters/baijiahao.mjs";
import { dayu } from "./adapters/dayu.mjs";
import { sohu } from "./adapters/sohu.mjs";
import { toutiao } from "./adapters/toutiao.mjs";
import { activateEditor, blockedCall, canResume, restoreActive } from "./page.mjs";
import { releaseRender } from "./sparo.mjs";
import { appendLedger } from "./ledger.mjs";
import { activeIdOf, tabRows, tabs, useTab } from "./sparo.mjs";

export const ADAPTERS = { toutiao, baijiahao, dayu, sohu };

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

function line(ctx, step, result) {
  const reason = result.ok ? "ok" : result.code || "FAIL";
  const hint = result.hint || (typeof result.detail === "string" ? result.detail : "");
  return [ctx.platform, step, reason, "tab=" + (ctx.tabId || "-"), hint].filter((part, index) => index < 4 || part).join(" / ");
}

export async function runPublish(args, article) {
  const adapter = ADAPTERS[args.platform];
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
    ...article,
  };
  const listedAtStart = await tabs();
  const previousActiveId = activeIdOf(listedAtStart);
  ctx.previousActiveId = previousActiveId;
  try {
  const log = [];
  const steps = planSteps(args.from, args.probe);
  if (!steps) {
    const report = {
      ok: false,
      platform: ctx.platform,
      step: args.from || "",
      reason: "BAD_FROM",
      tabId: "",
      hint: "续跑步骤不存在，请从头跑",
      log,
    };
    writeLedger(ctx, report);
    console.log(JSON.stringify(report));
    return report;
  }
  if (args.from && args.from !== "openBlank" && !args.probe) {
    const listed = await tabs();
    const list = tabRows(listed);
    const editors = list.filter(
      (tab) =>
        String(tab.url || "").includes(adapter.host) &&
        String(tab.url || "").includes(adapter.writeMark) &&
        !(adapter.editExisting && adapter.editExisting.test(String(tab.url || ""))),
    );
    let gate = { ok: false, code: "RESUME_NOT_EDITOR", hint: "没有找到可续跑的编辑页，请从头跑" };
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
      const report = {
        ok: false,
        platform: ctx.platform,
        step: args.from,
        reason: gate.code,
        tabId: "",
        hint: gate.hint,
        log,
      };
      writeLedger(ctx, report);
      console.log(line(ctx, args.from, { ok: false, code: gate.code, hint: gate.hint }));
      console.log(JSON.stringify(report));
      return report;
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
        const report = {
          ok: false,
          platform: ctx.platform,
          step: "render",
          reason: ready.code || "RENDER_NOT_READY",
          tabId: ctx.tabId || "",
          hint: ready.hint || "",
          diagnosis: ready.diagnosis || ready.hint || "",
          next: ready.next || [],
          log,
        };
        if (!args.dryRun && !args.probe) writeLedger(ctx, report);
        console.log(JSON.stringify(report));
        return report;
      }
    }
    if (args.dryRun && (step === "publishOrSchedule" || step === "verify")) {
      const skipped = { ok: true, skipped: "dry-run" };
      log.push({ step, ...skipped });
      console.log(line(ctx, step, { ok: true, hint: "dry-run" }));
      continue;
    }
    const result = await adapter[step](ctx);
    log.push({ step, ...result });
    console.log(line(ctx, step, result));
    if (!result?.ok) {
      const report = {
        ok: false,
        platform: ctx.platform,
        step,
        reason: result.code || "FAIL",
        tabId: ctx.tabId || "",
        hint: result.hint || result.detail || "",
        log,
      };
      if (!args.dryRun && !args.probe) writeLedger(ctx, report);
      console.log(JSON.stringify(report));
      return report;
    }
  }
  const report = { ok: true, platform: ctx.platform, dryRun: args.dryRun, probe: args.probe, tabId: ctx.tabId, innerHeight: ctx.innerHeight || 0, previousActiveId, log };
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
