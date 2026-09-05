import { homedir } from "node:os";
import { join } from "node:path";

/** Store edition data root. Never `%APPDATA%/sparo` (that's the original build). */
export function storeConfigDir(): string {
  return (
    process.env.SPARO_CONFIG_DIR ||
    process.env.SPARK_CONFIG_DIR ||
    (process.platform === "win32" && process.env.APPDATA
      ? join(process.env.APPDATA, "sparo-store")
      : join(homedir(), ".config", "sparo-store"))
  );
}
