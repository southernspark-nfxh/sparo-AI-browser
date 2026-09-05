/**
 * Local chat / intent for the store edition.
 * Dianxiaomi / listing packs are compiled off (dxmEnabled() is always false).
 */
import { extractFirstHttpUrl, routeUserGoal } from "./intent-router.js";
import type { TravelQuery } from "./travel.js";
import type { TripPlan } from "./trip-plan.js";
import type { Mission } from "./mission.js";
import { FEISHU_MESSENGER_URL, type FeishuTask } from "./feishu.js";
import { dxmEnabled } from "../features.js";
import { tx } from "../../shared/i18n.js";

export interface AgentProvider {
  readonly name: string;
  chat(input: string, ctx: { url: string; title: string }): Promise<string>;
}

export type ChatAction =
  | { type: "reply"; text: string }
  | { type: "navigate"; url: string; after?: "dxm_arrived" | "dxm_crawl"; note?: string }
  | { type: "qa" }
  | { type: "pause"; paused: boolean }
  | { type: "run"; script: "dxm-translate" | "dxm-resize" }
  | { type: "workflow"; id: string }
  | { type: "dxm_guide"; mode: "help" | "edit" }
  | { type: "set_title"; title: string }
  | { type: "translate_title"; lang: "zh" | "en" }
  | { type: "list_skills" }
  | { type: "run_skill"; id?: string; query: string }
  | { type: "llm"; text: string }
  | { type: "one_click_reply" }
  | { type: "summarize" }
  | { type: "fill_form" }
  | { type: "print" }
  | { type: "act"; url?: string; text: string }
  | ({ type: "travel_search" } & TravelQuery)
  | { type: "trip_plan"; plan: TripPlan }
  | { type: "mission"; mission: Mission }
  | { type: "feishu"; task: FeishuTask };

const DXM_ENABLED = dxmEnabled();

function isGreeting(text: string): boolean {
  return /^(hello|hi|hey|yo|howdy|hola|你好|您好|哈喽|嗨)(?:\s*,?\s*sparo)?[\s!！.。?？,，~～]*$/i.test(
    text.trim(),
  );
}

export const DXM_HOME = "https://www.dianxiaomi.com/web/home";
export const DXM_CRAWL = "https://www.dianxiaomi.com/web/productCrawl";

