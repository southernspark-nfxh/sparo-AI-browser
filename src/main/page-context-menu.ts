/**
 * Page WebContents context menu — image save/copy + basic edit.
 */
import { writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { homedir } from "node:os";
import {
  Menu,
  clipboard,
  dialog,
  nativeImage,
  net,
  BrowserWindow,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

function guessExt(url: string, contentType?: string): string {
  const pathPart = url.split("?")[0] || "";
  const fromUrl = extname(pathPart).toLowerCase();
  if (fromUrl && fromUrl.length <= 5) return fromUrl;
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("gif")) return ".gif";
  if (contentType?.includes("svg")) return ".svg";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return ".jpg";
  return ".png";
}

function defaultName(url: string, ext: string): string {
  try {
    const u = new URL(url);
    const base = basename(u.pathname) || "image";
    if (extname(base)) return base.slice(0, 80);
    return `${base.slice(0, 60)}${ext}`;
  } catch {
    return `image${ext}`;
  }
}

async function fetchImageBuffer(
  wc: WebContents,
  url: string,
): Promise<{ buf: Buffer; contentType?: string }> {
  if (url.startsWith("data:")) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!m) throw new Error("invalid data URL");
    const contentType = m[1] || "image/png";
    const raw = m[3] || "";
    const buf = m[2]
      ? Buffer.from(raw, "base64")
      : Buffer.from(decodeURIComponent(raw), "utf8");
    return { buf, contentType };
  }

  if (url.startsWith("blob:")) {
    const b64 = (await wc.executeJavaScript(
      `(() => new Promise(async (resolve, reject) => {
        try {
          const r = await fetch(${JSON.stringify(url)});
          const blob = await r.blob();
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('FileReader failed'));
          reader.readAsDataURL(blob);
        } catch (e) { reject(e); }
      }))()`,
      true,
    )) as string;
    if (!b64?.startsWith("data:")) throw new Error("blob fetch failed");
    return fetchImageBuffer(wc, b64);
  }

  return await new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: "follow" });
    const chunks: Buffer[] = [];
    let contentType: string | undefined;
    request.on("response", (response) => {
      contentType = String(response.headers["content-type"] || "");
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({ buf: Buffer.concat(chunks), contentType }));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

async function saveImageAs(wc: WebContents, srcURL: string): Promise<void> {
  let buf: Buffer;
  let contentType: string | undefined;
  try {
    ({ buf, contentType } = await fetchImageBuffer(wc, srcURL));
  } catch (e) {
    // Fallback: Chromium download manager
    try {
      wc.session.downloadURL(srcURL);
      return;
    } catch {
      void dialog.showMessageBox({
        type: "error",
        title: "无法下载图片",
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }
  }
  const ext = guessExt(srcURL, contentType);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "图片另存为",
    defaultPath: join(homedir(), "Downloads", defaultName(srcURL, ext)),
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] },
      { name: "All", extensions: ["*"] },
    ],
  });
  if (canceled || !filePath) return;
  writeFileSync(filePath, buf);
}

async function copyImage(wc: WebContents, srcURL: string): Promise<void> {
  try {
    const { buf } = await fetchImageBuffer(wc, srcURL);
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) {
      clipboard.writeText(srcURL);
      return;
    }
    clipboard.writeImage(img);
  } catch {
    clipboard.writeText(srcURL);
  }
}

export function attachPageContextMenu(
  wc: WebContents,
  opts?: { openInNewTab?: (url: string) => void },
): void {
  wc.on("context-menu", (_event, params) => {
    const isImage =
      params.mediaType === "image" ||
      Boolean(params.hasImageContents) ||
      (Boolean(params.srcURL) &&
        /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?|$)/i.test(params.srcURL || ""));

    const template: MenuItemConstructorOptions[] = [];

    if (isImage && params.srcURL) {
      const src = params.srcURL;
      template.push(
        {
          label: "图片另存为…",
          click: () => {
            void saveImageAs(wc, src);
          },
        },
        {
          label: "复制图片",
          click: () => {
            void copyImage(wc, src);
          },
        },
        {
          label: "复制图片地址",
          click: () => clipboard.writeText(src),
        },
      );
      if (opts?.openInNewTab && (src.startsWith("http") || src.startsWith("data:"))) {
        template.push({
          label: "在新标签打开图片",
          click: () => opts.openInNewTab?.(src),
        });
      }
      template.push({ type: "separator" });
    }

    if (params.linkURL) {
      template.push(
        {
          label: "复制链接地址",
          click: () => clipboard.writeText(params.linkURL),
        },
        { type: "separator" },
      );
    }

    template.push(
      {
        label: "剪切",
        role: "cut",
        enabled: params.editFlags.canCut,
      },
      {
        label: "复制",
        role: "copy",
        enabled: params.editFlags.canCopy,
      },
      {
        label: "粘贴",
        role: "paste",
        enabled: params.editFlags.canPaste,
      },
      {
        label: "全选",
        role: "selectAll",
        enabled: params.editFlags.canSelectAll,
      },
    );

    const win = BrowserWindow.fromWebContents(wc);
    Menu.buildFromTemplate(template).popup(win ? { window: win } : undefined);
  });
}
