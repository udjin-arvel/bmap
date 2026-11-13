/**
 * In-browser stand-in for the Okapi backend, used in demo mode.
 * Mirrors the spec's endpoints, roles and edge validation rules so the
 * client behaves the same against either transport.
 */
import { ApiError } from "./errors";
import { wouldCreateCycle } from "./graph-utils";
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
import { PALETTE_HEX } from "./types";

export const DEMO_EDITOR_KEY = "bmap-editor";
export const DEMO_USERS = [
  { username: "viewer", password: "viewer" },
  { username: "analyst", password: "analyst" },
];

const DB_KEY = "bmap.demo.db";
const demoAiJobs = new Map<string, AiJobResult>();

function demoHasAiOutgoing(db: DemoDb, nodeId: string): boolean {
  for (const e of db.edges) {
    if (e.sourceId === nodeId) {
      const t = db.nodes.find((n) => n.id === e.targetId);
      if (t?.origin === "ai") return true;
    }
    if (e.targetId === nodeId) {
      const s = db.nodes.find((n) => n.id === e.sourceId);
      if (s?.origin === "ai") return true;
    }
  }
  return false;
}

function demoRemoveAiAround(db: DemoDb, anchorId: string) {
  const remove = new Set<string>();
  for (const n of db.nodes) {
    if (n.origin !== "ai") continue;
    if (db.edges.some((e) => e.sourceId === anchorId && e.targetId === n.id)) remove.add(n.id);
    if (db.edges.some((e) => e.targetId === anchorId && e.sourceId === n.id)) remove.add(n.id);
  }
  for (const id of remove) {
    db.nodes = db.nodes.filter((n) => n.id !== id);
    db.edges = db.edges.filter((e) => e.sourceId !== id && e.targetId !== id);
  }
}

interface DemoDb {
  nodes: MarketNode[];
  edges: MarketEdge[];
  users: { username: string; password: string; role: Role }[];
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function seed(): DemoDb {
  const now = new Date().toISOString();
  const B = "#4A90D9";
  const O = "#E67E22";
  const G = "#27AE60";
  const P = "#8E44AD";
  const S = "#7F8C8D";
  const raw: [string, MarketNode["nodeType"], string, number, number, string, (string | undefined)?, (string | undefined)?][] =
    [
      ["n1", "ACTOR", "Леспромхоз «Северный»", 0, 140, G, "Заготовка хвойных пород, 3 участка"],
      ["n2", "PROCESS", "Вальщик леса пилит деревья", 300, 140, B],
      ["n3", "RESOURCE", "Готовые деревья", 600, 140, O, "Хлысты 6–12 м"],
      ["n4", "LOGISTICS", "Вывоз леса на лесопилку", 900, 140, S],
      ["n5", "ACTOR", "Лесопилка", 1200, 140, G],
      ["n6", "PROCESS", "Распил на доски", 1500, 140, B],
      ["n7", "RESOURCE", "Пиломатериалы", 1800, 140, O, "Доска обрезная, брус"],
      ["n8", "LOGISTICS", "Доставка до завода дверей", 2100, 0, S],
      ["n9", "LOGISTICS", "Доставка до мебельного завода", 2100, 280, S],
      ["n10", "ACTOR", "Завод дверей", 2400, 0, G],
      [
        "n11",
        "ACTOR",
        "Мебельный завод",
        2400,
        280,
        G,
        undefined,
        "Ключевой покупатель — около 40% объёма",
      ],
      ["n12", "RESOURCE", "Межкомнатные двери", 2700, 0, P],
      ["n13", "RESOURCE", "Корпусная мебель", 2700, 280, P],
    ];
  const nodes: MarketNode[] = raw.map(([id, nodeType, name, x, y, color, description, note]) => ({
    id,
    nodeType,
    name,
    positionX: x,
    positionY: y,
    color,
    description: description ?? null,
    descriptionPinned: !!description,
    hasDescription: !!description,
    note: note ?? null,
    origin: "user" as const,
    isBase: false,
    createdAt: now,
    updatedAt: now,
  }));
  const pairs: [string, string][] = [
    ["n1", "n2"],
    ["n2", "n3"],
    ["n3", "n4"],
    ["n4", "n5"],
    ["n5", "n6"],
    ["n6", "n7"],
    ["n7", "n8"],
    ["n7", "n9"],
    ["n8", "n10"],
    ["n9", "n11"],
    ["n10", "n12"],
    ["n11", "n13"],
  ];
  const edges = pairs.map(([s, t], i) => ({
    id: `e${i + 1}`,
    sourceId: s,
    targetId: t,
    createdAt: now,
  }));
  return { nodes, edges, users: DEMO_USERS.map((u) => ({ ...u, role: "viewer" as Role })) };
}

function load(): DemoDb {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as DemoDb;
  } catch {
    /* fall through to seed */
  }
  const db = seed();
  save(db);
  return db;
}

