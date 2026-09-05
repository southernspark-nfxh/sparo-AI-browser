/**
 * Date-picker / calendar helpers (X Ads End time and similar widgets).
 * DOM-free so vitest can cover month math and day-cell uniqueness.
 */

export const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

export const MONTH_ABBR = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

/** Labels that mean "this control opens a calendar", not a typed date field. */
export const DATE_PICKER_LABEL_RE =
  /end\s*time|start\s*time|run indefinitely|date picker|datepicker|选择日期|结束时间|开始时间|截止日期|投放结束|结束日期|calendar/i;

export type Ymd = { year: number; month: number; day: number };

export type ParsedDatetime = Ymd & {
  hours: number;
  minutes: number;
};

export function monthIndex(name: string): number | null {
  const s = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "");
  if (!s) return null;
  const full = MONTH_NAMES.indexOf(s as (typeof MONTH_NAMES)[number]);
  if (full >= 0) return full + 1;
  const abbr = MONTH_ABBR.indexOf(s.slice(0, 3) as (typeof MONTH_ABBR)[number]);
  if (abbr >= 0) return abbr + 1;
  const n = Number(s);
  if (n >= 1 && n <= 12) return n;
  return null;
}

export function monthName(month: number): string {
  return MONTH_NAMES[Math.min(12, Math.max(1, month)) - 1] || "";
}

export function parseMonthHeader(text: string): { year: number; month: number } | null {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const cn = raw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (cn) {
    return { year: Number(cn[1]), month: Number(cn[2]) };
  }
  const en = raw.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{4})\b/i,
  );
  if (en) {
    const month = monthIndex(en[1].replace(/sept/i, "sep"));
    if (month) return { year: Number(en[2]), month };
  }
  const enRev = raw.match(
    /\b(\d{4})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  );
  if (enRev) {
    const month = monthIndex(enRev[2]);
    if (month) return { year: Number(enRev[1]), month };
  }
  return null;
}

export function parseDateFromAccessibleName(text: string): Ymd | null {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const iso = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  }
  const cn = raw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (cn) {
    return { year: Number(cn[1]), month: Number(cn[2]), day: Number(cn[3]) };
  }
  const en = raw.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
  );
  if (en) {
    const month = monthIndex(en[1].replace(/sept/i, "sep"));
    if (month) return { year: Number(en[3]), month, day: Number(en[2]) };
  }
  const en2 = raw.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?,?\s+(\d{4})\b/i,
  );
  if (en2) {
    const month = monthIndex(en2[2]);
    if (month) return { year: Number(en2[3]), month, day: Number(en2[1]) };
  }
  return null;
}

export function looksLikeDatetime(value: unknown): boolean {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    return Boolean(o.date || o.year || o.day);
  }
  const s = String(value || "").trim();
  if (!s) return false;
  if (parseDatetimeValue(s)) return true;
  return false;
}

export function parseDatetimeValue(value: unknown): ParsedDatetime | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const base = parseDatetimeValue(o.date ?? o.value ?? "") ||
      (o.year && o.month && o.day
        ? {
            year: Number(o.year),
            month: Number(o.month),
            day: Number(o.day),
            hours: 0,
            minutes: 0,
          }
        : null);
    if (!base) return null;
    if (o.hours != null) base.hours = Number(o.hours);
    if (o.minutes != null) base.minutes = Number(o.minutes);
    if (o.hour != null) base.hours = Number(o.hour);
    if (o.minute != null) base.minutes = Number(o.minute);
    return base;
  }
  const raw = String(value || "").trim();
  if (!raw) return null;

  let hours = 0;
  let minutes = 0;
  const ampm = raw.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i);
  const h24 = raw.match(/\b(\d{1,2}):(\d{2})\b/);
  if (ampm) {
    hours = Number(ampm[1]) % 12;
    if (/pm/i.test(ampm[3])) hours += 12;
    minutes = Number(ampm[2]);
  } else if (h24) {
    hours = Number(h24[1]);
    minutes = Number(h24[2]);
  }

  const iso = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (iso) {
    if (iso[4] != null && !ampm) {
      hours = Number(iso[4]);
      minutes = Number(iso[5]);
    }
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
      hours,
      minutes,
    };
  }

  const named = parseDateFromAccessibleName(raw);
  if (named) return { ...named, hours, minutes };
  return null;
}

/** Positive = click Next month N times. Negative = Previous month. */
export function monthSteps(
  from: { year: number; month: number },
  to: { year: number; month: number },
): number {
  return (to.year - from.year) * 12 + (to.month - from.month);
}

