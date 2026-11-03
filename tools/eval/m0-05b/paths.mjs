import path from "node:path";
import { fileURLToPath } from "node:url";

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function manifestPath() {
  return path.join(repoRoot(), "docs", "sparo-agent-loop-devbook", "m0-05a", "manifest.json");
}

export function evalOutDir(...parts) {
  return path.join(repoRoot(), "docs", "sparo-agent-loop-devbook", "m0-05b", ...parts);
}
