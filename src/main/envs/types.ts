/**
 * Multi-account environment types.
 *
 * An "environment" is one isolated account identity: its own Chromium partition
 * (cookies/localStorage/IndexedDB), its own fingerprint, and its own proxy.
 * Decoupled from the user profile — envs manage "which account", profile
 * manages "who the user is".
 */

export type AccountType =
  | "amazon"
  | "ebay"
  | "shopee"
  | "shopify"
  | "temu"
  | "tiktok"
  | "facebook"
  | "instagram"
  | "twitter"
  | "google"
  | "other";

export type EnvAccount = {
  type: AccountType;
  name: string;
  note?: string;
  homeUrl?: string;
};

export type FingerprintTemplate =
  | "win11-edge-126-intel"
  | "win11-edge-126-nvidia"
  | "win11-chrome-131-intel"
  | "macos-chrome-131-m1"
  | "custom";

export type FingerprintConfig = {
  template: FingerprintTemplate;
  userAgent: string;
  platform: string;
  vendor: string;
  languages: string;
  language: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
  secChUa: string;
  secChUaPlatform: string;
  timezone: string;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  canvasNoise: boolean;
  audioNoise: boolean;
};

export type ProxyNode = {
  tag: string;
  /** The sing-box outbound type, e.g. "ss", "vmess", "trojan", "vless", "socks". */
  type: string;
  server: string;
  port: number;
  /** Raw outbound object from the Clash subscription, kept verbatim so we never lose fields. */
  raw: Record<string, unknown>;
};

export type ProxyConfig = {
  source: "subscription" | "manual";
  subscriptionUrl?: string;
  /** Tag of the selected node in the subscription, or the manual node itself. */
  selectedTag?: string;
  manualNode?: ProxyNode;
  localPort: number;
};

export type EnvConfig = {
  id: string;
  createdAt: string;
  updatedAt: string;
  account: EnvAccount;
  fingerprint: FingerprintConfig;
  proxy: ProxyConfig;
  enabled: boolean;
};
