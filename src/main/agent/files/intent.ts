/**
 * 判断一句话是不是「本地文件任务」：消息里带了真实存在的文件路径 + 动作。
 */
import { detectFilePaths } from "./path-detect.js";

export type FileFormat = "summary" | "html" | "pdf" | "pptx" | "chart" | "form";

export type FileTaskPlan = {
  path: string;
  formats: FileFormat[];
  ask: string;
};

const FORMAT_RULES: Array<{ fmt: FileFormat; re: RegExp }> = [
  { fmt: "pptx", re: /pptx|ppt|幻灯片|演示文稿|演示稿|slides?/i },
  { fmt: "pdf", re: /pdf/i },
  { fmt: "chart", re: /图表|柱状图|折线图|饼图|可视化|chart|graph|统计图/i },
  { fmt: "html", re: /html|网页|报告页|页面/i },
  { fmt: "form", re: /填(表|写|进|入|到)|表单|填报|录入/ },
];

const ACTION_RE =
  /总结|摘要|提炼|提取|概括|归纳|整理|分析|解读|翻译|看看|读一下|读读|读这|内容|要点|生成|做成|转成|转换|导出|输出|填表|填写|填进|填到|录入|填报|pdf|ppt|html|图表|汇报|报告|大纲|纪要/i;

export function detectFileTask(text: string): FileTaskPlan | null {
  const src = String(text || "");
  if (!src.trim()) return null;
  const paths = detectFilePaths(src);
  if (!paths.length) return null;
  // 消息里没有任何动作词，就认为只是随口提到路径，不当文件任务
  if (!ACTION_RE.test(src)) return null;

  const formats: FileFormat[] = [];
  for (const rule of FORMAT_RULES) {
    if (rule.re.test(src)) formats.push(rule.fmt);
  }
  // 「填进当前网页表单」里的“网页”不是要生成 HTML；明确说 html/网页版/做成网页 才算
  if (
    formats.includes("form") &&
    !/html|网页版|报告页|做(个|成)?网页|生成网页/i.test(src)
  ) {
    const i = formats.indexOf("html");
    if (i >= 0) formats.splice(i, 1);
  }
  if (!formats.length) formats.push("summary");
  // 「提炼文字」与「出 PDF」同时说时，正文仍要有：summary 永远作为内容基础，不单独外露
  return { path: paths[0], formats, ask: src };
}

export function formatList(formats: FileFormat[]): string {
  const names: Record<FileFormat, string> = {
    summary: "文字提炼",
    html: "HTML",
    pdf: "PDF",
    pptx: "PPT",
    chart: "图表",
    form: "网页表单",
  };
  return formats.map((f) => names[f]).join("、");
}
