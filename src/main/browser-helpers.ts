/**
 * Small pure helpers extracted from browser.ts (P1 partial God-class split).
 */
export function isMojibake(expected: string, actual: string): boolean {
  if (!expected || !actual) return false;
  if (/Ã.|Â.|ä½|æ.|ç.|è.|é./.test(actual) && !/Ã.|Â./.test(expected)) return true;
  return false;
}

/** Soft match for TipTap / React editors that normalize whitespace or drop some chars. */
export function softFillMatch(expected: string, actual: string): boolean {
  if (!actual) return false;
  if (isMojibake(expected, actual)) return false;
  if (actual === expected) return true;
  const a = actual.replace(/\s+/g, " ").trim();
  const e = expected.replace(/\s+/g, " ").trim();
  if (a === e) return true;
  if (
    e.length >= 8 &&
    (a.includes(e.slice(0, 24)) || e.includes(a.slice(0, Math.min(24, a.length))))
  ) {
    return a.length / Math.max(e.length, 1) >= 0.5;
  }
  return a.length / Math.max(e.length, 1) >= 0.85;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
