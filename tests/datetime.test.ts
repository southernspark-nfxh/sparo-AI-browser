import { describe, expect, it } from "vitest";
import {
  datetimeCommitted,
  formatCommittedHint,
  looksLikeCalendarPortal,
  looksLikeDatePickerButton,
  looksLikeDatetime,
  monthSteps,
  parseDateFromAccessibleName,
  parseDatetimeValue,
  parseMonthHeader,
  resolveCalendarDay,
  twoDigit,
} from "../src/main/analyzer/datetime.js";

describe("parseDatetimeValue", () => {
  it("parses ISO, named date, and 12h clock", () => {
    expect(parseDatetimeValue("2026-09-03 00:59")).toEqual({
      year: 2026,
      month: 9,
      day: 3,
      hours: 0,
      minutes: 59,
    });
    expect(parseDatetimeValue("Sep 3, 2026, 12:59 AM PDT")).toMatchObject({
      year: 2026,
      month: 9,
      day: 3,
      hours: 0,
      minutes: 59,
    });
    expect(parseDatetimeValue({ date: "2026-09-03", hours: "00", minutes: "59" })?.minutes).toBe(59);
  });
});

describe("month navigation", () => {
  it("August 2026 → September is one Next click, never Previous", () => {
    expect(monthSteps({ year: 2026, month: 8 }, { year: 2026, month: 9 })).toBe(1);
    expect(monthSteps({ year: 2026, month: 10 }, { year: 2026, month: 9 })).toBe(-1);
  });

  it("reads calendar headers", () => {
    expect(parseMonthHeader("August 2026")).toEqual({ year: 2026, month: 8 });
    expect(parseMonthHeader("2026年9月")).toEqual({ year: 2026, month: 9 });
  });
});

describe("calendar day uniqueness", () => {
  it("ignores ghosted next-month 3 while header is still August", () => {
    const hits = [
      { inner: "3", aria: "August 3, 2026" },
      { inner: "3", aria: "September 3, 2026", outsideMonth: true },
    ];
    const hit = resolveCalendarDay(3, hits, { year: 2026, month: 8 });
    expect(hit).toEqual({ index: 0 });
  });

  it("picks September 3 after the header moved", () => {
    const hits = [
      { inner: "31", aria: "August 31, 2026", outsideMonth: true },
      { inner: "3", aria: "September 3, 2026" },
    ];
    expect(resolveCalendarDay(3, hits, { year: 2026, month: 9 })).toEqual({ index: 1 });
  });

  it("errors when two in-month cells match", () => {
    const r = resolveCalendarDay(3, [
      { inner: "3", aria: "September 3, 2026" },
      { inner: "3", aria: "September 3, 2026" },
    ], { year: 2026, month: 9 });
    expect("error" in r).toBe(true);
  });
});

describe("date picker classification", () => {
  it("treats End time / Run indefinitely as a picker button, not a textbox", () => {
    expect(
      looksLikeDatePickerButton({
        tag: "button",
        label: "End time",
        text: "Run indefinitely",
      }),
    ).toBe(true);
    expect(looksLikeDatetime("Sep 3, 2026, 12:59 AM PDT")).toBe(true);
  });

  it("detects X Ads calendar portal copy", () => {
    expect(
      looksLikeCalendarPortal(
        "August 2026 Su Mo Tu We Th Fr Sa 31 1 2 3 Time (in 24h) PDT",
        "DatePicker-popover",
        "dialog",
      ),
    ).toBe(true);
  });

  it("formats a committed End time hint", () => {
    const dt = parseDatetimeValue("2026-09-03 00:59")!;
    expect(formatCommittedHint(dt)).toContain("Sep 3, 2026");
    expect(twoDigit(0)).toBe("00");
    expect(datetimeCommitted("Run indefinitely", dt)).toBe(false);
    expect(datetimeCommitted("Sep 3, 2026, 12:59 AM PDT", dt)).toBe(true);
    expect(parseDateFromAccessibleName("Wednesday, September 3, 2026")).toEqual({
      year: 2026,
      month: 9,
      day: 3,
    });
  });
});
