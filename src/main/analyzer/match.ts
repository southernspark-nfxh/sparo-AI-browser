import { looksLikeDatetime } from "./datetime.js";

const ALIASES: Record<string, string[]> = {
  标题: ["标题", "title", "输入标题", "填写标题", "智能标题", "笔记标题"],
  正文: ["正文", "内容", "body", "content", "富文本", "文章", "说点什么", "rich_text"],
  话题: ["话题", "标签", "tag", "topic", "添加话题", "#"],
  简介: ["简介", "描述", "摘要", "推荐语", "summary", "caption", "说明"],
  封面: ["封面", "cover", "封面图", "上传封面"],
  图片: ["图片", "image", "photo", "上传图片", "媒体"],
  搜索: ["搜索", "search", "wd", "q", "query", "keyword", "关键词"],
  wd: ["wd", "搜索", "search", "q"],
  结束时间: ["结束时间", "end time", "end date", "endtime", "投放结束", "截止日期"],
  "end time": ["end time", "结束时间", "end date", "endtime"],
};

export function normalizeLabel(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[*＊：:\s]/g, "")
    .replace(/填写|输入|请|必填/g, "");
}

export function matchScore(
  payloadKey: string,
  fieldLabel: string,
  placeholder = "",
  name = "",
  primitive = "",
): number {
  const k = normalizeLabel(payloadKey);
  const lab = normalizeLabel(fieldLabel + " " + placeholder + " " + name);
  if (!k) return 0;
  if (lab === k || lab.includes(k) || (lab && k.includes(lab))) return 100;
  if (normalizeLabel(name) === k) return 100;
  const aliases = ALIASES[payloadKey] || ALIASES[k] || [];
  for (const a of aliases) {
    const na = normalizeLabel(a);
    if (lab.includes(na) || na.includes(lab) || normalizeLabel(name) === na) return 90;
  }
  for (const [cn, list] of Object.entries(ALIASES)) {
    if (list.some((x) => normalizeLabel(x) === k) && list.some((x) => lab.includes(normalizeLabel(x)))) {
      return 85;
    }
    if (normalizeLabel(cn) === k && list.some((x) => lab.includes(normalizeLabel(x)))) return 85;
  }
  // Primitive shortcuts: 正文 → rich_text, 搜索 → text_input named wd
  if ((k === "正文" || k === "body" || k === "content") && primitive === "rich_text") return 70;
  if ((k === "标题" || k === "title") && /title|标题/.test(lab + placeholder)) return 80;
  if ((k === "搜索" || k === "wd" || k === "q") && (primitive === "text_input" || primitive === "search")) {
    if (/search|搜索|wd|q/.test(lab + name)) return 75;
    return 45;
  }
  if (/endtime|enddate|结束时间|startdate|starttime|开始时间/.test(k + lab)) {
    if (primitive === "date_picker_button") return 95;
    if (primitive === "number_input" || primitive === "text_input") return 0;
  }
  if (primitive === "date_picker_button" && looksLikeDatetime(payloadKey)) return 90;
  if (k.length >= 2 && lab.includes(k.slice(0, 2))) return 40;
  return 0;
}

export function bestFieldMatch<
  T extends {
    label: string;
    placeholder?: string;
    name?: string;
    ref: string;
    primitive?: string;
  },
>(payloadKey: string, fields: T[]): { field: T; score: number } | null {
  let best: { field: T; score: number } | null = null;
  for (const f of fields) {
    const score = matchScore(
      payloadKey,
      f.label,
      f.placeholder || "",
      f.name || "",
      f.primitive || "",
    );
    if (score <= 0) continue;
    if (!best || score > best.score) best = { field: f, score };
  }
  return best && best.score >= 40 ? best : null;
}
