/**
 * 飞书网页版：打开消息、找人、写入聊天/日志草稿。不代点发送。
 */
export const FEISHU_MESSENGER_URL = "https://www.feishu.cn/next/messenger";
export const FEISHU_REPORT_URL = "https://www.feishu.cn/report";

export type FeishuKind = "open" | "chat" | "journal" | "doc" | "calendar";

export type FeishuTask = {
  kind: FeishuKind;
  to?: string;
  title?: string;
  body?: string;
};

export function isFeishuHost(url: string): boolean {
  return /feishu\.cn|larksuite\.com/i.test(url);
}

export function isFeishuLoginUrl(url: string): boolean {
  return /accounts\.feishu|passport\.feishu|accounts\.larksuite|\/accounts\/|\/login/i.test(
    url,
  );
}

export function isFeishuMessengerUrl(url: string): boolean {
  return /\/next\/messenger|\/messenger/i.test(url);
}

export function isFeishuAsk(text: string): boolean {
  return /飞书|feishu|\blark\b/i.test(text);
}

export const FEISHU_DRIVE_URL = "https://www.feishu.cn/drive/home/";
export const FEISHU_CALENDAR_URL = "https://calendar.feishu.cn/";

export function feishuUrl(task: FeishuTask): string {
  if (task.kind === "journal") return FEISHU_REPORT_URL;
  if (task.kind === "doc") return FEISHU_DRIVE_URL;
  if (task.kind === "calendar") return FEISHU_CALENDAR_URL;
  return FEISHU_MESSENGER_URL;
}

export function alreadyOnFeishuTask(url: string, task: FeishuTask): boolean {
  if (isFeishuLoginUrl(url)) return false;
  if (task.kind === "journal") return /\/report/i.test(url);
  if (task.kind === "doc") return /\/docx|\/docs|\/drive|\/wiki/i.test(url);
  if (task.kind === "calendar") return /calendar\.feishu|\/calendar/i.test(url);
  return isFeishuMessengerUrl(url);
}

function cleanName(raw: string): string {
  return raw
    .replace(/^(给|跟|和|与|向)\s*/u, "")
    .replace(/\s*(发|说|聊|讲).*$/u, "")
    .replace(/[的地得了吧啊呢呀]/g, "")
    .trim()
    .slice(0, 32);
}

function extractTo(text: string): string | undefined {
  const m =
    text.match(/给\s*([^\s,，。：:发聊说]{1,24})\s*(?:发|说|聊)/) ||
    text.match(/发给\s*([^\s,，。：:]{1,24})/) ||
    text.match(/跟\s*([^\s,，。：:发聊说]{1,24})\s*(?:发|说|聊)/) ||
    text.match(/和\s*([^\s,，。：:发聊说]{1,24})\s*(?:发消息|聊天|说)/) ||
    text.match(/(?:联系人|同事|群)\s*[「"']?([^」"']{1,24})/) ||
    text.match(/搜(?:索)?\s*([^\s,，。：:]{1,24})/);
  if (!m) return undefined;
  const name = cleanName(m[1] || "");
  if (name.length < 1 || /飞书|消息|日志|日报|周报|网页/.test(name)) return undefined;
  return name;
}

function extractBody(text: string): string | undefined {
  const colon = text.match(/[：:]\s*([\s\S]{2,4000})\s*$/);
  if (colon) return colon[1].trim();
  const sent = text.match(
    /(?:发消息|发一句|发个|说|告诉(?:他|她|他们)?)\s*[：:]?\s*([\s\S]{2,4000})\s*$/,
  );
  if (sent && !/给.+发$/.test(sent[1])) return sent[1].trim();
  const journal = text.match(
    /(?:日志|日报|周报|汇报)\s*(?:内容)?[是为：:]?\s*([\s\S]{2,4000})\s*$/,
  );
  if (journal && journal[1].length >= 2 && !/^(内容|正文)?$/.test(journal[1])) {
    return journal[1].trim();
  }
  return undefined;
}

function extractTitle(text: string): string | undefined {
  const m = text.match(/(?:标题|题目)\s*[是为：:]\s*([^\n]{1,80})/);
  if (m) return m[1].trim();
  if (/周报/.test(text)) return "本周周报";
  if (/日报|日志/.test(text)) return "今日日报";
  return undefined;
}

/** 侧栏原句 → 飞书任务。不含飞书/lark 则 null。 */
export function parseFeishuTask(text: string): FeishuTask | null {
  const t = text.trim();
  if (!isFeishuAsk(t)) return null;

  const to = extractTo(t);
  const body = extractBody(t);
  const title = extractTitle(t);

  if (/日历|日程|开会提醒/.test(t) && !/给.+发|发消息/.test(t)) {
    return { kind: "calendar", to, title, body };
  }
  if (/云文档|知识库|(?:写|打开|新建).{0,8}文档/.test(t) && !/日报|周报|日志/.test(t)) {
    return { kind: "doc", to, title, body };
  }
  if (/日志|日报|周报|写汇报|工作汇报/.test(t)) {
    return { kind: "journal", to, title, body };
  }
  if (/发消息|发一句|聊天|会话|私聊|群里|给.+发|发给|跟.+说|和.+说|搜(?:索)?/.test(t)) {
    return { kind: "chat", to, body };
  }
  if (/打开|进入|网页版|messenger|消息/.test(t)) {
    return { kind: "open" };
  }
  return { kind: "open" };
}
