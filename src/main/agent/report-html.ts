/**
 * 长回复落成可在 Sparo 窗口打开的本地 HTML（行程手册 / 阅读页）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addDays } from "./travel.js";
import { daysBetween, type TripPlan } from "./trip-plan.js";

export type ChatDoc = {
  title: string;
  path: string;
  kind: "trip" | "read";
};

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function markdownToHtml(md: string): string {
  const lines = String(md || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const out: string[] = [];
  let i = 0;
  const inline = (s: string) => {
    const links: { t: string; u: string }[] = [];
    const marked = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t, u) => {
      links.push({ t, u });
      return `\u0000L${links.length - 1}\u0000`;
    });
    let html = escapeHtml(marked)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noreferrer">$1</a>',
      );
    links.forEach((l, idx) => {
      html = html.replace(
        `\u0000L${idx}\u0000`,
        `<a class="hotel-link" href="${escapeHtml(l.u)}" target="_blank" rel="noreferrer">${escapeHtml(l.t)}</a>`,
      );
    });
    return html;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      out.push("<hr />");
      i += 1;
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      const tag = `h${h[1].length + 1}`;
      out.push(`<${tag}>${inline(h[2])}</${tag}>`);
      i += 1;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /\|[\s-:|]+\|/.test(lines[i + 1] || "")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) {
        const cells = lines[i]
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        if (!/^[-:]+$/.test(cells.join("").replace(/\|/g, ""))) {
          rows.push(cells);
        }
        i += 1;
      }
      if (rows.length) {
        const head = rows[0];
        const body = rows.slice(1);
        out.push("<table>");
        out.push(
          "<thead><tr>" +
            head.map((c) => `<th>${inline(c)}</th>`).join("") +
            "</tr></thead>",
        );
        out.push(
          "<tbody>" +
            body
              .map(
                (r) =>
                  "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>",
              )
              .join("") +
            "</tbody></table>",
        );
      }
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      out.push("<ul>");
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        out.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i += 1;
      }
      out.push("</ul>");
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("#") &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !lines[i].includes("|")
    ) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

function reportCss(): string {
  return `
:root {
  --ink: #1a1f27;
  --paper: #f7f4ee;
  --card: #fff;
  --line: #e6e0d4;
  --red: #b42318;
  --mute: #6b645a;
  --chip: #f1ebe0;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  background: #ece7dc;
  color: var(--ink);
  font-family: "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
body { padding: 24px 12px 72px; }
.page {
  max-width: 720px;
  margin: 0 auto;
  background: var(--paper);
  border: 1px solid #ddd6c8;
  border-radius: 16px;
  overflow: hidden;
}
.ticket {
  padding: 28px 28px 22px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}
.eyebrow {
  margin: 0 0 8px;
  letter-spacing: .16em;
  font-size: 11px;
  color: var(--red);
  font-weight: 600;
}
h1 {
  margin: 0 0 12px;
  font-size: 26px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: -0.02em;
}
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.chips li {
  background: var(--chip);
  color: #3d3830;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 13px;
}
.dates, .mute { margin: 12px 0 0; color: var(--mute); font-size: 14px; }
.mute { margin: 0; }
.body { padding: 8px 20px 28px; }
.body h2 { font-size: 15px; margin: 22px 8px 10px; color: var(--mute); font-weight: 650; }
.body h3 { font-size: 16px; margin: 18px 0 8px; }
.body p, .body li { line-height: 1.7; font-size: 15px; }
.body table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
  margin: 10px 0 16px;
}
.body th, .body td {
  border-bottom: 1px solid var(--line);
  text-align: left;
  padding: 7px 8px 7px 0;
  vertical-align: top;
}
.body th { color: var(--mute); font-weight: 600; }
.body a { color: var(--red); }
.days { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.day {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px 16px 14px;
}
.day-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}
.day-top time { font-size: 20px; font-weight: 700; letter-spacing: -0.03em; }
.day-top .wk { color: var(--mute); font-size: 13px; margin-left: 6px; font-weight: 500; }
.day-top .where { color: var(--ink); font-size: 15px; font-weight: 650; }
.row { display: grid; grid-template-columns: 48px 1fr; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); }
.k { color: var(--mute); font-size: 12px; padding-top: 6px; }
.btn {
  display: inline-block;
  background: #fff5f3;
  color: var(--red);
  text-decoration: none;
  border: 1px solid #f0c9c4;
  border-radius: 10px;
  padding: 8px 12px;
  font-weight: 650;
  font-size: 14px;
}
.btn:hover { background: #ffe8e4; }
.picks { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.picks a {
  display: block;
  text-decoration: none;
  color: var(--ink);
  background: #faf8f3;
  border-radius: 10px;
  padding: 9px 12px;
  font-weight: 600;
}
.picks a:hover { background: #fff5f3; color: var(--red); }
.picks .meta { display: block; color: var(--mute); font-weight: 500; font-size: 13px; margin-top: 4px; line-height: 1.55; }
.hint { margin: 8px 0 0; color: #3f3a33; font-size: 13.5px; line-height: 1.6; }
.pitch { margin: 0 0 10px; color: #3f3a33; font-size: 14px; line-height: 1.65; }
.more { margin: 20px 8px 0; border-top: 1px solid var(--line); padding-top: 12px; }
.more summary { cursor: pointer; color: var(--mute); font-size: 14px; }
.more-body { margin-top: 12px; }
.hotels a.hotel-link, .flights a.hotel-link, .body a.hotel-link { color: var(--red); }
.foot { padding: 0 28px 22px; color: var(--mute); font-size: 12px; }
@media (max-width: 640px) {
  .ticket, .body { padding-left: 16px; padding-right: 16px; }
  .day-top { flex-direction: column; gap: 4px; }
}
@media print {
  html, body { background: #fff; }
  .page { border: none; }
}
`.trim();
}

export type HotelLink = {
  city: string;
  name: string;
  url: string;
  price?: string;
  score?: string;
  area?: string;
  reason?: string;
};
export type FlightLink = { label: string; url: string; hint?: string };

export function formatHotelLinks(hotels: HotelLink[]): string {
  if (!hotels.length) return "";
  return (
    "可点击酒店：\n" +
    hotels
      .map((h) => {
        const why = [h.price, h.score ? `${h.score}分` : "", h.area, h.reason]
          .filter(Boolean)
          .join(" · ");
        return `- [${h.name}](${h.url})${why ? `（${why}）` : ""}`;
      })
      .join("\n")
  );
}

export function formatFlightLinks(flights: FlightLink[]): string {
  if (!flights.length) return "";
  return (
    "可点击机票：\n" +
    flights
      .map((f) => `- [${f.label}](${f.url})${f.hint ? `（${f.hint}）` : ""}`)
      .join("\n")
  );
}

export function parseYuan(text?: string): number | null {
  const m = String(text || "").replace(/,/g, "").match(/(\d{3,6})/);
  return m ? Number(m[1]) : null;
}

export function hotelReason(h: HotelLink, nights: number): string {
  if (h.reason) return h.reason;
  const name = `${h.name} ${h.area || ""}`;
  const price = h.price ? `${h.price}起` : "";
  const score = h.score ? `评分 ${h.score}` : "";
  if (/机场/.test(name)) {
    return nights <= 1
      ? `赶早班机方便。${price}${score ? "，" + score : ""}。玩市区会多耗在路上。`
      : `换飞机近。连住几天的话，白天出门不太划算。${price}`;
  }
  if (/外滩|陆家嘴|南京路/.test(name)) {
    return `靠外滩一带，玩一天少花在通勤上。${price}${score ? "，" + score : ""}。`;
  }
  if (/海棠|亚龙|海滩|海景|度假/.test(name)) {
    return nights >= 2
      ? `海边度假店，连住少搬家。${price}${score ? "，" + score : ""}。`
      : `海边店，住一晚也能看到海。${price}`;
  }
  if (/洱海/.test(name)) {
    return `靠洱海/海东公园，傍晚能散步。${price}${score ? "，" + score : ""}。`;
  }
  if (/翠湖/.test(name)) {
    return `靠翠湖，逛老城近。${price}${score ? "，" + score : ""}。`;
  }
  if (/火车|高铁|万达/.test(name)) {
    return `换火车或吃饭方便，适合落脚。${price}${score ? "，" + score : ""}。`;
  }
  const loc = h.area ? `地段在${h.area.replace(/^近/, "")}。` : "";
  return `${loc}${price}${score ? "，" + score : ""}。按列表里能看到的信息选的，点进去核对房型和早餐。`;
}

export function stayPitch(city: string, nights: number): string {
  if (nights >= 3) return `${city}连住 ${nights} 晚，优先少搬家、评分稳、出门方便的店。`;
  if (nights === 1) return `${city}只住 1 晚，靠近当天要玩的地方，不把时间耗在机场或郊区。`;
  return `${city}住 ${nights} 晚，在价格和位置之间折中。`;
}

export function flightHintFromText(text: string): string {
  const raw = String(text || "");
  if (/列表未加载|没有刷全|页面还没出/.test(raw) && !/[¥￥]\s*\d{3,}/.test(raw)) {
    return "这页当时没刷全。点进去看当天最低价、最早直飞，不要按「没航班」理解。";
  }
  const prices = [...raw.matchAll(/[¥￥]\s*(\d{3,5})/g)].map((m) => Number(m[1]));
  const times = [...raw.matchAll(/\b(\d{1,2}:\d{2})\b/g)].map((m) => m[1].padStart(5, "0"));
  const cheap = prices.length ? Math.min(...prices) : null;
  const early = times.length ? [...times].sort()[0] : "";
  const bits: string[] = [];
  if (cheap) bits.push(`列表大约 ¥${cheap} 起`);
  if (early) bits.push(`最早一班约 ${early.replace(/^0/, "")}`);
  if (/直飞/.test(raw)) bits.push("有直飞");
  if (/中转|经停/.test(raw)) bits.push("也有中转，通常更便宜但更耗白天");
  if (!bits.length) return "点进列表看时刻和价格。想留出游玩时间，优先早班直飞。";
  return `${bits.join("，")}。想把白天留给走路，优先早班直飞，别选夜里出发次日才到的。`;
}

function md(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

function weekday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return "日一二三四五六"[new Date(y, (m || 1) - 1, d || 1).getDay()];
}

function staysOf(plan: TripPlan): Array<{ city: string; checkin: string; checkout: string; nights: number }> {
  const rows: Array<{ city: string; checkin: string; checkout: string; nights: number }> = [];
  let cursor = plan.startDate;
  const even = Math.max(1, Math.floor(Math.max(1, daysBetween(plan.startDate, plan.endDate)) / Math.max(1, plan.cities.length)));
  for (let i = 0; i < plan.cities.length; i++) {
    const last = i === plan.cities.length - 1;
    const n = plan.nights?.[i] || even;
    const checkout = last ? plan.endDate : addDays(cursor, n);
    rows.push({
      city: plan.cities[i],
      checkin: cursor,
      checkout,
      nights: Math.max(1, daysBetween(cursor, checkout)),
    });
    cursor = checkout;
  }
  return rows;
}

function findLeg(flights: FlightLink[], from: string, to: string): FlightLink | undefined {
  return flights.find(
    (f) =>
      f.label.includes(`${from} → ${to}`) ||
      (f.label.includes(from) && f.label.includes(to) && /^https?:/i.test(f.url)),
  );
}

function hotelsInCity(hotels: HotelLink[], city: string, nights: number): HotelLink[] {
  const uniq: HotelLink[] = [];
  const seen = new Set<string>();
  for (const h of hotels) {
    if (h.city !== city || !h.name || !/^https?:/i.test(h.url)) continue;
    if (seen.has(h.name)) continue;
    seen.add(h.name);
    uniq.push(h);
  }
  const play = (h: HotelLink) => /外滩|洱海|海棠|亚龙|翠湖|海景|度假|陆家嘴/.test(`${h.name} ${h.area || ""}`);
  const airport = (h: HotelLink) => /机场/.test(`${h.name} ${h.area || ""}`);
  const ranked = [...uniq].sort((a, b) => {
    if (nights <= 1 && airport(a) !== airport(b)) return airport(a) ? 1 : -1;
    if (play(a) !== play(b)) return play(a) ? -1 : 1;
    return (parseYuan(a.price) || 9e6) - (parseYuan(b.price) || 9e6);
  });
  const picked: HotelLink[] = [];
  const take = (pred: (h: HotelLink) => boolean) => {
    const hit = ranked.find((h) => !picked.includes(h) && pred(h));
    if (hit) picked.push(hit);
  };
  take((h) => play(h) && !airport(h));
  take((h) => !airport(h));
  take((h) => (parseYuan(h.price) || 0) > 800);
  for (const h of ranked) {
    if (picked.length >= 3) break;
    if (!picked.includes(h)) picked.push(h);
  }
  return picked.slice(0, 3);
}

function flightBlock(leg: FlightLink | undefined, fallback: string): string {
  if (!leg?.url) return `<span class="mute">${escapeHtml(fallback)}</span>`;
  const hint = leg.hint ? `<p class="hint">${escapeHtml(leg.hint)}</p>` : "";
  return `<div><a class="btn" href="${escapeHtml(leg.url)}" target="_blank" rel="noreferrer">${escapeHtml(fallback)}</a>${hint}</div>`;
}

function itineraryHtml(plan: TripPlan, flights: FlightLink[], hotels: HotelLink[]): string {
  const stays = staysOf(plan);
  if (!stays.length) return "";
  const cards: string[] = [];
  stays.forEach((stay, i) => {
    const from = i === 0 ? plan.origin : stays[i - 1].city;
    const leg = findLeg(flights, from, stay.city);
    const picks = hotelsInCity(hotels, stay.city, stay.nights);
    const hotelList = picks.length
      ? `<ul class="picks">${picks
          .map((h) => {
            const why = hotelReason(h, stay.nights);
            return `<li><a href="${escapeHtml(h.url)}" target="_blank" rel="noreferrer">${escapeHtml(h.name)}<span class="meta">${escapeHtml(why)}</span></a></li>`;
          })
          .join("")}</ul>`
      : `<p class="dates">这城还没抽到可点的店，先看机票页再补。</p>`;
    cards.push(`<article class="day">
      <div class="day-top">
        <time>${escapeHtml(md(stay.checkin))}<span class="wk">周${weekday(stay.checkin)}</span></time>
        <p class="where">到${escapeHtml(stay.city)} · 住${stay.nights}晚</p>
      </div>
      <p class="pitch">${escapeHtml(stayPitch(stay.city, stay.nights))}</p>
      <div class="row"><span class="k">机票</span>${flightBlock(leg, `${from} → ${stay.city}`)}</div>
      <div class="row"><span class="k">住宿</span><div>${hotelList}</div></div>
    </article>`);
  });
  const last = stays[stays.length - 1];
  const home = findLeg(flights, last.city, plan.origin);
  cards.push(`<article class="day">
    <div class="day-top">
      <time>${escapeHtml(md(plan.endDate))}<span class="wk">周${weekday(plan.endDate)}</span></time>
      <p class="where">回${escapeHtml(plan.origin)}</p>
    </div>
    <p class="pitch">当天回程。想白天再玩一会儿，选傍晚直飞；想早点到家，选上午班。</p>
    <div class="row"><span class="k">机票</span>${flightBlock(home, `${last.city} → ${plan.origin}`)}</div>
  </article>`);
  return `<h2>按天走，先看怎么选，再点开订</h2><div class="days">${cards.join("")}</div>`;
}

export function tripReportHtml(opts: {
  plan: TripPlan;
  userAsk: string;
  summary: string;
  hotels?: HotelLink[];
  flights?: FlightLink[];
}): string {
  const title = `${opts.plan.origin} → ${opts.plan.cities.join(" → ")} → ${opts.plan.origin}`;
  const nights = Math.max(0, daysBetween(opts.plan.startDate, opts.plan.endDate));
  const chips = [
    `${md(opts.plan.startDate)} – ${md(opts.plan.endDate)}`,
    `${nights}晚`,
    `${opts.plan.cities.length}座城`,
    `${(opts.flights || []).length || opts.plan.cities.length}段机票`,
  ];
  const detail = markdownToHtml(opts.summary || "");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · Sparo 行程手册</title>
<style>${reportCss()}</style>
</head>
<body>
  <article class="page">
    <header class="ticket">
      <p class="eyebrow">SPARO 行程手册</p>
      <h1>${escapeHtml(title)}</h1>
      <ul class="chips">${chips.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
      <p class="dates">每天先写清怎么选、大概多少钱，再给你可点的入口。</p>
    </header>
    <div class="body">
      ${itineraryHtml(opts.plan, opts.flights || [], opts.hotels || [])}
      ${detail ? `<details class="more"><summary>航班时刻、粗算和说明</summary><div class="more-body">${detail}</div></details>` : ""}
    </div>
    <p class="foot">价格是打开结果页时看到的「起」价，下单前再核一次。每城先给 3 家不同理由的店，不够再点列表。</p>
  </article>
</body>
</html>`;
}

export function readingReportHtml(opts: { title: string; body: string; eyebrow?: string }): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.title)}</title>
<style>${reportCss()}</style>
</head>
<body>
  <article class="page">
    <header class="ticket">
      <p class="eyebrow">${escapeHtml(opts.eyebrow || "SPARO 阅读页")}</p>
      <h1>${escapeHtml(opts.title)}</h1>
    </header>
    <div class="body">${markdownToHtml(opts.body)}</div>
  </article>
</body>
</html>`;
}

export function writeHtmlReport(
  configDir: string,
  fileStem: string,
  html: string,
  meta: { title: string; kind: ChatDoc["kind"] },
): ChatDoc {
  const dir = join(configDir, "reports");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${fileStem}.html`);
  writeFileSync(path, html, "utf8");
  return { title: meta.title, path, kind: meta.kind };
}
