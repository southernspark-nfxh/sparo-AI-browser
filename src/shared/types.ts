/** Shared types for Sparo */

export type ElementRef = string;

export interface SnapshotElement {
  ref: ElementRef;
  role: string;
  name: string;
  tag: string;
  type?: string;
  value?: string;
  placeholder?: string;
  href?: string;
  selector: string;
  /** Present when element lives in a same-origin iframe (e.g. iframe#cke_1) or CDP cross-origin frame (`cdp:<frameId>`) */
  frame?: string;
  /** True when collected via CDP from a cross-origin iframe */
  crossOrigin?: boolean;
  /** True when inside a dialog/modal container */
  inDialog?: boolean;
  /** True when inside Ant Design / Element portal dropdown */
  inPortal?: boolean;
  disabled?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface PageSnapshot {
  url: string;
  title: string;
  elements: SnapshotElement[];
  iframeCount?: number;
  /** Top-level iframe layout boxes (same-origin flag) for CDP merge */
  iframeMeta?: Array<{
    index: number;
    src: string;
    sameOrigin: boolean;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
  portalCount?: number;
  portalItems?: Array<{ ref: string; name: string }>;
  capturedAt: string;
}

export interface ToolResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

/** P0: navigate must confirm final URL/title */
export interface NavigateConfirm {
  ok: boolean;
  message: string;
  data: {
    requestedUrl: string;
    url: string;
    title: string;
    confirmed: true;
    loadMs: number;
  };
}

/** P0: fill must read back actual value */
export interface FillConfirm {
  ok: boolean;
  message: string;
  data: {
    target: string;
    expected: string;
    actual: string;
    matched: boolean;
    kind: "input" | "textarea" | "contenteditable" | "unknown";
  };
}

/** P0: click must report page change evidence */
export interface ClickConfirm {
  ok: boolean;
  message: string;
  data: {
    target: string;
    before: { url: string; title: string; bodyLen: number };
    after: { url: string; title: string; bodyLen: number };
    urlChanged: boolean;
    titleChanged: boolean;
    domChanged: boolean;
    changed: boolean;
  };
}
