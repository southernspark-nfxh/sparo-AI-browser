/**
 * Builds the JS injected into each environment to override navigator/screen/webgl/timezone.
 *
 * This is the JS-layer fingerprint (not kernel-level). It defeats the coarse
 * checks used by e-commerce and social platforms, which is the stated scope.
 * A top-tier anti-fraud (banking/PayPal-high) can spot the defineProperty
 * traces — that requires a Chromium fork, explicitly out of scope.
 *
 * The shape mirrors 大方悦's reconstructed script, but every line here is
 * Sparo's own. Nothing third-party is shipped.
 */
import type { FingerprintConfig } from "./types.js";

/**
 * Produce the injection script. Kept as one string so it can be passed to
 * `webContents.executeJavaScript` or a preload on document-created.
 */
export function buildFingerprintScript(cfg: FingerprintConfig): string {
  // No UA = nothing to fake; the env is "custom" and the user left it blank.
  if (!cfg.userAgent) return "";

  const parts: string[] = [];
  parts.push(HEADER);
  parts.push(defineNavigator(cfg));
  parts.push(defineUserAgentData(cfg));
  parts.push(overrideTimezone(cfg.timezone));
  parts.push(overrideScreen(cfg));
  parts.push(overrideWebgl(cfg));
  if (cfg.canvasNoise) parts.push(canvasNoiseScript());
  if (cfg.audioNoise) parts.push(audioNoiseScript());
  parts.push(FOOTER);
  return parts.join("\n");
}

function defineNavigator(cfg: FingerprintConfig): string {
  return `(() => {
  const d = (t, k, v) => { try { Object.defineProperty(t, k, { get: () => v, configurable: true }); } catch {} };
  d(Navigator.prototype, "userAgent", ${str(cfg.userAgent)});
  d(Navigator.prototype, "platform", ${str(cfg.platform)});
  d(Navigator.prototype, "vendor", ${str(cfg.vendor)});
  d(Navigator.prototype, "language", ${str(cfg.language)});
  d(Navigator.prototype, "languages", ${arr(cfg.languages)});
  d(Navigator.prototype, "hardwareConcurrency", ${cfg.hardwareConcurrency});
  d(Navigator.prototype, "deviceMemory", ${cfg.deviceMemory});
  d(Navigator.prototype, "maxTouchPoints", ${cfg.maxTouchPoints});
})();`;
}

function defineUserAgentData(cfg: FingerprintConfig): string {
  const brands = cfg.secChUa || "";
  const platform = cfg.secChUaPlatform || '""';
  return `(() => {
  if (!navigator.userAgentData) return;
  const brands = ${brands};
  const platform = ${platform};
  const mobile = false;
  const uad = navigator.userAgentData;
  try {
    Object.defineProperty(uad, "brands", { get: () => brands, configurable: true });
    Object.defineProperty(uad, "mobile", { get: () => mobile, configurable: true });
    Object.defineProperty(uad, "platform", { get: () => platform, configurable: true });
    uad.getHighEntropyValues = () => Promise.resolve({
      architecture: "x86", bitness: "64", model: "", platformVersion: "10.0.0",
      uaFullVersion: ${str(cfg.userAgent.match(/(?:Chrome|Edg)\/(\d+)/)?.[1] ?? "")},
      brands, mobile, platform,
    });
    uad.toJSON = () => ({ brands, mobile, platform });
  } catch {}
})();`;
}

function overrideTimezone(tz: string): string {
  if (!tz) return "";
  return `(() => {
  try {
    const orig = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      const o = orig.call(this);
      o.timeZone = ${str(tz)};
      return o;
    };
  } catch {}
})();`;
}

function overrideScreen(cfg: FingerprintConfig): string {
  return `(() => {
  try {
    Object.defineProperty(screen, "width", { get: () => ${cfg.screenWidth}, configurable: true });
    Object.defineProperty(screen, "availWidth", { get: () => ${cfg.screenWidth}, configurable: true });
    Object.defineProperty(screen, "height", { get: () => ${cfg.screenHeight}, configurable: true });
    Object.defineProperty(screen, "availHeight", { get: () => ${cfg.screenHeight}, configurable: true });
    Object.defineProperty(window, "devicePixelRatio", { get: () => ${cfg.devicePixelRatio}, configurable: true });
  } catch {}
})();`;
}

function overrideWebgl(cfg: FingerprintConfig): string {
  // Templates encode the GPU in the renderer string; we don't forge it here,
  // we just make getParameter return the template's vendor/renderer pair.
  const [vendor, renderer] = webglPair(cfg);
  return `(() => {
  try {
    const old = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {
      if (p === 37445) return ${str(vendor)};
      if (p === 37446) return ${str(renderer)};
      return old.call(this, p);
    };
    if (window.WebGL2RenderingContext) {
      const old2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (p) {
        if (p === 37445) return ${str(vendor)};
        if (p === 37446) return ${str(renderer)};
        return old2.call(this, p);
      };
    }
  } catch {}
})();`;
}

function webglPair(cfg: FingerprintConfig): [string, string] {
  // Coarse GPU per template family. Good enough for e-commerce checks.
  if (cfg.template.includes("nvidia")) return ["Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)"];
  if (cfg.template.includes("intel")) return ["Google Inc. (Intel)", "ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0)"];
  if (cfg.template.includes("m1")) return ["Google Inc. (Apple)", "ANGLE (Apple, ANGLE Metal Renderer)"];
  return ["Google Inc.", "ANGLE (Unknown)"];
}

function canvasNoiseScript(): string {
  return `(() => {
  try {
    const orig = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function () {
      const r = orig.apply(this, arguments);
      if (!r || r.length < 24) return r;
      // Flip the first channel byte — invisible to the eye, changes the hash.
      return r.slice(0, 22) + String.fromCharCode(r.charCodeAt(22) ^ 1) + r.slice(23);
    };
  } catch {}
})();`;
}

function audioNoiseScript(): string {
  return `(() => {
  try {
    const orig = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function () {
      const data = orig.apply(this, arguments);
      for (let i = 0; i < data.length; i += 4096) data[i] = data[i] + 1e-7;
      return data;
    };
  } catch {}
})();`;
}

const HEADER = `(() => {`;
const FOOTER = `})();`;

function str(s: string): string {
  return JSON.stringify(s);
}
function arr(s: string): string {
  return JSON.stringify(s.split(","));
}