export function twoDigit(n: number): string {
  return String(Math.max(0, Math.min(99, Math.round(n)))).padStart(2, "0");
}

export function looksLikeCalendarPortal(text: string, className = "", role = ""): boolean {
  const t = String(text || "").replace(/\s+/g, " ");
  const cls = String(className || "");
  const r = String(role || "").toLowerCase();
  if (r === "grid" || r === "dialog") {
    if (/time \(in 24h\)/i.test(t) || /\b(su|sun)\b/i.test(t) && /\b(mo|mon)\b/i.test(t)) return true;
  }
  if (/datepicker|date-picker|calendar|popover/i.test(cls)) return true;
  if (/time \(in 24h\)/i.test(t)) return true;
  if (/\bSu\b/.test(t) && /\bMo\b/.test(t) && /\bTu\b/.test(t)) return true;
  if (/\bSun\b/.test(t) && /\bMon\b/.test(t) && /20\d{2}/.test(t)) return true;
  return false;
}

export function looksLikeDatePickerButton(input: {
  tag?: string;
  role?: string;
  hasPopup?: string | null;
  label?: string;
  text?: string;
  className?: string;
}): boolean {
  const tag = String(input.tag || "").toLowerCase();
  const role = String(input.role || "").toLowerCase();
  const isTrigger =
    tag === "button" ||
    role === "button" ||
    Boolean(input.hasPopup) ||
    /picker|calendar/i.test(String(input.className || ""));
  if (!isTrigger) return false;
  const blob = `${input.label || ""} ${input.text || ""} ${input.className || ""}`;
  if (DATE_PICKER_LABEL_RE.test(blob)) return true;
  const text = String(input.text || "");
  if (/indefinitely/i.test(text)) return true;
  if (
    /date|time|日期|时间|日历/.test(String(input.label || "").toLowerCase()) &&
    (parseDateFromAccessibleName(text) || /20\d{2}/.test(text))
  ) {
    return !/budget|bid|amount|usd|\$/.test(blob);
  }
  return false;
}

export type CalendarDayHit = {
  inner: string;
  aria: string;
  disabled?: boolean;
  outsideMonth?: boolean;
};

/**
 * Pick the in-month cell for `wantDay` after the header already shows `header`.
 * Ghosted next/prev-month numbers (same innerText "3") are rejected.
 */
export function resolveCalendarDay(
  wantDay: number,
  hits: CalendarDayHit[],
  header: { year: number; month: number },
): { index: number } | { error: string } {
  const live: number[] = [];
  hits.forEach((h, i) => {
    if (h.disabled || h.outsideMonth) return;
    const named = parseDateFromAccessibleName(h.aria);
    if (named) {
      if (named.year === header.year && named.month === header.month && named.day === wantDay) {
        live.push(i);
      }
      return;
    }
    const n = Number(String(h.inner || "").replace(/^0+/, "") || "0");
    if (n === wantDay) live.push(i);
  });
  if (live.length === 1) return { index: live[0]! };
  if (live.length === 0) {
    return { error: `no in-month cell for day ${wantDay} in ${monthName(header.month)} ${header.year}` };
  }
  return { error: `ambiguous day ${wantDay} in calendar (${live.length} cells)` };
}

export function formatCommittedHint(dt: ParsedDatetime): string {
  const abbr = MONTH_ABBR[dt.month - 1] || "";
  const pretty = abbr ? abbr[0]!.toUpperCase() + abbr.slice(1) : String(dt.month);
  const h12 = dt.hours % 12 || 12;
  const ampm = dt.hours >= 12 ? "PM" : "AM";
  return `${pretty} ${dt.day}, ${dt.year}, ${h12}:${twoDigit(dt.minutes)} ${ampm}`;
}

export function datetimeCommitted(actual: string, dt: ParsedDatetime): boolean {
  const a = String(actual || "");
  if (/indefinitely/i.test(a) && !parseDateFromAccessibleName(a)) return false;
  const named = parseDateFromAccessibleName(a);
  if (named && named.year === dt.year && named.month === dt.month && named.day === dt.day) {
    return true;
  }
  const month = monthName(dt.month);
  const abbr = MONTH_ABBR[dt.month - 1] || "";
  const hasDay = new RegExp(`\\b${dt.day}\\b`).test(a);
  const hasYear = a.includes(String(dt.year));
  const hasMonth = new RegExp(month.slice(0, 3), "i").test(a) || a.includes(abbr);
  return hasDay && hasYear && hasMonth;
}
