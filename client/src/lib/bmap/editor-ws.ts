import { DEMO_SERVER, getServer, getToken, isDemo } from "./api";
import type { GraphSnapshot, MarketEdge, MarketNode } from "./types";

export type AiWsMessage =
  | { type: "ai.status"; jobId: string; nodeId: string; status: "running" | "completed" | "error"; message?: string }
  | {
      type: "graph.patch";
      jobId: string;
      nodeId: string;
      nodes: MarketNode[];
      edges: MarketEdge[];
    };

function wsBase(): string {
  const base = getServer();
  if (base === DEMO_SERVER) return "";
  if (typeof window === "undefined") return "";
  if (base === "/" || base === "same-origin") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}`;
  }
  try {
    const u = new URL(base);
    const proto = u.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${u.host}`;
  } catch {
    return "";
  }
}

export function connectEditorWs(onMessage: (msg: AiWsMessage) => void): (() => void) | null {
  if (isDemo() || typeof WebSocket === "undefined") return null;
  const token = getToken();
  const host = wsBase();
  if (!token || !host) return null;

  const ws = new WebSocket(`${host}/api/ws?token=${encodeURIComponent(token)}`);

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as AiWsMessage;
      if (msg && typeof msg === "object" && "type" in msg) onMessage(msg);
    } catch {
      /* ignore malformed */
    }
  };

  return () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };
}

export type GraphPatch = Pick<GraphSnapshot, "nodes" | "edges">;
