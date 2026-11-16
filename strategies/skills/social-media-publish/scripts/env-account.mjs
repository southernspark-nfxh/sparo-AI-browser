// 账号环境解析与提交前硬门。纯函数，不连接 Sparo，失败时不回退默认登录态。

const DIGITS = { "零": "0", "〇": "0", "一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9" };

function parseTen(run) {
  const ten = run.indexOf("十");
  if (ten < 0 || run.indexOf("十", ten + 1) >= 0) return null;
  const left = run.slice(0, ten);
  const right = run.slice(ten + 1);
  if (left.length > 1 || right.length > 1) return null;
  const high = left ? DIGITS[left] : "1";
  const low = right ? DIGITS[right] : "0";
  if (high == null || low == null) return null;
  return Number(high) * 10 + Number(low);
}

/** 空白折叠后，把汉字数字串归一成阿拉伯数字。只做全名相等，不做包含或编辑距离。 */
export function normalizeEnvName(value) {
  const text = String(value || "").trim().replace(/\s+/g, "");
  return text.replace(/[零〇一二三四五六七八九十]+/g, (run) => {
    if (run.includes("十")) {
      const n = parseTen(run);
      return n == null ? run : String(n);
    }
    let out = "";
    for (const ch of run) {
      if (!DIGITS[ch]) return run;
      out += DIGITS[ch];
    }
    return out;
  });
}

export function envAllows(tab, envId) {
  const want = String(envId || "").trim();
  const got = String(tab?.envId || "").trim();
  if (!want) return got === "";
  return got === want;
}

/**
 * 先按 id 精确匹配，再按归一后的环境全名精确匹配。
 * 没有命中或命中多个都失败，不挑最近的，也不改走默认登录态。
 */
export function resolveEnv(roster, query) {
  const raw = String(query || "").trim();
  const available = (roster || [])
    .map((env) => ({ id: String(env?.id || "").trim(), name: String(env?.name || "").trim() }))
    .filter((env) => env.id);
  if (!raw) {
    return { ok: false, code: "ENV_NOT_FOUND", input: raw, envs: available, hint: "没有给出账号，没有改走默认登录态" };
  }
  const byId = available.filter((env) => env.id === raw);
  if (byId.length === 1) return { ok: true, envId: byId[0].id, envName: byId[0].name };
  if (byId.length > 1) {
    return { ok: false, code: "ENV_AMBIGUOUS", input: raw, envs: byId, hint: "环境 id 命中多个，没有改走默认登录态" };
  }
  const key = normalizeEnvName(raw);
  const byName = available.filter((env) => normalizeEnvName(env.name) === key);
  if (byName.length === 1) return { ok: true, envId: byName[0].id, envName: byName[0].name };
  if (byName.length > 1) {
    return { ok: false, code: "ENV_AMBIGUOUS", input: raw, envs: byName, hint: "归一后命中多个环境，没有改走默认登录态" };
  }
  return { ok: false, code: "ENV_NOT_FOUND", input: raw, envs: available, hint: "名册里没有这个环境，没有改走默认登录态" };
}

export function judgeSubmitGate(input) {
  const envId = String(input?.envId || "").trim();
  if (!envId) return { ok: true, code: "DEFAULT_LOGIN", skipped: "default-login" };
  const tab = input?.tab || null;
  const tabId = String(input?.tabId || tab?.id || "");
  const actualEnvId = String(tab?.envId || "");
  if (!tab || tab.id !== tabId || actualEnvId !== envId) {
    return {
      ok: false,
      code: "ENV_MISMATCH",
      expectedEnvId: envId,
      actualEnvId,
      tabId,
      hint: "提交前编辑标签不在目标账号环境",
    };
  }
  const expected = String(input?.expectedAccountName || "").trim();
  const actual = String(input?.actualAccountName || "").trim();
  if (!expected || !actual) {
    return {
      ok: false,
      code: "ACCOUNT_NAME_UNAVAILABLE",
      envId,
      tabId,
      url: String(input?.url || ""),
      hint: "页面账号名读不到，没有提交",
    };
  }
  if (expected !== actual) {
    return {
      ok: false,
      code: "ACCOUNT_MISMATCH",
      expectedAccountName: expected,
      actualAccountName: actual,
      envId,
      tabId,
      hint: "页面账号名和打开编辑页时不一致，没有提交",
    };
  }
  return { ok: true, envId, accountName: actual, tabId };
}

