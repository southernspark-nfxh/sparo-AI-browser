/**
 * electron-builder signAndEditExecutable:false skips rcedit, so Sparo.exe
 * would keep Electron's default icon. Stamp resources/icon.ico after pack.
 * rcedit cannot open paths with CJK characters — copy to %TEMP% first.
 */
const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { spawnSync } = require("node:child_process");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exe = join(context.appOutDir, exeName);
  const ico = join(context.packager.projectDir, "resources", "icon.ico");
  const rcedit = join(
    context.packager.projectDir,
    "node_modules",
    "electron-winstaller",
    "vendor",
    "rcedit.exe",
  );
  if (!existsSync(exe) || !existsSync(ico) || !existsSync(rcedit)) {
    throw new Error(`afterPack icon stamp missing file: ${exe} / ${ico} / ${rcedit}`);
  }
  const dir = join(tmpdir(), "sparo-pack-icon");
  mkdirSync(dir, { recursive: true });
  const tmpExe = join(dir, "Sparo.exe");
  const tmpIco = join(dir, "icon.ico");
  const tmpRc = join(dir, "rcedit.exe");
  copyFileSync(exe, tmpExe);
  copyFileSync(ico, tmpIco);
  copyFileSync(rcedit, tmpRc);
  const r = spawnSync(
    tmpRc,
    [
      tmpExe,
      "--set-icon",
      tmpIco,
      "--set-version-string",
      "FileDescription",
      "Sparo",
      "--set-version-string",
      "ProductName",
      "Sparo",
      "--set-version-string",
      "InternalName",
      "Sparo",
      "--set-version-string",
      "OriginalFilename",
      "Sparo.exe",
    ],
    {
      windowsHide: true,
      encoding: "utf8",
    },
  );
  if (r.status !== 0) {
    throw new Error(`rcedit failed: ${r.stderr || r.stdout || r.status}`);
  }
  copyFileSync(tmpExe, exe);
  // 独立 ico 给桌面快捷方式用。只指向 Sparo.exe,0 时，
  // Windows 会继续显示旧的 48px 缓存，任务栏大图却已经是新的。
  copyFileSync(ico, join(context.appOutDir, "icon.ico"));
};
