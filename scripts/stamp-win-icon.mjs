/**
 * Windows taskbar uses the .exe icon, not BrowserWindow.setIcon.
 * Dev (`npm run start`) runs node_modules/electron/dist/electron.exe.
 * Stamp our ICO onto a copy via a short ASCII temp path (rcedit breaks on CJK paths).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ico = join(root, "resources", "icon.ico");
const electronExe = join(root, "node_modules", "electron", "dist", "electron.exe");
const marker = join(root, "node_modules", "electron", "dist", ".sparo-icon-stamp");
const rcedit = join(root, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");

function stampNeeded() {
  if (!existsSync(ico) || !existsSync(electronExe) || !existsSync(rcedit)) return false;
  const key = `${statSync(ico).mtimeMs}:${statSync(electronExe).size}`;
  if (!existsSync(marker)) return true;
  try {
    return readFileSync(marker, "utf8").trim() !== key;
  } catch {
    return true;
  }
}

if (!stampNeeded()) process.exit(0);

const dir = join(tmpdir(), "sparo-icon-stamp");
mkdirSync(dir, { recursive: true });
const tmpExe = join(dir, "electron.exe");
const tmpIco = join(dir, "icon.ico");
const tmpRc = join(dir, "rcedit.exe");
copyFileSync(electronExe, tmpExe);
copyFileSync(ico, tmpIco);
copyFileSync(rcedit, tmpRc);

const r = spawnSync(tmpRc, [tmpExe, "--set-icon", tmpIco], {
  windowsHide: true,
  encoding: "utf8",
});
if (r.status !== 0) {
  // Locked while Electron is running — skip; next start after quit will stamp.
  process.exit(0);
}
try {
  copyFileSync(tmpExe, electronExe);
  writeFileSync(marker, `${statSync(ico).mtimeMs}:${statSync(electronExe).size}`, "utf8");
} catch {
  process.exit(0);
}