/** 硬门没过，或 dry-run，都不调用 submit。 */
export function guardedSubmit(input, submit) {
  const judged = judgeSubmitGate(input);
  if (!judged.ok) return { ...judged, submitted: false, clicks: 0 };
  if (input?.dryRun) {
    return { ok: true, skipped: "dry-run", clicks: 0, submitted: false, envId: judged.envId || "", accountName: judged.accountName || "" };
  }
  if (typeof submit === "function") submit();
  return { ...judged, submitted: true, clicks: typeof submit === "function" ? 1 : 0 };
}

export function ledgerEnvFields(ctx) {
  return {
    envId: String(ctx?.envId || ""),
    envName: String(ctx?.envName || ""),
    accountName: String(ctx?.accountName || ctx?.expectedAccountName || ""),
  };
}

export const BAIJIAHAO_ACCOUNT_SCRIPT =
  "(() => {" +
  "const bad = /发布|编辑|首页|消息|通知|设置|退出|登录|创作|数据|内容|评论|粉丝|收益|百家号|头像|搜索/;" +
  "const exactBad = new Set(['图文','视频','音频','动态','合集','作品','管理','发布','首页','消息','通知','设置','退出','登录','创作','数据','内容','评论','粉丝','收益','百家号','头像','搜索']);" +
  "const clean = (el) => ((el && (el.innerText || el.textContent)) || '').replace(/\\s+/g, ' ').trim();" +
  "const ok = (name) => !!name && name.length <= 32 && !bad.test(name) && !exactBad.has(name);" +
  "const sels = ['.mp-header-user-name','.header-user-name','.user-name','.cheetah-public-header .name','[class*=\"userName\"]','[class*=\"nickName\"]','[class*=\"nickname\"]','[class*=\"account-name\"]','[class*=\"accountName\"]'];" +
  "for (const sel of sels) {" +
  "const name = clean(document.querySelector(sel));" +
  "if (ok(name)) return JSON.stringify({ name, via: sel, href: location.href });" +
  "}" +
  // 视频编辑页头部只有头像、没有昵称，直接问百家号自己的 appinfo 接口要 data.user.name
  "try {" +
  "const xhr = new XMLHttpRequest();" +
  "xhr.open('GET', '/builder/app/appinfo', false);" +
  "xhr.withCredentials = true;" +
  "xhr.send();" +
  "if (xhr.status === 200) {" +
  "const j = JSON.parse(xhr.responseText || '{}');" +
  "const user = (j && j.data && j.data.user) || {};" +
  "const name = String(user.name || user.author_name || '').trim();" +
  "if (ok(name)) return JSON.stringify({ name, via: 'appinfo', href: location.href });" +
  "}" +
  "} catch (e) {}" +
  "const roots = document.querySelectorAll('header, [class*=\"header\"], [class*=\"Header\"]');" +
  "for (const root of roots) {" +
  "const bits = root.querySelectorAll('span, a, div, p');" +
  "for (const el of bits) {" +
  "if (el.children.length) continue;" +
  "const box = el.getBoundingClientRect();" +
  "if (box.top > 120 || box.height > 40 || box.width < 8) continue;" +
  "const name = clean(el);" +
  "if (ok(name)) return JSON.stringify({ name, via: 'header-text', href: location.href });" +
  "}" +
  "}" +
  "return JSON.stringify({ name: '', href: location.href });" +
  "})()";