function save(db: DemoDb) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function resetDemoDb() {
  localStorage.removeItem(DB_KEY);
}

const delay = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));

function userFromToken(token: string | null): AuthUser {
  if (!token?.startsWith("demo.")) throw new ApiError(401, "UNAUTHORIZED");
  const username = decodeURIComponent(atob(token.slice(5)));
  const u = load().users.find((x) => x.username === username);
  if (!u) throw new ApiError(401, "UNAUTHORIZED");
  return { username: u.username, role: u.role };
}

function requireEditor(token: string | null) {
  const u = userFromToken(token);
  if (u.role !== "editor") throw new ApiError(403, "FORBIDDEN");
}

function checkColor(color: string | null | undefined) {
  if (color != null && !PALETTE_HEX.includes(color))
    throw new ApiError(400, "INVALID_COLOR", "Цвет не из палитры");
}

function withMeta(n: MarketNode): MarketNode {
  const hasDescription = !!(n.description && String(n.description).trim());
  return {
    ...n,
    hasDescription,
    descriptionPinned: n.descriptionPinned ?? false,
    isBase: n.isBase ?? false,
    origin: n.origin ?? "user",
  };
}

function forList(n: MarketNode): MarketNode {
  const m = withMeta(n);
  return { ...m, description: m.descriptionPinned ? m.description : undefined };
}

function focusNodeIds(db: DemoDb, focusId: string): Set<string> {
  if (!db.nodes.some((n) => n.id === focusId)) throw new ApiError(404, "NODE_NOT_FOUND");
  const out = new Set<string>([focusId]);
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const e of db.edges) {
    const c = children.get(e.sourceId);
    if (c) c.push(e.targetId);
    else children.set(e.sourceId, [e.targetId]);
    const p = parents.get(e.targetId);
    if (p) p.push(e.sourceId);
    else parents.set(e.targetId, [e.sourceId]);
  }
  const down = [focusId];
  while (down.length) {
    const id = down.pop()!;
    for (const c of children.get(id) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        down.push(c);
      }
    }
  }
  const up = [focusId];
  while (up.length) {
    const id = up.pop()!;
    for (const p of parents.get(id) ?? []) {
      if (!out.has(p)) {
        out.add(p);
        up.push(p);
      }
    }
  }
  return out;
}

function applyPatch(db: DemoDb, id: string, patch: NodeUpdate): MarketNode {
  const node = db.nodes.find((n) => n.id === id);
  if (!node) throw new ApiError(404, "NODE_NOT_FOUND");
  checkColor(patch.color);
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (node as unknown as Record<string, unknown>)[k] = v;
  }
  node.updatedAt = new Date().toISOString();
  return node;
}

