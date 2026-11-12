// 平台规则表。只读 JSON，不连浏览器。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../platforms");

export function loadProfile(id) {
  const file = path.join(PLATFORM_DIR, id + ".json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function labels(list) {
  if (!list?.length) return "无";
  return list.map((item) => item.label).join("、");
}

function limitText(limits) {
  return Object.entries(limits || {})
    .map(([key, value]) => key + "=" + (value === null || value === undefined || value === "" ? "未记录" : value))
    .join(" ");
}

export function formatPlan(profile) {
  return [
    profile.id + " " + profile.name,
    "封面: " + (profile.image?.coverMode || "未记录"),
    "必勾: " + labels(profile.switches?.required),
    "必不勾: " + labels(profile.switches?.forbidden),
    "默认: " + labels(profile.switches?.defaults),
    "限额: " + limitText(profile.limits),
    "定时: supported=" + String(!!profile.schedule?.supported) + " uiPath=" + (profile.schedule?.uiPath || "无") + (profile.schedule?.note ? " note=" + profile.schedule.note : ""),
  ].join("\n");
}

export function printPlans(ids) {
  for (const id of ids) console.log(formatPlan(loadProfile(id)));
}
