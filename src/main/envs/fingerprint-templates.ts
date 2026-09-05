/**
 * Built-in fingerprint templates. Each one is a coherent persona — UA, screen,
 * GPU, timezone all line up so a site's coarse checks see a real-looking machine.
 *
 * These mirror 大方悦's template names so the field design is familiar, but the
 * values are reconstructed and owned by Sparo (no third-party data shipped).
 */
import type { FingerprintConfig, FingerprintTemplate } from "./types.js";

type Template = {
  label: string;
  config: Omit<FingerprintConfig, "canvasNoise" | "audioNoise">;
};

const TEMPLATES: Record<FingerprintTemplate, Template> = {
  "win11-edge-126-intel": {
    label: "Windows 11 · Edge 126 · Intel 核显",
    config: {
      template: "win11-edge-126-intel",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
      platform: "Win32",
      vendor: "Google Inc.",
      languages: "en-US,en",
      language: "en-US",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
      secChUa: '"Not A;Brand";v="99", "Chromium";v="126", "Microsoft Edge";v="126"',
      secChUaPlatform: '"Windows"',
      timezone: "America/Los_Angeles",
      screenWidth: 1920,
      screenHeight: 1080,
      devicePixelRatio: 1,
    },
  },
  "win11-edge-126-nvidia": {
    label: "Windows 11 · Edge 126 · NVIDIA",
    config: {
      template: "win11-edge-126-nvidia",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
      platform: "Win32",
      vendor: "Google Inc.",
      languages: "en-US,en",
      language: "en-US",
      hardwareConcurrency: 12,
      deviceMemory: 16,
      maxTouchPoints: 0,
      secChUa: '"Not A;Brand";v="99", "Chromium";v="126", "Microsoft Edge";v="126"',
      secChUaPlatform: '"Windows"',
      timezone: "America/New_York",
      screenWidth: 2560,
      screenHeight: 1440,
      devicePixelRatio: 1,
    },
  },
  "win11-chrome-131-intel": {
    label: "Windows 11 · Chrome 131 · Intel 核显",
    config: {
      template: "win11-chrome-131-intel",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      platform: "Win32",
      vendor: "Google Inc.",
      languages: "en-US,en",
      language: "en-US",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
      secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      secChUaPlatform: '"Windows"',
      timezone: "Europe/London",
      screenWidth: 1920,
      screenHeight: 1080,
      devicePixelRatio: 1,
    },
  },
  "macos-chrome-131-m1": {
    label: "macOS · Chrome 131 · M1",
    config: {
      template: "macos-chrome-131-m1",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      platform: "MacIntel",
      vendor: "Google Inc.",
      languages: "en-US,en",
      language: "en-US",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
      secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      secChUaPlatform: '"macOS"',
      timezone: "America/Los_Angeles",
      screenWidth: 2560,
      screenHeight: 1440,
      devicePixelRatio: 2,
    },
  },
  custom: {
    label: "自定义",
    config: {
      template: "custom",
      userAgent: "",
      platform: "Win32",
      vendor: "Google Inc.",
      languages: "en-US,en",
      language: "en-US",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
      secChUa: "",
      secChUaPlatform: '""',
      timezone: "America/Los_Angeles",
      screenWidth: 1920,
      screenHeight: 1080,
      devicePixelRatio: 1,
    },
  },
};

export function listTemplates(): { id: FingerprintTemplate; label: string }[] {
  return (Object.keys(TEMPLATES) as FingerprintTemplate[]).map((id) => ({
    id,
    label: TEMPLATES[id].label,
  }));
}

export function resolveTemplate(id: FingerprintTemplate): FingerprintConfig {
  const base = TEMPLATES[id] ?? TEMPLATES["win11-edge-126-intel"];
  return {
    ...base.config,
    template: id,
    canvasNoise: true,
    audioNoise: false,
  };
}

/** Apply a template, keeping any user-overridden fields. */
export function applyTemplate(
  current: FingerprintConfig,
  template: FingerprintTemplate,
): FingerprintConfig {
  const next = resolveTemplate(template);
  // Keep canvas/audio noise toggles the user set; keep custom UA if they typed one.
  return {
    ...next,
    canvasNoise: current.canvasNoise,
    audioNoise: current.audioNoise,
    userAgent:
      current.template === "custom" && current.userAgent
        ? current.userAgent
        : next.userAgent,
  };
}
