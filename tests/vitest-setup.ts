/**
 * 测试先于业务模块读到配置目录。
 * storeConfigDir() 每次调用都读 SPARO_CONFIG_DIR，所以必须在用例 import 之前写上。
 * 不改 task-summary.ts：写盘函数仍按传入目录工作，隔离发生在入口。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.SPARO_CONFIG_DIR) {
  process.env.SPARO_CONFIG_DIR = mkdtempSync(join(tmpdir(), "sparo-vitest-"));
}
