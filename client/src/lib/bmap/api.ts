import { ApiError, parseApiError } from "./errors";
import { mockBackend } from "./mock-backend";
import type {
  AuthUser,
  BatchPatchItem,
  EdgeCreate,
  GraphRoot,
  GraphSnapshot,
  MarketEdge,
  MarketNode,
  NodeCreate,
  NodeUpdate,
  Role,
  AiJobResult,
} from "./types";

const TOKEN_KEY = "bmap.token";
const SERVER_KEY = "bmap.server";
export const DEMO_SERVER = "demo";

// ---------- config (browser-only; call from effects/handlers) ----------

export function getServer(): string {
  const stored = localStorage.getItem(SERVER_KEY);
  if (stored) return stored;
  const env = (import.meta.env["VITE_API_URL"] as string | undefined)?.trim();
  return env ? env : DEMO_SERVER;
}

export function setServer(value: string) {
  const v = value.trim().replace(/\/+$/, "");
  localStorage.setItem(SERVER_KEY, v || DEMO_SERVER);
}

export const isDemo = () => getServer() === DEMO_SERVER;

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

// ---------- HTTP transport ----------

function url(path: string) {
  const base = getServer();
  // "/" or "same-origin" means the API is served from the same host.
  const prefix = base === "/" || base === "same-origin" ? "" : base;
  return `${prefix}${path}`;
}

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(url(path), {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) throw parseApiError(res.status, data);
  return data as T;
}

// ---------- normalisation ----------

function normNode(n: MarketNode): MarketNode {
  return { ...n, positionX: Number(n.positionX) || 0, positionY: Number(n.positionY) || 0 };
}

type RawEdge = Partial<MarketEdge> & { source?: string; target?: string };
function normEdge(e: RawEdge): MarketEdge {
  return {
    id: String(e.id),
    sourceId: String(e.sourceId ?? e.source),
    targetId: String(e.targetId ?? e.target),
    createdAt: e.createdAt,
  };
}

// ---------- public API ----------

export const api = {
  async login(body: {
    username: string;
    password: string;
    editorKey?: string | undefined;
  }): Promise<{ access_token: string; role: Role }> {
    const payload = { ...body, editorKey: body.editorKey || undefined };
    if (isDemo()) return mockBackend.login(payload);
    return http("POST", "/api/auth/login", payload);
  },

  async register(body: {
    username: string;
    password: string;
  }): Promise<{ access_token: string; role: Role }> {
    if (isDemo()) return mockBackend.register(body);
    return http("POST", "/api/auth/register", body);
  },

  async me(): Promise<AuthUser> {
    if (isDemo()) return mockBackend.me(getToken());
    return http("GET", "/api/auth/me");
  },

  async getGraph(focusId?: string | null): Promise<GraphSnapshot> {
    const suffix = focusId ? `?focusId=${encodeURIComponent(focusId)}` : "";
    const raw = isDemo()
      ? await mockBackend.getGraph(focusId ?? undefined)
      : await http<{ nodes: MarketNode[]; edges: RawEdge[] }>("GET", `/api/graph${suffix}`);
    return {
      nodes: (raw.nodes ?? []).map(normNode),
      edges: ((raw.edges ?? []) as RawEdge[]).map(normEdge),
    };
  },

  async getGraphRoots(): Promise<GraphRoot[]> {
    if (isDemo()) return mockBackend.getGraphRoots();
    return http<GraphRoot[]>("GET", "/api/graph/roots");
  },

  async getNode(id: string): Promise<MarketNode> {
    const n = isDemo() ? await mockBackend.getNode(id) : await http<MarketNode>("GET", `/api/nodes/${encodeURIComponent(id)}`);
    return normNode(n);
  },

  async createNode(body: NodeCreate): Promise<MarketNode> {
    const n = isDemo()
      ? await mockBackend.createNode(getToken(), body)
      : await http<MarketNode>("POST", "/api/nodes", body);
    return normNode(n);
  },

  async patchNode(id: string, patch: NodeUpdate): Promise<void> {
    if (isDemo()) {
      await mockBackend.patchNode(getToken(), id, patch);
      return;
    }
    await http("PATCH", `/api/nodes/${encodeURIComponent(id)}`, patch);
  },

  async deleteNode(id: string): Promise<void> {
    if (isDemo()) {
      await mockBackend.deleteNode(getToken(), id);
      return;
    }
    await http("DELETE", `/api/nodes/${encodeURIComponent(id)}`);
  },

  async createEdge(body: EdgeCreate): Promise<MarketEdge> {
    const e = isDemo()
      ? await mockBackend.createEdge(getToken(), body)
      : await http<RawEdge>("POST", "/api/edges", body);
    return normEdge({ sourceId: body.sourceId, targetId: body.targetId, ...e });
  },

  async deleteEdge(id: string): Promise<void> {
    if (isDemo()) {
      await mockBackend.deleteEdge(getToken(), id);
      return;
    }
    await http("DELETE", `/api/edges/${encodeURIComponent(id)}`);
  },

  async getAiOutgoing(nodeId: string): Promise<{ hasAiOutgoing: boolean }> {
    if (isDemo()) return mockBackend.getAiOutgoing(nodeId);
    return http("GET", `/api/nodes/${encodeURIComponent(nodeId)}/ai-outgoing`);
  },

  async expandNode(nodeId: string, force = false): Promise<{ jobId: string }> {
    if (isDemo()) return mockBackend.expandNode(getToken(), nodeId, force);
    return http("POST", `/api/nodes/${encodeURIComponent(nodeId)}/expand`, { force });
  },

  async getAiJob(jobId: string): Promise<AiJobResult> {
    if (isDemo()) return mockBackend.getAiJob(getToken(), jobId);
    return http("GET", `/api/ai/jobs/${encodeURIComponent(jobId)}`);
  },

  /**
   * Fire-and-forget save on page hide. sendBeacon cannot set headers, so the
   * JWT is passed as `?token=`; the body is sent as text/plain to avoid a CORS
   * preflight (the backend accepts both content types per spec §3.4).
   */
  beaconBatchPatch(items: BatchPatchItem[]) {
    if (!items.length) return;
    const token = getToken();
    if (isDemo()) {
      try {
        mockBackend.batchPatchSync(token, items);
      } catch {
        /* nothing to do while the page unloads */
      }
      return;
    }
    const target = `${url("/api/nodes/batch-patch")}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const body = JSON.stringify(items);
    const sent =
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(target, new Blob([body], { type: "text/plain;charset=UTF-8" }));
    if (!sent) {
      void fetch(url("/api/nodes/batch-patch"), {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
      }).catch(() => {});
    }
  },
};
