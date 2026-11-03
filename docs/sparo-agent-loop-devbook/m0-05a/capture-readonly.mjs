/**
 * M0-05A read-only capture. Calls navigate / get_url / get_title / page_text / press only.
 * Does not chat, fill, publish, or write missions.jsonl.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const bodyDir = path.join(root, "bodies");
const auth = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, "sparo-store", "mcp-auth.json"), "utf8"));

fs.mkdirSync(bodyDir, { recursive: true });

let rpcId = 0;
let clientId = "";

function redact(input) {
  let count = 0;
  const text = String(input || "")
    .replace(/1[3-9]\d{9}/g, () => {
      count += 1;
      return "[REDACTED-PHONE]";
    })
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, () => {
      count += 1;
      return "[REDACTED-EMAIL]";
    })
    .replace(/((?:cookie|set-cookie|token|apikey|api_key)\s*[:=]\s*)\S+/gi, (_m, prefix) => {
      count += 1;
      return `${prefix}[REDACTED]`;
    });
  return { text, count };
}

async function rpc(method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${auth.token}`,
  };
  if (clientId) headers["x-sparo-client"] = clientId;
  const body = method.startsWith("notifications/")
    ? { jsonrpc: "2.0", method }
    : { jsonrpc: "2.0", id: ++rpcId, method, params };
  const res = await fetch(auth.endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  const cid = res.headers.get("x-sparo-client");
  if (cid) clientId = cid;
  const raw = await res.text();
  if (!raw) return { status: res.status, value: null };
  const parsed = JSON.parse(raw);
  if (parsed.error) {
    throw new Error(`${method} ${parsed.error.message || JSON.stringify(parsed.error)}`);
  }
  return { status: res.status, value: parsed.result };
}

function toolPayload(result) {
  const text = result?.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, message: text };
  }
}

async function callTool(name, args) {
  const result = await rpc("tools/call", { name, arguments: args });
  return toolPayload(result.value);
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function rangeCheck(text) {
  const start = Math.min(200, Math.max(0, text.length - 1));
  const end = Math.min(text.length, start + 300);
  const read = () => text.slice(start, end);
  const a = read();
  const b = read();
  return {
    start,
    end,
    unit: "chars",
    equal: a === b,
    sliceSha256: sha256(a),
    sliceLength: a.length,
  };
}

function withholdReason(finalUrl, text) {
  const url = String(finalUrl || "");
  const head = text.slice(0, 1500);
  const personalUid = /weibo\.com\/u\/(?!2803301701\b)\d+/.test(url);
  const loggedInHome = /weibo\.com\/?($|\?)/.test(url) && !/登录|注册|扫码/.test(head) && text.length > 800;
  if (personalUid || loggedInHome) return "页面像登录后的个人首页，正文不入库";
  return "";
}

async function capture(job) {
  const capturedAt = new Date().toISOString();
  const nav = job.skipNavigate ? null : await callTool("navigate", { url: job.url });
  if (job.waitMs) await new Promise((resolve) => setTimeout(resolve, job.waitMs));
  const url = await callTool("get_url", {});
  const title = await callTool("get_title", {});
  const page = await callTool("page_text", {});
  const finalUrl = url?.data?.url || nav?.data?.url || "";
  const rawText = page?.data?.text || "";
  const reportedLength = page?.data?.length;
  const reason = job.allowPersonal ? "" : withholdReason(finalUrl, rawText);
  const redacted = redact(reason ? "" : rawText);
  const body = redacted.text;
  const rel = `bodies/${job.artifactId}.txt`;
  fs.writeFileSync(path.join(root, rel), body, "utf8");
  const disk = fs.readFileSync(path.join(root, rel), "utf8");
  const again = fs.readFileSync(path.join(root, rel), "utf8");
  const range = rangeCheck(disk);
  const rangeAgain = rangeCheck(again);
  return {
    artifactId: job.artifactId,
    scenes: job.scenes,
    sourceTool: "page_text",
    requestedUrl: job.url,
    finalUrl,
    title: title?.data?.title || nav?.data?.title || "",
    navigateConfirmed: Boolean(nav?.data?.confirmed),
    capturedAt,
    toolOk: Boolean(page?.ok),
    toolMessage: page?.message || nav?.message || "",
    reportedLength: typeof reportedLength === "number" ? reportedLength : null,
    storedLength: body.length,
    truncatedByTool: typeof reportedLength === "number" && reportedLength > rawText.length,
    redactionCount: redacted.count,
    withheld: Boolean(reason),
    withheldReason: reason,
    contentHash: sha256(disk),
    frozenVersion: `sha256:${sha256(disk)}`,
    locator: `docs/sparo-agent-loop-devbook/m0-05a/${rel}`,
    lengthUnit: "chars",
    mime: "text/plain",
    rangeRead: range,
    rangeRepeatEqual: range.equal && rangeAgain.equal && range.sliceSha256 === rangeAgain.sliceSha256 && disk === again,
  };
}

const jobs = [
  {
    artifactId: "art-m005a-g1-weibo-home",
    scenes: ["G1"],
    url: "https://weibo.com/",
  },
  {
    artifactId: "art-m005a-g2-rmrb",
    scenes: ["G2", "G4"],
    url: "https://weibo.com/u/2803301701",
    allowPersonal: true,
  },
  {
    artifactId: "art-m005a-g7-baidu-weather",
    scenes: ["G7"],
    url: "https://www.baidu.com/s?wd=" + encodeURIComponent("今天北京天气"),
  },
  {
    artifactId: "art-m005a-p1-weibo-hot",
    scenes: ["P1"],
    url: "https://s.weibo.com/top/summary?cate=realtimehot",
  },
  {
    artifactId: "art-m005a-r1-baidu-compare",
    scenes: ["R1"],
    url: "https://www.baidu.com/s?wd=" + encodeURIComponent("小米15 iPhone 16 华为Mate 70 哪个值得买"),
  },
];

await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "m0-05a-readonly", version: "1" },
});
await rpc("notifications/initialized");

const sinceArg = process.argv.find((arg) => arg.startsWith("--g2-since="));
if (process.argv.includes("--g2-feed") || process.argv.includes("--g2-feed-next") || sinceArg) {
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const since = sinceArg ? sinceArg.slice("--g2-since=".length) : "";
  const job = {
    artifactId: since
      ? `art-m005a-g2-rmrb-feed-${since}`
      : process.argv.includes("--g2-feed-next")
        ? "art-m005a-g2-rmrb-feed-next"
        : "art-m005a-g2-rmrb-feed",
    scenes: ["G2"],
    url: since
      ? `https://m.weibo.cn/api/container/getIndex?type=uid&value=2803301701&containerid=1076032803301701&since_id=${since}`
      : process.argv.includes("--g2-feed-next")
        ? "https://m.weibo.cn/api/container/getIndex?type=uid&value=2803301701&containerid=1076032803301701&since_id=5359339168861506"
        : "https://m.weibo.cn/api/container/getIndex?type=uid&value=2803301701&containerid=1076032803301701",
    allowPersonal: true,
    waitMs: 2500,
    note: "同一公开账号的时间线接口页。只在正文出现跨日时间时才补 G2。翻页只用上一份返回的 since_id，不登录。",
  };
  process.stdout.write(`g2-feed ${job.artifactId}\n`);
  try {
    const row = await capture(job);
    row.note = job.note;
    manifest.samples.push(row);
    process.stdout.write(`  chars=${row.storedLength} url=${row.finalUrl}\n`);
  } catch (error) {
    manifest.samples.push({
      artifactId: job.artifactId,
      scenes: job.scenes,
      requestedUrl: job.url,
      error: error instanceof Error ? error.message : String(error),
    });
    process.stdout.write(`  error ${manifest.samples.at(-1).error}\n`);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  process.exit(0);
}

if (process.argv.includes("--gate-fill")) {
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const extra = [
    {
      artifactId: "art-m005a-g2-rmrb-timescope",
      scenes: ["G2"],
      url: "https://s.weibo.com/weibo?q=" + encodeURIComponent("人民日报") + "&typeall=1&suball=1&timescope=custom:2026-10-27-0:2026-10-29-23&Refer=g",
      allowPersonal: true,
      waitMs: 3000,
      note: "公开搜索的自定义时间窗 2026-10-27 至 2026-10-29。只在正文真有跨日条目时才能补 G2。",
    },
    {
      artifactId: "art-m005a-t1-ctrip-train",
      scenes: ["T1"],
      url: "https://trains.ctrip.com/trainbooking/beijing-nanjing/",
      waitMs: 4000,
      note: "免登录的公开车次页尝试。查询日按去程 2026-11-11 记录。不订票。若只有壳或登录墙，不算结果页。",
    },
    {
      artifactId: "art-m005a-t1-ctrip-hotel",
      scenes: ["T1"],
      url: "https://hotels.ctrip.com/hotels/list?city=12&checkin=2026-11-12&checkout=2026-11-13",
      waitMs: 4000,
      note: "免登录的南京酒店列表尝试。入住 2026-11-12，离店 2026-11-13。不订房。若城市或价格对不上，不算结果页。",
    },
    {
      artifactId: "art-m005a-r1-apple-iphone16",
      scenes: ["R1"],
      url: "https://www.apple.com.cn/iphone-16/",
      waitMs: 3000,
      note: "苹果官网公开产品页，作为搜索入口之外的第二来源。不是京东、淘宝或点评。",
    },
  ];
  for (const job of extra) {
    process.stdout.write(`gate-fill ${job.artifactId}\n`);
    try {
      const row = await capture(job);
      row.note = job.note;
      manifest.samples.push(row);
      process.stdout.write(`  chars=${row.storedLength} url=${row.finalUrl}\n`);
    } catch (error) {
      manifest.samples.push({
        artifactId: job.artifactId,
        scenes: job.scenes,
        requestedUrl: job.url,
        error: error instanceof Error ? error.message : String(error),
      });
      process.stdout.write(`  error ${manifest.samples.at(-1).error}\n`);
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  process.exit(0);
}

if (process.argv.includes("--append")) {
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const extra = [
    {
      artifactId: "art-m005a-g2-rmrb-mobile",
      scenes: ["G2", "G4", "G8"],
      url: "https://m.weibo.cn/u/2803301701",
      allowPersonal: true,
      waitMs: 4000,
      note: "换公开移动页入口。字符差若事后计算，不写入正文，也不写成工具返回了较上次。",
    },
    {
      artifactId: "art-m005a-g2-rmrb-search",
      scenes: ["G2", "G4"],
      url: "https://s.weibo.com/weibo?q=" + encodeURIComponent("人民日报"),
      allowPersonal: true,
      waitMs: 2500,
      note: "公开搜索入口。不是主页壳，也不是近三天的完整清单，除非正文里真有多条。",
    },
    {
      artifactId: "art-m005a-t1-12306-query",
      scenes: ["T1"],
      url: "https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc&fs=%E5%8C%97%E4%BA%AC,BJP&ts=%E5%8D%97%E4%BA%AC,NJH&date=2026-11-11",
      waitMs: 3000,
      note: "只读查询页。去程日 2026-11-11，对应酒店入住 2026-11-12、离店与返程 2026-11-13。不订票。",
    },
  ];
  for (const job of extra) {
    process.stdout.write(`append ${job.artifactId}\n`);
    try {
      const row = await capture(job);
      row.note = job.note;
      const wall = /验证码|请登录|扫码登录|登录12306/.test((fs.readFileSync(path.join(root, `bodies/${job.artifactId}.txt`), "utf8")).slice(0, 1500));
      row.stoppedAtWall = wall;
      manifest.samples.push(row);
      process.stdout.write(`  chars=${row.storedLength} wall=${wall} url=${row.finalUrl}\n`);
    } catch (error) {
      manifest.samples.push({
        artifactId: job.artifactId,
        scenes: job.scenes,
        requestedUrl: job.url,
        error: error instanceof Error ? error.message : String(error),
      });
      process.stdout.write(`  error ${manifest.samples.at(-1).error}\n`);
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  process.exit(0);
}

if (process.argv.includes("--settle-rmrb")) {
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  process.stdout.write("settle rmrb\n");
  await callTool("navigate", { url: "https://weibo.com/u/2803301701" });
  await new Promise((resolve) => setTimeout(resolve, 4000));
  let previousId = "art-m005a-g2-rmrb";
  let previousLength = 100;
  for (let step = 0; step < 4; step += 1) {
    const row = await capture({
      artifactId: `art-m005a-g2-rmrb-settled-${step}`,
      scenes: step === 0 ? ["G2", "G4"] : ["G8"],
      url: "https://weibo.com/u/2803301701",
      allowPersonal: true,
      skipNavigate: true,
    });
    row.offlineCharDelta = row.storedLength - previousLength;
    row.comparedTo = previousId;
    row.note = "较上次标记不写入正文。offlineCharDelta 只是两次冻结正文的字符差。";
    manifest.samples.push(row);
    process.stdout.write(`  step=${step} chars=${row.storedLength} delta=${row.offlineCharDelta} url=${row.finalUrl}\n`);
    previousId = row.artifactId;
    previousLength = row.storedLength;
    if (step < 3) {
      await callTool("press", { key: "PageDown" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  process.exit(0);
}

if (process.argv.includes("--wp7")) {
  const manifestPath = path.join(root, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const extra = [
    {
      artifactId: "art-m005a-g2-rmrb-feed-5358964638222865",
      scenes: ["G2"],
      url: "https://m.weibo.cn/api/container/getIndex?type=uid&value=2803301701&containerid=1076032803301701&since_id=5358964638222865",
      allowPersonal: true,
      waitMs: 2500,
      note: "WP7 追加。上一页 since_id。只接受同一账号正文里真实出现的 10 月 27 日。不登录。",
    },
    {
      artifactId: "art-m005a-t1-ctrip-train-20261111",
      scenes: ["T1"],
      url: "https://trains.ctrip.com/trainbooking/beijing-nanjing/?dDate=2026-11-11",
      waitMs: 4000,
      note: "WP7 追加。去程日写进查询参数 2026-11-11。以页上实际日期为准。不订票。",
    },
    {
      artifactId: "art-m005a-t1-ctrip-train-return-20261113",
      scenes: ["T1"],
      url: "https://trains.ctrip.com/trainbooking/nanjing-beijing/?dDate=2026-11-13",
      waitMs: 4000,
      note: "WP7 追加。返程南京到北京，查询参数 2026-11-13。以页上实际日期为准。不订票。",
    },
    {
      artifactId: "art-m005a-t1-ctrip-hotel-20261112",
      scenes: ["T1"],
      url: "https://hotels.ctrip.com/hotels/list?city=12&checkin=2026-11-12&checkout=2026-11-13",
      waitMs: 4000,
      note: "WP7 追加。南京，入住 2026-11-12，离店 2026-11-13。单店价格若仍在登录后，不作为价格依据。不订房。",
    },
    {
      artifactId: "art-m005a-r1-mi-xiaomi15",
      scenes: ["R1"],
      url: "https://www.mi.com/xiaomi-15",
      waitMs: 4000,
      note: "WP7 追加。小米官网公开页，作为 iPhone 16 之外的同等来源。不是京东、淘宝或点评。",
    },
    {
      artifactId: "art-m005a-r1-huawei-mate70",
      scenes: ["R1"],
      url: "https://consumer.huawei.com/cn/phones/mate70/",
      waitMs: 4000,
      note: "WP7 追加。华为官网公开页，作为第三款同等来源。不是京东、淘宝或点评。",
    },
    {
      artifactId: "art-m005a-g2-rmrb-feed-5358896219684903",
      scenes: ["G2"],
      url: "https://m.weibo.cn/api/container/getIndex?type=uid&value=2803301701&containerid=1076032803301701&since_id=5358896219684903",
      allowPersonal: true,
      waitMs: 2500,
      note: "WP7 再翻一页。只接受正文里真实出现的 10 月 27 日。没有就停止，不继续翻。",
    },
    {
      artifactId: "art-m005a-t1-ctrip-list-20261111",
      scenes: ["T1"],
      url: "https://trains.ctrip.com/webapp/train/list?ticketType=0&dStation=%E5%8C%97%E4%BA%AC&aStation=%E5%8D%97%E4%BA%AC&dDate=2026-11-11",
      waitMs: 4000,
      note: "WP7 第二次去程。日期参数 2026-11-11。以页上实际日期为准。不订票。",
    },
    {
      artifactId: "art-m005a-t1-ctrip-list-return-20261113",
      scenes: ["T1"],
      url: "https://trains.ctrip.com/webapp/train/list?ticketType=0&dStation=%E5%8D%97%E4%BA%AC&aStation=%E5%8C%97%E4%BA%AC&dDate=2026-11-13",
      waitMs: 4000,
      note: "WP7 第二次返程。日期参数 2026-11-13。以页上实际日期为准。不订票。",
    },
    {
      artifactId: "art-m005a-r1-mi-xiaomi15-specs",
      scenes: ["R1"],
      url: "https://www.mi.com/xiaomi-15/specs",
      waitMs: 3000,
      note: "WP7 小米官网规格页。上一地址是错误页。不是京东、淘宝或点评。",
    },
  ];
  for (const job of extra) {
    if (manifest.samples.some((row) => row.artifactId === job.artifactId)) {
      process.stdout.write(`skip existing ${job.artifactId}\n`);
      continue;
    }
    process.stdout.write(`wp7 ${job.artifactId}\n`);
    try {
      const row = await capture(job);
      row.note = job.note;
      manifest.samples.push(row);
      process.stdout.write(`  chars=${row.storedLength} url=${row.finalUrl}\n`);
    } catch (error) {
      manifest.samples.push({
        artifactId: job.artifactId,
        scenes: job.scenes,
        requestedUrl: job.url,
        error: error instanceof Error ? error.message : String(error),
      });
      process.stdout.write(`  error ${manifest.samples.at(-1).error}\n`);
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  process.exit(0);
}

const samples = [];
for (const job of jobs) {
  process.stdout.write(`capture ${job.artifactId}\n`);
  try {
    const row = await capture(job);
    samples.push(row);
    process.stdout.write(`  url=${row.finalUrl} chars=${row.storedLength} withheld=${row.withheld} range=${row.rangeRepeatEqual}\n`);
    if (job.artifactId === "art-m005a-g2-rmrb" && !row.withheld) {
      await callTool("press", { key: "PageDown" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const second = await capture({
        artifactId: "art-m005a-g8-rmrb-pagedown",
        scenes: ["G8"],
        url: row.finalUrl || job.url,
        allowPersonal: true,
        skipNavigate: true,
      });
      const prev = row.storedLength;
      second.offlineCharDelta = second.storedLength - prev;
      second.comparedTo = row.artifactId;
      second.note = "较上次标记是模型侧注解，不是 page_text 正文。这里只记录两次冻结正文的字符差，不写进正文。";
      samples.push(second);
      process.stdout.write(`  g8 chars=${second.storedLength} delta=${second.offlineCharDelta}\n`);
    }
  } catch (error) {
    samples.push({
      artifactId: job.artifactId,
      scenes: job.scenes,
      requestedUrl: job.url,
      error: error instanceof Error ? error.message : String(error),
    });
    process.stdout.write(`  error ${samples.at(-1).error}\n`);
  }
}

const manifest = {
  sampleSetId: "m0-05a-2026-10-29",
  capturedBy: "page_text",
  notAMission: true,
  journalUntouched: true,
  samples,
};
fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
process.stdout.write(`wrote ${samples.length} rows\n`);
