import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(resolve("scripts/installer.nsh"), "utf8");

describe("NSIS 覆盖安装", () => {
  it("关闭运行中的 Sparo 时不走高风险的 GetProcessInfo 进程枚举", () => {
    expect(script).toContain("!macro customCheckAppRunning");
    const macro = script.split("!macro customCheckAppRunning")[1].split("!macroend")[0];
    expect(macro).not.toContain("GetProcessInfo");
    expect(macro).toContain('!insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0');
    expect(macro).toContain('taskkill /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"');
    expect(macro).toContain('taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"');
  });
});