export function runEnvFixtures() {
  const roster = [
    { id: "546cd4ba", name: "accept-env" },
    { id: "ad0fe9db", name: "百家号2" },
    { id: "4cc12233", name: "百家号三" },
  ];
  if (normalizeEnvName(" 百家号 二 ") !== "百家号2") throw new Error("百家号二没有归一成百家号2");
  if (normalizeEnvName("百家号三") !== "百家号3") throw new Error("百家号三没有归一成百家号3");
  if (normalizeEnvName("百家号两") === "百家号2") throw new Error("「两」被误当成 2");
  const second = resolveEnv(roster, "百家号二");
  if (!second.ok || second.envId !== "ad0fe9db" || second.envName !== "百家号2") throw new Error("百家号二没有解析到百家号2");
  const byId = resolveEnv(roster, "ad0fe9db");
  if (!byId.ok || byId.envId !== "ad0fe9db") throw new Error("环境 id 没有精确命中");
  const missing = resolveEnv(roster, "百家号四");
  if (missing.ok || missing.code !== "ENV_NOT_FOUND" || missing.envId) throw new Error("不存在的账号没有失败关闭");
  if (!missing.envs.some((env) => env.id === "ad0fe9db" && env.name === "百家号2")) throw new Error("失败结果没有带上可用环境");
  if (resolveEnv(roster, "百家号").ok) throw new Error("短名字被包含匹配到了百家号2");
  const ambiguous = resolveEnv(
    [
      { id: "a", name: "百家号二" },
      { id: "b", name: "百家号2" },
    ],
    "百家号2",
  );
  if (ambiguous.ok || ambiguous.code !== "ENV_AMBIGUOUS" || ambiguous.envs.length !== 2) throw new Error("同名环境没有标成歧义");
  const tab = { id: "tab-1", envId: "ad0fe9db", url: "https://baijiahao.baidu.com/builder/rc/edit?type=news" };
  const stable = judgeSubmitGate({
    envId: "ad0fe9db",
    envName: "百家号2",
    tabId: "tab-1",
    tab,
    expectedAccountName: "图一乐研究所",
    actualAccountName: "图一乐研究所",
    url: tab.url,
  });
  if (!stable.ok || stable.accountName !== "图一乐研究所") throw new Error("环境名和站点昵称不同却被拦下");
  let clicks = 0;
  const mismatch = guardedSubmit(
    { envId: "ad0fe9db", tabId: "tab-1", tab: { id: "tab-1", envId: "4cc12233" }, expectedAccountName: "图一乐研究所", actualAccountName: "图一乐研究所" },
    () => { clicks += 1; },
  );
  if (mismatch.ok || mismatch.code !== "ENV_MISMATCH" || mismatch.submitted || clicks !== 0) throw new Error("环境不一致仍然提交了");
  const unread = guardedSubmit(
    { envId: "ad0fe9db", tabId: "tab-1", tab, expectedAccountName: "图一乐研究所", actualAccountName: "" },
    () => { clicks += 1; },
  );
  if (unread.code !== "ACCOUNT_NAME_UNAVAILABLE" || clicks !== 0) throw new Error("账号名读不到仍然提交了");
  const changed = guardedSubmit(
    { envId: "ad0fe9db", tabId: "tab-1", tab, expectedAccountName: "图一乐研究所", actualAccountName: "另一个号" },
    () => { clicks += 1; },
  );
  if (changed.code !== "ACCOUNT_MISMATCH" || clicks !== 0) throw new Error("账号名变了仍然提交了");
  const dryMismatch = guardedSubmit(
    { dryRun: true, envId: "ad0fe9db", tabId: "tab-1", tab: { id: "tab-1", envId: "4cc12233" }, expectedAccountName: "图一乐研究所", actualAccountName: "图一乐研究所" },
    () => { clicks += 1; },
  );
  if (dryMismatch.ok || dryMismatch.code !== "ENV_MISMATCH" || dryMismatch.clicks !== 0 || clicks !== 0) throw new Error("dry-run 没有执行环境硬门");
  const dry = guardedSubmit(
    { dryRun: true, envId: "ad0fe9db", tabId: "tab-1", tab, expectedAccountName: "图一乐研究所", actualAccountName: "图一乐研究所" },
    () => { clicks += 1; },
  );
  if (!dry.ok || dry.clicks !== 0 || dry.submitted || clicks !== 0) throw new Error("dry-run 仍然点了提交");
  const legacy = judgeSubmitGate({ envId: "", tabId: "tab-1", tab: { id: "tab-1", envId: "" } });
  if (!legacy.ok || legacy.code !== "DEFAULT_LOGIN") throw new Error("没传环境时没有保持默认登录态");
  const row = { platform: "baijiahao", title: "旧稿", ...ledgerEnvFields({ envId: "ad0fe9db", envName: "百家号2", accountName: "图一乐研究所" }) };
  if (row.platform !== "baijiahao" || row.envId !== "ad0fe9db" || row.accountName !== "图一乐研究所") throw new Error("台账没有带上环境字段");
  const old = { platform: "baijiahao", title: "更早的稿", ...ledgerEnvFields({}) };
  if (old.title !== "更早的稿" || old.envId !== "") throw new Error("旧台账字段被挤掉了");
  if (BAIJIAHAO_ACCOUNT_SCRIPT.includes("百家号2") || BAIJIAHAO_ACCOUNT_SCRIPT.includes("envName")) {
    throw new Error("读账号名脚本拿环境名去对站点昵称");
  }
  if (!BAIJIAHAO_ACCOUNT_SCRIPT.includes("/builder/app/appinfo")) throw new Error("视频编辑页没有 appinfo 兜底就真读不到昵称");
  if (!BAIJIAHAO_ACCOUNT_SCRIPT.includes("data.user") && !BAIJIAHAO_ACCOUNT_SCRIPT.includes("data && j.data.user")) {
    throw new Error("appinfo 没有读 data.user");
  }
  if (!BAIJIAHAO_ACCOUNT_SCRIPT.includes("exactBad") || !BAIJIAHAO_ACCOUNT_SCRIPT.includes("图文")) {
    throw new Error("头部兜底会把「图文」这种导航词当成昵称");
  }
}
