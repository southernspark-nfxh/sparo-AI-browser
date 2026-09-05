/**
 * sing-box runtime config builder.
 *
 * Two pure pieces:
 *   - parseSubscription: turn a Clash subscription JSON into a flat node list
 *   - buildRuntimeConfig: turn (nodes + selected tag + local port) into a
 *     sing-box config with one socks inbound and the selected node as the final route.
 *
 * Both are pure so they can be unit-tested without spawning sing-box.
 *
 * sing-box is not bundled today; the process manager degrades gracefully when
 * the binary is missing, so environment isolation + UA still work without a proxy.
 */

import type { ProxyConfig, ProxyNode } from "./types.js";

/**
 * Pull outbounds from a Clash subscription. Clash subscriptions
 * come in two shapes: a top-level `proxies` array, or `proxy-providers`
 * with inline nodes. We handle both, and keep the raw outbound so we
 * never lose fields sing-box needs that we don't model ourselves.
 */
export function parseSubscription(json: unknown): ProxyNode[] {
  const root = (json || {}) as Record<string, unknown>;
  const out: ProxyNode[] = [];

  const fromProxies = root["proxies"];
  if (Array.isArray(fromProxies)) {
    for (const p of fromProxies) {
      const node = toNode(p);
      if (node) out.push(node);
    }
  }

  const fromProviders = root["proxy-providers"];
  if (Array.isArray(fromProviders)) {
    for (const prov of fromProviders) {
      const nodes = (prov as Record<string, unknown>)["proxies"];
      if (Array.isArray(nodes)) {
        for (const p of nodes) {
          const node = toNode(p);
          if (node) out.push(node);
        }
      }
    }
  }

  // Dedupe by tag, first wins.
  const seen = new Set<string>();
  return out.filter((n) => {
    if (seen.has(n.tag)) return false;
    seen.add(n.tag);
    return true;
  });
}

function toNode(raw: unknown): ProxyNode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tag = typeof r["name"] === "string" ? r["name"] : "";
  const type = typeof r["type"] === "string" ? r["type"] : "";
  const server = typeof r["server"] === "string" ? r["server"] : "";
  const port = typeof r["port"] === "number" ? r["port"] : Number(r["port"]) || 0;
  if (!tag || !type || !server || !port) return null;
  return { tag, type, server, port, raw: r };
}

/**
 * Build the sing-box runtime config. The shape mirrors 大方悦's, which in
 * turn mirrors Clash's: one socks inbound, a route whose final hop is the
 * selected node, and an optional Clash API for latency tests / node switching.
 */
export function buildRuntimeConfig(input: {
  nodes: ProxyNode[];
  selectedTag: string;
  localPort: number;
  clashApiPort?: number;
}): Record<string, unknown> {
  const selected = input.nodes.find((n) => n.tag === input.selectedTag) ?? input.nodes[0];
  if (!selected) {
    return {
      log: { level: "warn" },
      inbounds: [
        {
          type: "socks",
          tag: "sparo-local-socks",
          listen: "127.0.0.1",
          listen_port: input.localPort,
        },
      ],
      outbounds: [{ type: "direct", tag: "direct" }],
      route: { final: "direct", default_domain_resolver: "sparo-local-dns" },
    };
  }

  return {
    log: { level: "warn" },
    inbounds: [
      {
        type: "socks",
        tag: "sparo-local-socks",
        listen: "127.0.0.1",
        listen_port: input.localPort,
      },
    ],
    outbounds: [toOutbound(selected), { type: "direct", tag: "direct" }],
    route: {
      final: selected.tag,
      default_domain_resolver: "sparo-local-dns",
    },
    ...(input.clashApiPort
      ? {
          experimental: {
            clash_api: { external_controller: `127.0.0.1:${input.clashApiPort}` },
          },
        }
      : {}),
  };
}

/** Turn a parsed node into a sing-box outbound, preserving its raw fields. */
function toOutbound(node: ProxyNode): Record<string, unknown> {
  return {
    type: node.type,
    tag: node.tag,
    server: node.server,
    server_port: node.port,
    ...stripRaw(node.raw),
  };
}

/** Drop the fields we model ourselves; pass everything else through. */
function stripRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const { name, type, server, port, ...rest } = raw;
  void name;
  void type;
  void server;
  void port;
  return rest;
}

/** True when the proxy config has a usable node to route through. */
export function hasUsableNode(proxy: ProxyConfig, nodes: ProxyNode[]): boolean {
  if (proxy.source === "manual" && proxy.manualNode) return true;
  return nodes.some((n) => n.tag === proxy.selectedTag);
}
