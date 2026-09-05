import { describe, expect, it } from "vitest";
import {
  allocatePort,
  cloneEnv,
  createEnv,
  deleteEnv,
  getEnv,
  listEnvs,
  saveEnv,
  updateEnv,
} from "../src/main/envs/store.js";
import {
  applyTemplate,
  listTemplates,
  resolveTemplate,
} from "../src/main/envs/fingerprint-templates.js";
import { buildFingerprintScript } from "../src/main/envs/fingerprint-script.js";
import {
  buildRuntimeConfig,
  hasUsableNode,
  parseSubscription,
} from "../src/main/envs/singbox-config.js";
import type { ProxyConfig } from "../src/main/envs/types.js";

const tmp = () => {
  const os = require("node:os");
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-env-"));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

describe("env store", () => {
  it("creates, lists, updates, clones, and deletes", () => {
    const { dir, cleanup } = tmp();
    try {
      const a = createEnv(dir, { account: { type: "amazon", name: "A店" } });
      const b = createEnv(dir, { account: { type: "ebay", name: "B店" } });
      expect(a.id).not.toBe(b.id);
      expect(listEnvs(dir).map((e) => e.account.name)).toEqual(["A店", "B店"]);

      const updated = updateEnv(dir, a.id, { account: { ...a.account, note: "主店" } });
      expect(updated?.account.note).toBe("主店");
      expect(getEnv(dir, a.id)?.account.note).toBe("主店");

      const c = cloneEnv(dir, a.id, "A店副本");
      expect(c?.id).not.toBe(a.id);
      expect(c?.account.name).toBe("A店副本");
      expect(c?.proxy.localPort).not.toBe(a.proxy.localPort);

      expect(deleteEnv(dir, a.id)).toBe(true);
      expect(getEnv(dir, a.id)).toBeNull();
      expect(listEnvs(dir).map((e) => e.id)).not.toContain(a.id);
    } finally {
      cleanup();
    }
  });

  it("allocates non-overlapping ports", () => {
    const { dir, cleanup } = tmp();
    try {
      const a = createEnv(dir, { account: { type: "amazon", name: "a" } });
      const b = createEnv(dir, { account: { type: "amazon", name: "b" } });
      expect(a.proxy.localPort).not.toBe(b.proxy.localPort);
      expect(allocatePort(dir)).not.toBe(a.proxy.localPort);
      expect(allocatePort(dir)).not.toBe(b.proxy.localPort);
    } finally {
      cleanup();
    }
  });

  it("survives a broken env file by skipping it", () => {
    const { dir, cleanup } = tmp();
    try {
      const fs = require("node:fs");
      const path = require("node:path");
      const a = createEnv(dir, { account: { type: "amazon", name: "a" } });
      fs.writeFileSync(path.join(dir, "envs", a.id, "env.json"), "{not json");
      expect(listEnvs(dir)).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

describe("fingerprint templates", () => {
  it("resolves a known template to a coherent fingerprint", () => {
    const fp = resolveTemplate("win11-edge-126-nvidia");
    expect(fp.userAgent).toContain("Edg/126");
    expect(fp.secChUa).toContain("Microsoft Edge");
    expect(fp.timezone).toMatch(/America\//);
  });

  it("lists all templates including custom", () => {
    const ids = listTemplates().map((t) => t.id);
    expect(ids).toContain("custom");
    expect(ids).toContain("win11-edge-126-intel");
  });

  it("applyTemplate keeps user toggles and custom UA", () => {
    const base = resolveTemplate("win11-edge-126-intel");
    const custom = { ...base, template: "custom", userAgent: "MyUA", canvasNoise: false, audioNoise: true };
    const applied = applyTemplate(custom, "win11-edge-126-intel");
    expect(applied.canvasNoise).toBe(false);
    expect(applied.audioNoise).toBe(true);
    expect(applied.userAgent).toBe("MyUA");
  });
});

describe("buildFingerprintScript", () => {
  it("is empty when UA is blank (custom, untouched)", () => {
    const fp = resolveTemplate("custom");
    expect(buildFingerprintScript(fp)).toBe("");
  });

  it("overrides navigator, userAgentData, screen, webgl, timezone", () => {
    const fp = resolveTemplate("win11-edge-126-intel");
    const script = buildFingerprintScript(fp);
    expect(script).toContain("Navigator.prototype");
    expect(script).toContain("userAgentData");
    expect(script).toContain("timeZone");
    expect(script).toContain("screen");
    expect(script).toContain("37445");
    expect(script).toContain("37446");
  });

  it("includes canvas noise only when enabled", () => {
    const quiet = { ...resolveTemplate("win11-edge-126-intel"), canvasNoise: false, audioNoise: false };
    const noisy = { ...resolveTemplate("win11-edge-126-intel"), canvasNoise: true, audioNoise: true };
    expect(buildFingerprintScript(quiet)).not.toContain("toDataURL");
    expect(buildFingerprintScript(noisy)).toContain("toDataURL");
    expect(buildFingerprintScript(noisy)).toContain("getChannelData");
  });
});

describe("singbox config", () => {
  const sampleSubscription = {
    proxies: [
      { name: "HK-01", type: "ss", server: "1.2.3.4", port: 8388, method: "aes-256-gcm", password: "p" },
      { name: "JP-01", type: "trojan", server: "5.6.7.8", port: 443, password: "t", sni: "x.com" },
    ],
  };

  it("parses a Clash subscription into a flat node list", () => {
    const nodes = parseSubscription(sampleSubscription);
    expect(nodes.map((n) => n.tag)).toEqual(["HK-01", "JP-01"]);
    expect(nodes[0].type).toBe("ss");
    expect(nodes[1].port).toBe(443);
  });

  it("keeps unknown raw fields through to the outbound", () => {
    const nodes = parseSubscription(sampleSubscription);
    const cfg = buildRuntimeConfig({ nodes, selectedTag: "JP-01", localPort: 4200 });
    const out = cfg.outbounds as Record<string, unknown>[];
    const jp = out.find((o) => o.tag === "JP-01") as Record<string, unknown>;
    expect(jp["method"]).toBeUndefined(); // method is ss-specific, kept via raw
    expect(jp["password"]).toBe("t"); // trojan password kept
    expect(jp["sni"]).toBe("x.com");
  });

  it("routes final to the selected node, falls back to direct when none", () => {
    const nodes = parseSubscription(sampleSubscription);
    const cfg = buildRuntimeConfig({ nodes, selectedTag: "HK-01", localPort: 4200 });
    expect((cfg.route as Record<string, unknown>).final).toBe("HK-01");
    const empty = buildRuntimeConfig({ nodes: [], selectedTag: "missing", localPort: 4200 });
    expect((empty.route as Record<string, unknown>).final).toBe("direct");
  });

  it("hasUsableNode is true for a manual or selected node", () => {
    const nodes = parseSubscription(sampleSubscription);
    const manual: ProxyConfig = {
      source: "manual",
      localPort: 4200,
      manualNode: nodes[0],
    };
    expect(hasUsableNode(manual, nodes)).toBe(true);
    const sub: ProxyConfig = { source: "subscription", localPort: 4200, selectedTag: "JP-01" };
    expect(hasUsableNode(sub, nodes)).toBe(true);
    const missing: ProxyConfig = { source: "subscription", localPort: 4200, selectedTag: "nope" };
    expect(hasUsableNode(missing, nodes)).toBe(false);
  });
});
