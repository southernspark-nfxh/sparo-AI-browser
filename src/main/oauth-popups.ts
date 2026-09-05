/**
 * Google / Apple / Microsoft sign-in open a sized popup and talk back via
 * window.opener. Opening them as a Sparo tab blanks the form.
 */
import type { BrowserWindowConstructorOptions } from "electron";

export function chromeUserAgent(): string {
  const chrome = process.versions.chrome || "134.0.0.0";
  if (process.platform === "darwin") {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
  }
  if (process.platform === "linux") {
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
  }
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

export function isOauthLoginUrl(url: string): boolean {
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "accounts.google.com" || host.endsWith(".accounts.google.com")) return true;
  if (host === "appleid.apple.com" || host === "idmsa.apple.com") return true;
  if (host.endsWith(".apple.com") && (host.includes("appleid") || host.includes("idmsa"))) {
    return true;
  }
  if (host === "login.microsoftonline.com" || host === "login.live.com") return true;
  if (
    (host === "facebook.com" || host === "www.facebook.com" || host === "m.facebook.com") &&
    /oauth|login|dialog/.test(path)
  ) {
    return true;
  }
  if (
    (host === "api.twitter.com" || host === "twitter.com" || host === "x.com" || host.endsWith(".x.com")) &&
    /oauth|i\/flow/.test(path)
  ) {
    return true;
  }
  return false;
}

function looksLikePopupFeatures(features?: string): boolean {
  const f = String(features || "");
  if (!f) return false;
  return /(?:^|,)\s*(width|height|popup)\s*=/i.test(f) || /\bpopup\b/i.test(f);
}

export function shouldAllowOauthPopup(details: {
  url?: string;
  features?: string;
  disposition?: string;
}): boolean {
  const url = String(details.url || "");
  if (isOauthLoginUrl(url)) return true;
  if (url === "about:blank" && looksLikePopupFeatures(details.features)) return true;
  if (details.disposition === "new-window" && looksLikePopupFeatures(details.features)) {
    return true;
  }
  return false;
}

export function oauthPopupWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 520,
    height: 740,
    minWidth: 360,
    minHeight: 480,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}
