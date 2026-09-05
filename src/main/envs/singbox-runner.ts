/**
 * sing-box process manager: one sing-box process per environment that has a
 * usable proxy node. Degrades gracefully when the binary is missing —
 * environment isolation + UA still work, only the proxy is skipped.
 *
 * The binary is looked up in a few places (bundled resources, PATH). When it
 * is not found, `start()` returns a "no-proxy" result and the env runs direct.
 */
import { ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { EnvConfig, ProxyNode } from "./types.js";
import {
  buildRuntimeConfig,
  hasUsableNode,
  parseSubscription,
} from "./singbox-config.js";

type Running = {
  envId: string;
  proc: ChildProcess;
  localPort: number;
  startedAt: string;
};

const running = new Map<string, Running>();

let binaryPath: string | null | undefined;

function resolveBinary(): string | null {
  if (binaryPath !== undefined) return binaryPath;
  const candidates = [
    join(process.resourcesPath ?? "", "sing-box", "sing-box.exe"),
    join(app.getAppPath(), "resources", "sing-box", "sing-box.exe"),
    join(process.cwd(), "resources", "sing-box", "sing-box.exe"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      binaryPath = p;
      return p;
    }
  }
  binaryPath = null;
  return null;
}

export function isProxyAvailable(): boolean {
  return resolveBinary() !== null;
}

function configDir(): string {
  return app.getPath("userData");
}

function runtimeConfigPath(envId: string): string {
  const dir = join(configDir(), "singbox");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${envId}.config.json`);
}

/** Load nodes for an env: from its subscription, or its manual node. */
export function nodesForEnv(env: EnvConfig): ProxyNode[] {
  if (env.proxy.source === "manual" && env.proxy.manualNode) {
    return [env.proxy.manualNode];
  }
  if (!env.proxy.subscriptionUrl) return [];
  try {
    // Subscriptions are fetched lazily by the UI and cached; here we only
    // parse what was already stored. The fetch itself lives in the UI layer.
    const cached = join(configDir(), "singbox", `${env.id}.subscription.json`);
    if (!existsSync(cached)) return [];
    return parseSubscription(JSON.parse(readFileSync(cached, "utf8")));
  } catch {
    return [];
  }
}

export type StartResult =
  | { ok: true; localPort: number; mode: "proxy" }
  | { ok: true; mode: "direct" }
  | { ok: false; message: string };

/** Start (or restart) sing-box for an env. No-op-into-direct when no binary or no node. */
export function start(env: EnvConfig): StartResult {
  stop(env.id);
  const nodes = nodesForEnv(env);
  if (!hasUsableNode(env.proxy, nodes)) {
    return { ok: true, mode: "direct" };
  }
  const bin = resolveBinary();
  if (!bin) {
    return { ok: true, mode: "direct" };
  }

  const cfg = buildRuntimeConfig({
    nodes,
    selectedTag: env.proxy.selectedTag ?? nodes[0]?.tag ?? "",
    localPort: env.proxy.localPort,
  });
  const cfgPath = runtimeConfigPath(env.id);
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");

  try {
    const proc = spawn(bin, ["run", "-c", cfgPath], {
      windowsHide: true,
      stdio: "ignore",
    });
    proc.on("exit", () => {
      running.delete(env.id);
    });
    running.set(env.id, {
      envId: env.id,
      proc,
      localPort: env.proxy.localPort,
      startedAt: new Date().toISOString(),
    });
    return { ok: true, localPort: env.proxy.localPort, mode: "proxy" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function stop(envId: string): void {
  const r = running.get(envId);
  if (!r) return;
  try {
    r.proc.kill();
  } catch {
    /* ignore */
  }
  running.delete(envId);
}

export function stopAll(): void {
  for (const id of [...running.keys()]) stop(id);
}

export function isRunning(envId: string): boolean {
  return running.has(envId);
}