export function parseLocalIntent(input: string, locale?: string): ChatAction {
  const t = input.trim();
  const lower = t.toLowerCase();

  if (!t || isGreeting(t)) {
    return { type: "reply", text: tx(locale, "chat.hello") };
  }

  if (
    /^[?？]+$/.test(t) ||
    /你是谁|你能干什么|你都能干什么|你会什么|这是什么产品|什么产品|who are you|what can you do|what do you do/i.test(
      t,
    )
  ) {
    return { type: "reply", text: tx(locale, "chat.who") };
  }

  if (/把当前页打印|打印这一页|打印出来|^打印$/i.test(t)) {
    return { type: "print" };
  }
  if (/暂停|接管|pause/i.test(t)) return { type: "pause", paused: true };
  if (/恢复\s*Agent|恢复操控|resume/i.test(t) || /^恢复$/i.test(t)) {
    return { type: "pause", paused: false };
  }

  const routed = routeUserGoal(t);
  if (routed) return routed;

  if (/我的妙招|妙招列表|列出妙招|list\s*skills?/i.test(t)) {
    return { type: "list_skills" };
  }

  const runNamed =
    t.match(/(?:运行|执行|打|用|按)\s*妙招\s*[「"']?(.+?)[」"']?\s*$/i) ||
    t.match(/run\s*skill\s+(.+)$/i);
  if (runNamed) {
    return {
      type: "run_skill",
      query: runNamed[1].trim().replace(/^["'「」]+|["'「」]+$/g, ""),
    };
  }
  // Fast path: Xiaohongshu publish intents → auto skill
  if (
    /发小红书|小红书发布|发布小红书|小红书长文|发一篇小红书|帮我发小红书|xhs\s*publish|publish\s*(on\s*)?(xhs|xiaohongshu|rednote)/i.test(
      t,
    )
  ) {
    return { type: "run_skill", query: "小红书发布", id: "xhs-longform-publish" };
  }

  // —— DXM vertical (hidden unless SPARO_ENABLE_DXM=1) ——
  if (DXM_ENABLED) {
    if (
      /上品|上架|完整上架|一句话上架|处理好|处理这个商品|上架准备|自动处理|帮我弄好|全自动|一键处理|autopilot/i.test(
        t,
      )
    ) {
      return { type: "workflow", id: "dxm_full_listing" };
    }
    if (
      /登录\s*店小[蜜秘]|店小[蜜秘].*登录|打开\s*店小[蜜秘]|店小[蜜秘]\s*(后台|首页)?/i.test(t) ||
      /^店小[蜜秘]$/i.test(t)
    ) {
      return { type: "navigate", url: DXM_HOME, after: "dxm_arrived" };
    }
    if (/采集箱|采集列表|打开采集/i.test(t)) {
      return { type: "navigate", url: DXM_CRAWL, after: "dxm_crawl" };
    }
    if (/改尺寸|改图片尺寸|批量改尺寸|resize/i.test(t)) {
      return { type: "workflow", id: "dxm_resize_800" };
    }
    if (/图片翻译|翻译图片/i.test(t)) {
      return { type: "workflow", id: "dxm_translate_zh_en" };
    }
    if (/^(qa|自审|检查|验收|检查当前页)(qa)?$/i.test(t)) {
      return { type: "workflow", id: "dxm_qa" };
    }
  } else if (
    /上品|上架|店小[蜜秘]|采集箱|图片翻译|处理好这个商品/i.test(t)
  ) {
    return {
      type: "reply",
      text: "这一版是应用商店职场浏览器，不做店小蜜/电商上架。打开网页后点总结、填表、回复或发布即可。",
    };
  }

  if (
    /开始录制|开始记录|启动录制|结束录制|停止录制|停止记录|录制结束|教你一遍|跟我学|教一遍|start\s*recording|stop\s*recording/i.test(
      t,
    )
  ) {
    return {
      type: "reply",
      text: "这一版不提供「教一遍」录制。直接说要办的事即可，例如总结、填表、回复或发布。",
    };
  }

  const open = t.match(/打开\s*(.+)$/i) || t.match(/前往\s*(.+)$/i) || t.match(/^go\s+(.+)/i);
  if (open) {
    let url = open[1].trim().replace(/[。.!！?？]+$/g, "");
    const fromLine = extractFirstHttpUrl(t);
    if (fromLine) url = fromLine;
    if (!/^https?:\/\//i.test(url) && !url.startsWith("about:")) {
      if (/^(百度|baidu)$/i.test(url) || lower.includes("baidu")) {
        url = "https://www.baidu.com";
      } else if (/知乎|zhihu/i.test(url)) {
        url = "https://www.zhihu.com";
      } else if (/小红书|xiaohongshu/i.test(url)) {
        url = "https://www.xiaohongshu.com";
      } else if (/飞书|feishu/i.test(url)) {
        url = FEISHU_MESSENGER_URL;
      } else if (/淘宝|taobao/i.test(url)) {
        url = "https://www.taobao.com";
      } else if (/天猫|tmall/i.test(url)) {
        url = "https://www.tmall.com";
      } else if (/京东|jd\.com|^jd$/i.test(url)) {
        url = "https://www.jd.com";
      } else if (/谷歌|google/i.test(url)) {
        url = "https://www.google.com";
      } else if (/github/i.test(url)) {
        url = "https://github.com";
      } else if (url.includes(".")) {
        url = `https://${url}`;
      } else {
        return { type: "llm", text: t };
      }
    }
    return { type: "navigate", url };
  }

  const onlyUrl = extractFirstHttpUrl(t);
  if (onlyUrl) {
    return { type: "navigate", url: onlyUrl };
  }
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(t)) {
    return { type: "navigate", url: `https://${t}` };
  }

  return { type: "llm", text: t };
}

export class StubAgentProvider implements AgentProvider {
  readonly name = "stub";
  async chat(input: string): Promise<string> {
    const action = parseLocalIntent(input);
    if (action.type === "reply") return action.text;
    if (action.type === "llm") {
      return tx(undefined, "llm.needKey");
    }
    return JSON.stringify(action);
  }
}
