/**
 * 从文本/表格里找可画的数据列，输出内联 SVG 图表（不依赖外部库）。
 */

export type ChartSpec = {
  title: string;
  labels: string[];
  values: number[];
  kind: "bar" | "line" | "pie";
};

function numOf(s: string): number | null {
  const clean = String(s || "")
    .replace(/[,，\s¥$￥元%]/g, "")
    .replace(/^\((.+)\)$/, "-$1");
  if (!/^-?\d+(\.\d+)?$/.test(clean)) return null;
  return Number(clean);
}

/** 粗略表格解析：markdown 表格 / CSV / TSV / xlsx 导出的 "a | b" 行 */
export function parseRows(text: string): string[][] {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: string[][] = [];
  for (const line of lines) {
    if (/^\|?[\s:|-]+\|?$/.test(line) && line.includes("-")) continue;
    let cells: string[];
    if (line.includes("|")) {
      cells = line.replace(/^\||\|$/g, "").split("|");
    } else if (line.includes("\t")) {
      cells = line.split("\t");
    } else if ((line.match(/,/g) || []).length >= 1) {
      cells = line.split(",");
    } else {
      continue;
    }
    const clean = cells.map((c) => c.trim().replace(/^"|"$/g, ""));
    if (clean.length >= 2 && clean.some((c) => c)) rows.push(clean);
  }
  return rows;
}

export function pickSeries(rows: string[][], title = ""): ChartSpec | null {
  if (rows.length < 2) return null;
  const header = rows[0];
  const body = rows.slice(1).filter((r) => r.length >= 2);
  // 找数值列：先看表头下第一行
  const numericCols: number[] = [];
  for (let c = 1; c < header.length; c += 1) {
    const hits = body.filter((r) => numOf(r[c] ?? "") != null).length;
    if (hits >= Math.min(body.length, 2)) numericCols.push(c);
  }
  if (!numericCols.length) return null;
  const valueCol = numericCols[0];
  const labelCol = 0;
  const picked = body
    .filter((r) => numOf(r[valueCol] ?? "") != null)
    .slice(0, 12)
    .map((r) => ({
      label: (r[labelCol] || "").slice(0, 14) || `#${r[0]}`,
      value: numOf(r[valueCol] ?? "") as number,
    }));
  if (picked.length < 2) return null;
  return {
    title: title || header[valueCol] || "数据",
    labels: picked.map((p) => p.label),
    values: picked.map((p) => p.value),
    kind: "bar",
  };
}

const PALETTE = ["#b42318", "#3d3830", "#8a5a44", "#6b645a", "#c97b63", "#8f8a7e"];

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function chartSvg(spec: ChartSpec): string {
  const W = 860;
  const H = 460;
  const padL = 70;
  const padR = 30;
  const padT = 62;
  const padB = 80;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = niceMax(Math.max(...spec.values.map((v) => Math.abs(v)), 1));
  const title = String(spec.title || "").slice(0, 40);
  const axis = `<line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${
    padT + innerH
  }" stroke="#cfc7ba"/><line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" stroke="#cfc7ba"/>`;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = padT + innerH - innerH * f;
      const val = Math.round(max * f);
      return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eee8dc"/><text x="${
        padL - 10
      }" y="${y + 4}" text-anchor="end" font-size="11" fill="#8f8a7e">${val}</text>`;
    })
    .join("");

  if (spec.kind === "pie") {
    const total = spec.values.reduce((n, v) => n + Math.abs(v), 0) || 1;
    let angle = -Math.PI / 2;
    const cx = W / 2;
    const cy = padT + innerH / 2;
    const r = Math.min(innerW, innerH) / 2 - 10;
    const slices = spec.values
      .map((v, i) => {
        const a = (Math.abs(v) / total) * Math.PI * 2;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        angle += a;
        const x2 = cx + r * Math.cos(angle);
        const y2 = cy + r * Math.sin(angle);
        return `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${
          a > Math.PI ? 1 : 0
        },1 ${x2},${y2} Z" fill="${PALETTE[i % PALETTE.length]}" opacity="0.88"/>`;
      })
      .join("");
    const legend = spec.labels
      .map(
        (l, i) =>
          `<rect x="${padL}" y="${padT + i * 22}" width="11" height="11" fill="${
            PALETTE[i % PALETTE.length]
          }"/><text x="${padL + 18}" y="${padT + i * 22 + 10}" font-size="12" fill="#3d3830">${esc(
            l,
          )} ${Math.round((Math.abs(spec.values[i]) / total) * 100)}%</text>`,
      )
      .join("");
    return svgShell(W, H, title, `${grid}${slices}${legend}`);
  }

  const n = spec.values.length;
  const slot = innerW / n;
  if (spec.kind === "line") {
    const pts = spec.values.map((v, i) => {
      const x = padL + slot * (i + 0.5);
      const y = padT + innerH - (Math.abs(v) / max) * innerH;
      return { x, y, v };
    });
    const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
    const dots = pts
      .map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#b42318"/>`)
      .join("");
    const labels = spec.labels
      .map(
        (l, i) =>
          `<text x="${padL + slot * (i + 0.5)}" y="${padT + innerH + 22}" text-anchor="middle" font-size="11" fill="#3d3830">${esc(
            l,
          )}</text>`,
      )
      .join("");
    const values = pts
      .map(
        (p) =>
          `<text x="${p.x}" y="${p.y - 9}" text-anchor="middle" font-size="11" fill="#6b645a">${fmt(
            p.v,
          )}</text>`,
      )
      .join("");
    return svgShell(
      W,
      H,
      title,
      `${grid}${axis}<polyline points="${poly}" fill="none" stroke="#b42318" stroke-width="2.5"/>${dots}${labels}${values}`,
    );
  }

  const barW = Math.min(60, slot * 0.62);
  const bars = spec.values
    .map((v, i) => {
      const h = (Math.abs(v) / max) * innerH;
      const x = padL + slot * i + (slot - barW) / 2;
      const y = padT + innerH - h;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${
        PALETTE[i % PALETTE.length]
      }"/><text x="${x + barW / 2}" y="${y - 8}" text-anchor="middle" font-size="11" fill="#3d3830">${fmt(
        v,
      )}</text>`;
    })
    .join("");
  const labels = spec.labels
    .map(
      (l, i) =>
        `<text x="${padL + slot * i + slot / 2}" y="${
          padT + innerH + 22
        }" text-anchor="middle" font-size="11" fill="#3d3830">${esc(l)}</text>`,
    )
    .join("");
  return svgShell(W, H, title, `${grid}${axis}${bars}${labels}`);
}

function fmt(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function svgShell(w: number, h: number, title: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Microsoft YaHei, PingFang SC, sans-serif"><rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/><text x="${
    w / 2
  }" y="34" text-anchor="middle" font-size="19" font-weight="600" fill="#1a1f27">${esc(
    title,
  )}</text>${body}</svg>`;
}
