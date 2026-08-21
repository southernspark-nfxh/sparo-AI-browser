/**
 * Local chat / intent — Agent-First general browser. No vertical niche.
 * Dianxiaomi / listing packs are disabled unless SPARO_ENABLE_DXM=1.
 */
export interface AgentProvider {
  readonly name: string;
  chat(input: string, ctx: { url: string; title: string }): Promise<string>;
}

export type ChatAction =
  | { type: "reply"; text: string }
  | { type: "navigate"; url: string; after?: "dxm_arrived" | "dxm_crawl" }
  | { type: "qa" }
  | { type: "pause"; paused: boolean }
  | { type: "run"; script: "dxm-translate" | "dxm-resize" }
  | { type: "workflow"; id: string }
  | { type: "dxm_guide"; mode: "help" | "edit" }
  | { type: "set_title"; title: string }
  | { type: "translate_title"; lang: "zh" | "en" }
  | { type: "record_start"; task?: string }
  | { type: "record_stop"; title?: string }
  | { type: "list_skills" }
  | { type: "run_skill"; id?: string; query: string }
  | { type: "llm"; text: string };

const DXM_ENABLED = process.env.SPARO_ENABLE_DXM === "1";

export const DXM_HOME = "https://www.dianxiaomi.com/web/home";
export const DXM_CRAWL = "https://www.dianxiaomi.com/web/productCrawl";

export function parseLocalIntent(input: string): ChatAction {
  const t = input.trim();
  const lower = t.toLowerCase();

  if (!t) {
    return {
      type: "reply",
      text: "Say a goal — e.g. open weibo.com, or connect your agent via MCP.",
    };
  }

  if (/^[?？]+$/.test(t) || /你是谁|你能干什么|这是什么|什么产品|who are you/i.test(t)) {
    return {
      type: "reply",
      text: "I'm Sparo Agent Browser — The browser built for AI agents — humans stay in control. / Sparo 人机同窗浏览器 — AI 驾驭网页，你驾驭 AI. We share this Chromium window. Say what you want done, or let OpenClaw / Hermes / Codex drive me over MCP.",
    };
  }

  if (/暂停|接管|pause/i.test(t)) return { type: "pause", paused: true };
  if (/恢复\s*Agent|恢复操控|resume/i.test(t) || /^恢复$/i.test(t)) {
    return { type: "pause", paused: false };
  }

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
      text: "This Sparo build is general automation only — vertical listing packs are off. Open a URL or connect your own agent via MCP.",
    };
  }

  const stopNamed =
    t.match(/(?:结束|停止)录制(?:并)?(?:保存)?(?:为|叫|成)\s*(.+)$/i) ||
    t.match(/(?:记住这次|保存(?:为|成)|存成)\s*(.+)$/i) ||
    t.match(/stop\s*recording(?:\s+as)?\s+(.+)$/i);
  if (stopNamed) {
    return {
      type: "record_stop",
      title: stopNamed[1].trim().replace(/^["'「」]+|["'「」]+$/g, ""),
    };
  }
  if (/结束录制|停止录制|停止记录|录制结束|stop\s*recording|记住这次/i.test(t)) {
    return { type: "record_stop" };
  }

  const startNamed =
    t.match(/(?:开始|启动)录制(?:\s*(?:任务|流程|妙招))?(?:为|叫|：|:)?\s*(.+)$/i) ||
    t.match(/start\s*recording(?:\s+as)?\s+(.+)$/i);
  if (startNamed) {
    return {
      type: "record_start",
      task: startNamed[1].trim().replace(/^["'「」]+|["'「」]+$/g, ""),
    };
  }
  if (/开始录制|开始记录|启动录制|教你一遍|跟我学|start\s*recording/i.test(t)) {
    return { type: "record_start" };
  }

  const open = t.match(/打开\s*(.+)$/i) || t.match(/前往\s*(.+)$/i) || t.match(/^go\s+(.+)/i);
  if (open) {
    let url = open[1].trim().replace(/[。.!！?？]+$/g, "");
    if (!/^https?:\/\//i.test(url) && !url.startsWith("about:")) {
      if (/^(百度|baidu)$/i.test(url) || lower.includes("baidu")) {
        url = "https://www.baidu.com";
      } else if (/微博|weibo/i.test(url)) {
        url = "https://weibo.com";
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

  if (/^https?:\/\//i.test(t) || /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(t)) {
    const url = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    return { type: "navigate", url };
  }

  return { type: "llm", text: t };
}

export class StubAgentProvider implements AgentProvider {
  readonly name = "stub";
  async chat(input: string): Promise<string> {
    const action = parseLocalIntent(input);
    if (action.type === "reply") return action.text;
    if (action.type === "llm") {
      return "Configure a model in the sidebar, or connect OpenClaw / Hermes / Codex via MCP.";
    }
    return JSON.stringify(action);
  }
}
