import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function defaultLedgerPath(now = new Date()) {
  const stamp = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  return path.join(skillRoot, "ledger", stamp + ".jsonl");
}

export function appendLedger(file, row) {
  const target = file || defaultLedgerPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, JSON.stringify(row) + "\n", "utf8");
  return target;
}