export const mockBackend = {
  async login(body: { username: string; password: string; editorKey?: string | undefined }) {
    const db = load();
    const u = db.users.find((x) => x.username === body.username && x.password === body.password);
    if (!u) {
      await delay(null);
      throw new ApiError(401, "UNAUTHORIZED", "Неверный логин или пароль");
    }
    if (body.editorKey && body.editorKey === DEMO_EDITOR_KEY) {
      u.role = "editor";
      save(db);
    }
    return delay({
      access_token: `demo.${btoa(encodeURIComponent(u.username))}`,
      role: u.role,
    });
  },

  async register(body: { username: string; password: string }) {
    const username = body.username.trim();
    if (!username) {
      await delay(null);
      throw new ApiError(422, "UNKNOWN", "Укажите логин");
    }
    const db = load();
    if (db.users.some((x) => x.username === username)) {
      await delay(null);
      throw new ApiError(409, "USERNAME_TAKEN", "Такой логин уже занят");
    }
    db.users.push({ username, password: body.password, role: "viewer" });
    save(db);
    return delay({
      access_token: `demo.${btoa(encodeURIComponent(username))}`,
      role: "viewer" as Role,
    });
  },

  async me(token: string | null) {
    return delay(userFromToken(token));
  },

  /** Public: the map is the same for everyone, anonymous visitors included. */
  async getGraph(focusId?: string): Promise<GraphSnapshot> {
    const db = load();
    let nodes = db.nodes;
    let edges = db.edges;
    if (focusId) {
      const allowed = focusNodeIds(db, focusId);
      nodes = nodes.filter((n) => allowed.has(n.id));
      edges = edges.filter((e) => allowed.has(e.sourceId) && allowed.has(e.targetId));
    }
    return delay({ nodes: nodes.map(forList), edges });
  },

  async getGraphRoots(): Promise<GraphRoot[]> {
    const db = load();
    const incoming = new Set(db.edges.map((e) => e.targetId));
    const roots = db.nodes.filter((n) => n.isBase || !incoming.has(n.id));
    return delay(
      roots
        .map((n) => ({
          id: n.id,
          name: n.name,
          isBase: !!n.isBase,
          childCount: db.edges.filter((e) => e.sourceId === n.id).length,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    );
  },

  async getNode(id: string): Promise<MarketNode> {
    const db = load();
    const node = db.nodes.find((n) => n.id === id);
    if (!node) throw new ApiError(404, "NODE_NOT_FOUND");
    return delay(withMeta(node));
  },

  async createNode(token: string | null, body: NodeCreate): Promise<MarketNode> {
    requireEditor(token);
    checkColor(body.color);
    const db = load();
    const now = new Date().toISOString();
    const id = body.id && !db.nodes.some((n) => n.id === body.id) ? body.id : uid();
    const node: MarketNode = {
      description: null,
      note: null,
      color: null,
      descriptionPinned: false,
      hasDescription: false,
      isBase: false,
      origin: "user",
      ...body,
      id,
      createdAt: now,
      updatedAt: now,
    };
    db.nodes.push(node);
    save(db);
    return delay(withMeta(node));
  },

  async patchNode(token: string | null, id: string, patch: NodeUpdate): Promise<MarketNode> {
    requireEditor(token);
    const db = load();
    const node = applyPatch(db, id, patch);
    if (patch.description !== undefined || patch.descriptionPinned !== undefined) {
      node.hasDescription = !!(node.description && String(node.description).trim());
    }
    save(db);
    return delay(withMeta(node));
  },

  async deleteNode(token: string | null, id: string) {
    requireEditor(token);
    const db = load();
    if (!db.nodes.some((n) => n.id === id)) throw new ApiError(404, "NODE_NOT_FOUND");
    db.nodes = db.nodes.filter((n) => n.id !== id);
    db.edges = db.edges.filter((e) => e.sourceId !== id && e.targetId !== id);
    save(db);
    return delay(null);
  },

  /** Synchronous so it can run inside pagehide, like sendBeacon. */
  batchPatchSync(token: string | null, items: BatchPatchItem[]) {
    requireEditor(token);
    const db = load();
    for (const { id, ...patch } of items) {
      if (db.nodes.some((n) => n.id === id)) applyPatch(db, id, patch);
    }
    save(db);
  },

  async createEdge(token: string | null, body: EdgeCreate): Promise<MarketEdge> {
    requireEditor(token);
    const db = load();
    const { sourceId, targetId } = body;
    if (sourceId === targetId)
      throw new ApiError(400, "SELF_CONNECTION", "Нельзя соединить узел с самим собой");
    if (!db.nodes.some((n) => n.id === sourceId) || !db.nodes.some((n) => n.id === targetId))
      throw new ApiError(404, "NODE_NOT_FOUND");
    if (db.edges.some((e) => e.sourceId === sourceId && e.targetId === targetId))
      throw new ApiError(400, "DUPLICATE_EDGE");
    if (wouldCreateCycle(db.edges, sourceId, targetId)) throw new ApiError(400, "CYCLE_DETECTED");
    const edge: MarketEdge = { id: uid(), sourceId, targetId, createdAt: new Date().toISOString() };
    db.edges.push(edge);
    save(db);
    return delay(edge);
  },

  async deleteEdge(token: string | null, id: string) {
    requireEditor(token);
    const db = load();
    if (!db.edges.some((e) => e.id === id)) throw new ApiError(404, "NODE_NOT_FOUND");
    db.edges = db.edges.filter((e) => e.id !== id);
    save(db);
    return delay(null);
  },

  async getAiOutgoing(nodeId: string) {
    const db = load();
    return delay({ hasAiOutgoing: demoHasAiOutgoing(db, nodeId) });
  },

  async expandNode(token: string | null, nodeId: string, force = false) {
    requireEditor(token);
    const db = load();
    const anchor = db.nodes.find((n) => n.id === nodeId);
    if (!anchor) throw new ApiError(404, "NODE_NOT_FOUND");
    if (!force && demoHasAiOutgoing(db, nodeId)) {
      throw new ApiError(409, "AI_CHAIN_EXISTS", "У узла уже есть AI-продолжение — подтвердите замену");
    }
    if (force) demoRemoveAiAround(db, nodeId);

    const now = new Date().toISOString();
    const jobId = uid();
    const mk = (name: string, type: MarketNode["nodeType"], x: number, y: number): MarketNode => ({
      id: uid(),
      name,
      nodeType: type,
      positionX: x,
      positionY: y,
      color: "#7F8C8D",
      description: "Сгенерировано в demo-режиме",
      descriptionPinned: false,
      hasDescription: true,
      origin: "ai",
      isBase: false,
      note: null,
      createdAt: now,
      updatedAt: now,
    });

    const left = mk("Подготовка сырья (demo AI)", "PROCESS", anchor.positionX - 560, anchor.positionY);
    const mid = mk("Логистика до точки (demo AI)", "LOGISTICS", anchor.positionX - 280, anchor.positionY);
    const right = mk("Доставка потребителю (demo AI)", "LOGISTICS", anchor.positionX + 280, anchor.positionY);
    const end = mk("Розничная точка (demo AI)", "ACTOR", anchor.positionX + 560, anchor.positionY);

    const edges: MarketEdge[] = [
      { id: uid(), sourceId: left.id, targetId: mid.id, createdAt: now },
      { id: uid(), sourceId: mid.id, targetId: anchor.id, createdAt: now },
      { id: uid(), sourceId: anchor.id, targetId: right.id, createdAt: now },
      { id: uid(), sourceId: right.id, targetId: end.id, createdAt: now },
    ];
    const nodes = [left, mid, right, end];
    db.nodes.push(...nodes);
    db.edges.push(...edges);
    save(db);

    const job: AiJobResult = {
      jobId,
      nodeId,
      status: "completed",
      nodes: nodes.map(forList),
      edges,
    };
    demoAiJobs.set(jobId, job);
    return delay({ jobId });
  },

  async getAiJob(token: string | null, jobId: string): Promise<AiJobResult> {
    requireEditor(token);
    const job = demoAiJobs.get(jobId);
    if (!job) throw new ApiError(404, "NODE_NOT_FOUND", "Задача не найдена");
    return delay(job);
  },
};
