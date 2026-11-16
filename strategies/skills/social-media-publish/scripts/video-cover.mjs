// 从视频抽帧生成百家号封面（横版 16:9 / 竖版 3:4）
// 视频页最常见的驳回理由是「图片存在边框」——模糊边条、台标、字幕条都会被判成边框。
// 所以默认先切掉右侧台标区和底部字幕区，再从剩下的画面里居中裁 16:9 与 3:4，不留任何边条。
//
// 用法：
//   node video-cover.mjs --video <mp4> --at 118
//   node video-cover.mjs --video <mp4> --at 118 --out-dir <目录> --trim-right 0.25 --trim-bottom 0.18
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COVER_KINDS = { land: "land", landscape: "land", port: "portrait", portrait: "portrait" };
const COVER_FILES = { land: "cover_land.jpg", portrait: "cover_portrait.jpg" };

/** 封面文件名只认横版 / 竖版两种，port 和 portrait 都落到 cover_portrait.jpg。 */
export function coverOutputPath(dir, kind) {
  const key = COVER_KINDS[String(kind || "").trim()] || "land";
  return path.join(dir, COVER_FILES[key]);
}

function parse(argv) {
  const out = {
    video: "",
    at: 0,
    outDir: "",
    trimRight: 0.25,
    trimTop: 0,
    trimBottom: 0.16,
    land: "1280:720",
    port: "1080:1440",
    landY: 0.5,
    portX: 0.5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--video") out.video = argv[++i] || "";
    else if (a === "--at") out.at = Number(argv[++i] || 0);
    else if (a === "--out-dir") out.outDir = argv[++i] || "";
    else if (a === "--trim-right") out.trimRight = Number(argv[++i] || 0);
    else if (a === "--trim-top") out.trimTop = Number(argv[++i] || 0);
    else if (a === "--trim-bottom") out.trimBottom = Number(argv[++i] || 0);
    else if (a === "--land") out.land = argv[++i] || out.land;
    else if (a === "--port") out.port = argv[++i] || out.port;
    else if (a === "--land-y") out.landY = Number(argv[++i] || 0.5);
    else if (a === "--port-x") out.portX = Number(argv[++i] || 0.5);
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error("不认识的参数：" + a);
  }
  return out;
}

export function buildFilters({ trimRight, trimTop = 0, trimBottom, land, port, landY = 0.5, portX = 0.5 }) {
  const keepW = Math.max(0.1, 1 - trimRight);
  const keepH = Math.max(0.1, 1 - trimTop - trimBottom);
  const top = Math.max(0, trimTop);
  // 顶部字幕条也要能切（AFV 这类视频字幕在上方）
  const base = `crop=iw*${keepW}:ih*${keepH}:0:ih*${top}`;
  // 横版：在剩余画面里取最大的 16:9 区域；landY 控制纵向取景（0 顶 0.5 居中 1 贴底）
  const landBox = `crop=w='min(iw\\,ih*16/9)':h='min(ih\\,iw*9/16)':x='(iw-ow)/2':y='(ih-oh)*${landY}'`;
  // 竖版：取最大的 3:4 区域；portX 控制横向取景
  const portBox = `crop=w='min(ih*3/4\\,iw)':h='min(iw*4/3\\,ih)':x='(iw-ow)*${portX}':y='(ih-oh)/2'`;
  return {
    // 640×360 的源放大到 1280×720 会软，补一层 unsharp，能明显减少「图片模糊」提示
    land: `${base},${landBox},scale=${land}:flags=lanczos,unsharp=5:5:0.9:3:3:0.5`,
    port: `${base},${portBox},scale=${port}:flags=lanczos,unsharp=5:5:0.9:3:3:0.5`,
  };
}

export function generate({ video, at = 0, outDir, trimRight = 0.25, trimTop = 0, trimBottom = 0.16, land = "1280:720", port = "1080:1440", landY = 0.5, portX = 0.5 }) {
  if (!video || !fs.existsSync(video)) throw new Error("视频不存在：" + video);
  const dir = outDir || path.dirname(path.resolve(video));
  fs.mkdirSync(dir, { recursive: true });
  const filters = buildFilters({ trimRight, trimTop, trimBottom, land, port, landY, portX });
  const outputs = {};
  for (const [kind, vf] of Object.entries(filters)) {
    const file = coverOutputPath(dir, kind);
    const res = spawnSync(
      "ffmpeg",
      ["-y", "-v", "error", "-ss", String(at), "-i", video, "-frames:v", "1", "-vf", vf, "-q:v", "2", file],
      { encoding: "utf8" },
    );
    if (res.status !== 0) throw new Error("ffmpeg 抽帧失败（" + kind + "）：" + (res.stderr || "").trim());
    outputs[COVER_KINDS[kind]] = file;
  }
  return outputs;
}

const isCli = Boolean(process.argv[1]) && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isCli) {
  try {
    const args = parse(process.argv.slice(2));
    if (args.help || !args.video) {
      console.log("用法：node video-cover.mjs --video <mp4> --at <秒> [--out-dir <目录>] [--trim-right 0.25] [--trim-bottom 0.16]");
      process.exit(args.help ? 0 : 2);
    }
    const out = generate(args);
    console.log(JSON.stringify({ ok: true, ...out }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
