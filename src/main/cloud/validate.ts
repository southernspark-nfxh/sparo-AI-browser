export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());
}

export type CloudErrorKind = "network" | "email" | "code" | "other";

export function describeCloudError(error: unknown): CloudErrorKind {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg === "EMAIL") return "email";
  if (msg === "CODE") return "code";
  if (
    msg === "NETWORK" ||
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed|Failed to fetch|network/i.test(msg)
  ) {
    return "network";
  }
  return "other";
}
