import {
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { toast } from "sonner";
import { create } from "zustand";

import { api, getToken, setToken } from "./api";
import { ApiError, ERROR_MESSAGES, errorMessage } from "./errors";
import { diffSnapshots, remapSnapshot } from "./graph-utils";
import {
  emptyHistory,
  mapHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from "./history";
import { PendingSaver } from "./pending-saver";
import type {
  AuthUser,
  GraphRoot,
  GraphSnapshot,
  MarketEdge,
  MarketNode,
  NodeCreate,
  NodeUpdate,
} from "./types";
import { loadCollapsedIds, saveCollapsedIds } from "./visibility";

export type NodeData = Omit<MarketNode, "id" | "positionX" | "positionY"> & Record<string, unknown>;
export type MarketFlowNode = Node<NodeData, "market">;

// ---------- snapshot <-> React Flow ----------

export function toSnapshot(nodes: MarketFlowNode[], edges: Edge[]): GraphSnapshot {
  return {
    nodes: nodes.map((n) => ({
      ...(n.data as Omit<MarketNode, "id" | "positionX" | "positionY">),
      id: n.id,
      positionX: n.position.x,
      positionY: n.position.y,
    })),
    edges: edges.map((e) => ({ id: e.id, sourceId: e.source, targetId: e.target })),
  };
}

function toFlowNode(n: MarketNode, prev?: MarketFlowNode): MarketFlowNode {
  const { id, positionX, positionY, ...data } = n;
  return {
    ...(prev ?? {}),
    id,
    type: "market",
    position: { x: positionX, y: positionY },
    data: data as NodeData,
  };
}

const toFlowEdge = (e: MarketEdge, prev?: Edge): Edge => ({
  ...(prev ?? {}),
  id: e.id,
  source: e.sourceId,
  target: e.targetId,
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--edge)" },
});

function fromSnapshot(snap: GraphSnapshot, prevNodes: MarketFlowNode[], prevEdges: Edge[]) {
  const pn = new Map(prevNodes.map((n) => [n.id, n]));
  const pe = new Map(prevEdges.map((e) => [e.id, e]));
  return {
    nodes: snap.nodes.map((n) => toFlowNode(n, pn.get(n.id))),
    edges: snap.edges.map((e) => toFlowEdge(e, pe.get(e.id))),
  };
}

// ---------- store ----------

type LoadState = "idle" | "loading" | "ready" | "error";

interface EditorState {
  user: AuthUser | null;
  authChecked: boolean;
  load: LoadState;
  nodes: MarketFlowNode[];
  edges: Edge[];
  history: HistoryState;
  syncing: boolean;

  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  connectMode: boolean;
  connectSourceId: string | null;

  authOpen: boolean;
  createOpen: boolean;
  confirmDeleteId: string | null;

  graphFocusId: string | null;
  graphRoots: GraphRoot[];
  collapsedNodeIds: Set<string>;
  nodeDetailLoadingId: string | null;
  aiRunningNodeIds: Set<string>;
  confirmAiExpandId: string | null;

  set: (p: Partial<EditorState>) => void;
  bootstrap: () => Promise<void>;
  login: (u: string, p: string, key?: string | undefined) => Promise<void>;
  register: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  loadGraph: () => Promise<void>;
  loadGraphRoots: () => Promise<void>;
  setGraphFocus: (focusId: string | null) => Promise<void>;
  toggleNodeCollapsed: (nodeId: string) => void;
  ensureNodeDetail: (nodeId: string) => Promise<void>;
  expandNode: (nodeId: string, force?: boolean) => Promise<void>;
  applyGraphPatch: (anchorId: string, patch: { nodes: MarketNode[]; edges: MarketEdge[] }) => void;
  handleAiWsMessage: (msg: import("./editor-ws").AiWsMessage) => void;
  pollAiJob: (jobId: string, anchorId: string) => void;

  onNodesChange: (c: NodeChange<MarketFlowNode>[]) => void;
  onEdgesChange: (c: EdgeChange[]) => void;
  beginDrag: () => void;
  endDrag: (moved: MarketFlowNode[]) => void;

  updateNode: (id: string, patch: NodeUpdate) => void;
  recordBefore: (before: GraphSnapshot) => void;
  snapshot: () => GraphSnapshot;

  createNode: (input: Omit<NodeCreate, "id">) => Promise<boolean>;
  deleteNode: (id: string) => Promise<void>;
  connect: (sourceId: string, targetId: string) => Promise<void>;
  deleteEdge: (id: string) => Promise<void>;

  clickNode: (id: string) => void;
  clickEdge: (id: string) => void;
  clearSelection: () => void;
  toggleConnectMode: () => void;

  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

let dragBefore: GraphSnapshot | null = null;
const aiJobPollers = new Map<string, ReturnType<typeof setInterval>>();

function clearAiPoll(jobId: string) {
  const t = aiJobPollers.get(jobId);
  if (t) clearInterval(t);
  aiJobPollers.delete(jobId);
}

function clearAiRunning(set: (p: Partial<EditorState>) => void, get: () => EditorState, nodeId: string) {
  const next = new Set(get().aiRunningNodeIds);
  next.delete(nodeId);
  set({ aiRunningNodeIds: next });
}

export const useEditor = create<EditorState>((set, get) => {
  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      // The map stays visible to everyone; only editing rights are dropped.
      toast.error(ERROR_MESSAGES.UNAUTHORIZED);
      setToken(null);
      set({
        user: null,
        history: emptyHistory(),
        connectMode: false,
        connectSourceId: null,
      });
      return;
    }
    toast.error(errorMessage(err));
  };

  const isEditor = () => get().user?.role === "editor";

  const syncTo = async (from: GraphSnapshot, to: GraphSnapshot) => {
    const d = diffSnapshots(from, to);
    const nodeIds = new Map<string, string>();
    const edgeIds = new Map<string, string>();
    const mapNode = (id: string) => nodeIds.get(id) ?? id;

    for (const n of d.createNodes) {
      const created = await api.createNode({
        id: n.id,
        name: n.name,
        nodeType: n.nodeType,
        description: n.description ?? null,
        color: n.color ?? null,
        positionX: n.positionX,
        positionY: n.positionY,
      });
      if (created.id !== n.id) nodeIds.set(n.id, created.id);
      if (n.note) saver.schedule(created.id, { note: n.note });
    }
    for (const id of d.deleteEdgeIds) await api.deleteEdge(id);
    for (const id of d.deleteNodeIds) {
      saver.discard(id);
      await api.deleteNode(id);
    }
    for (const e of d.createEdges) {
      const created = await api.createEdge({
        sourceId: mapNode(e.sourceId),
        targetId: mapNode(e.targetId),
      });
      if (created.id !== e.id) edgeIds.set(e.id, created.id);
    }
    // Property / position changes go through the regular debounced save.
    for (const p of d.patchNodes) saver.schedule(mapNode(p.id), p.patch);

    if (nodeIds.size || edgeIds.size) {
      const remap = (s: GraphSnapshot) => remapSnapshot(s, nodeIds, edgeIds);
      const { nodes, edges, history } = get();
      const next = fromSnapshot(remap(toSnapshot(nodes, edges)), [], []);
      set({ ...next, history: mapHistory(history, remap) });
    }
  };

  const travel = async (dir: "undo" | "redo") => {
    const s = get();
    if (!isEditor() || s.syncing) return;
    const current = s.snapshot();
    const step = dir === "undo" ? undoHistory(s.history, current) : redoHistory(s.history, current);
    if (!step) return;
    const next = fromSnapshot(step.target, s.nodes, s.edges);
    set({
      ...next,
      history: step.history,
      syncing: true,
      connectSourceId: null,
      selectedEdgeId: null,
      selectedNodeId: step.target.nodes.some((n) => n.id === s.selectedNodeId)
        ? s.selectedNodeId
        : null,
    });
    try {
      await syncTo(current, step.target);
    } catch (err) {
      handleError(err);
      toast.message("Карта перезагружена с сервера");
      await get().loadGraph();
    } finally {
      set({ syncing: false });
    }
  };

  return {
    user: null,
    authChecked: false,
    load: "idle",
    nodes: [],
    edges: [],
    history: emptyHistory(),
    syncing: false,
    selectedNodeId: null,
    selectedEdgeId: null,
    connectMode: false,
    connectSourceId: null,
    authOpen: false,
    createOpen: false,
    confirmDeleteId: null,
    graphFocusId: null,
    graphRoots: [],
    collapsedNodeIds: loadCollapsedIds(),
    nodeDetailLoadingId: null,
    aiRunningNodeIds: new Set<string>(),
    confirmAiExpandId: null,

    set: (p) => set(p),

    bootstrap: async () => {
      // The map is public: load it for everyone, sign-in only unlocks editing.
      if (getToken()) {
        try {
          set({ user: await api.me() });
        } catch {
          setToken(null);
          set({ user: null });
        }
      }
      set({ authChecked: true });
      await get().loadGraphRoots();
      await get().loadGraph();
    },

    login: async (username, password, editorKey) => {
      const res = await api.login({ username, password, editorKey });
      setToken(res.access_token);
      const user: AuthUser = { username, role: res.role };
      set({ user, authOpen: false, history: emptyHistory() });
      if (editorKey && res.role !== "editor") toast.warning("Ключ редактора не подошёл — вход в режиме просмотра");
      else if (res.role === "editor") toast.success("Режим редактора включён");
      else toast.message("Для редактирования нужен ключ редактора");
      // Pick up any changes made by others since the page was opened.
      await get().loadGraph();
    },

    register: async (username, password) => {
      const name = username.trim();
      const res = await api.register({ username: name, password });
      setToken(res.access_token);
      set({ user: { username: name, role: res.role }, authOpen: false, history: emptyHistory() });
      toast.success("Аккаунт создан — режим просмотра. Ключ редактора можно указать при входе.");
      await get().loadGraph();
    },

    logout: async () => {
      await saver.flushAll();
      setToken(null);
      set({
        user: null,
        history: emptyHistory(),
        selectedNodeId: null,
        selectedEdgeId: null,
        connectMode: false,
        connectSourceId: null,
      });
    },

    loadGraph: async () => {
      set({ load: get().nodes.length ? "ready" : "loading" });
      const focusId = get().graphFocusId;
      try {
        const g = await api.getGraph(focusId).catch(async (err) => {
          // A stale token must not hide the public map: retry anonymously.
          if (err instanceof ApiError && err.status === 401 && getToken()) {
            setToken(null);
            set({ user: null });
            return api.getGraph(focusId);
          }
          throw err;
        });
        set({ ...fromSnapshot(g, [], []), load: "ready", history: emptyHistory() });
      } catch (err) {
        set({ load: "error" });
        handleError(err);
      }
    },

    loadGraphRoots: async () => {
      try {
        set({ graphRoots: await api.getGraphRoots() });
      } catch {
        /* optional UI chrome when API has no roots yet */
      }
    },

    setGraphFocus: async (focusId) => {
      set({ graphFocusId: focusId, collapsedNodeIds: new Set() });
      saveCollapsedIds(new Set());
      await get().loadGraph();
    },

    toggleNodeCollapsed: (nodeId) => {
      const next = new Set(get().collapsedNodeIds);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      saveCollapsedIds(next);
      set({ collapsedNodeIds: next });
    },

    ensureNodeDetail: async (nodeId) => {
      const flow = get().nodes.find((n) => n.id === nodeId);
      if (!flow) return;
      const d = flow.data;
      if (d.descriptionPinned || d.description) return;
      if (!d.hasDescription) return;
      if (get().nodeDetailLoadingId === nodeId) return;
      set({ nodeDetailLoadingId: nodeId });
      try {
        const full = await api.getNode(nodeId);
        set({
          nodeDetailLoadingId: null,
          nodes: get().nodes.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    description: full.description ?? null,
                    hasDescription: full.hasDescription ?? !!full.description,
                    descriptionPinned: full.descriptionPinned ?? false,
                  },
                }
              : n,
          ),
        });
      } catch (err) {
        set({ nodeDetailLoadingId: null });
        handleError(err);
      }
    },

    applyGraphPatch: (anchorId, patch) => {
      const s = get();
      const focusOk =
        !s.graphFocusId ||
        s.graphFocusId === anchorId ||
        s.nodes.some((n) => n.id === anchorId) ||
        patch.nodes.some((n) => s.nodes.some((x) => x.id === n.id));
      if (!focusOk) return;

      const nodeMap = new Map(s.nodes.map((n) => [n.id, n]));
      for (const n of patch.nodes) {
        nodeMap.set(n.id, toFlowNode(n, nodeMap.get(n.id)));
      }
      const edgeMap = new Map(s.edges.map((e) => [e.id, e]));
      for (const e of patch.edges) {
        edgeMap.set(e.id, toFlowEdge(e, edgeMap.get(e.id)));
      }
      set({ nodes: [...nodeMap.values()], edges: [...edgeMap.values()] });
      toast.success("AI добавил продолжение ветки");
    },

    pollAiJob: (jobId, anchorId) => {
      clearAiPoll(jobId);
      const tick = async () => {
        try {
          const job = await api.getAiJob(jobId);
          if (job.status === "completed" && job.nodes?.length) {
            clearAiPoll(jobId);
            clearAiRunning(set, get, anchorId);
            get().applyGraphPatch(anchorId, {
              nodes: job.nodes,
              edges: job.edges ?? [],
            });
          } else if (job.status === "error") {
            clearAiPoll(jobId);
            clearAiRunning(set, get, anchorId);
            toast.error(job.error ?? "AI не смог построить ветку");
          }
        } catch {
          /* keep polling until ws or timeout */
        }
      };
      void tick();
      aiJobPollers.set(jobId, setInterval(() => void tick(), 2500));
    },

    handleAiWsMessage: (msg) => {
      if (msg.type === "ai.status") {
        if (msg.status === "running") {
          set({ aiRunningNodeIds: new Set(get().aiRunningNodeIds).add(msg.nodeId) });
        }
        if (msg.status === "completed" || msg.status === "error") {
          clearAiRunning(set, get, msg.nodeId);
          clearAiPoll(msg.jobId);
          if (msg.status === "error") toast.error(msg.message ?? "AI не смог построить ветку");
        }
      }
      if (msg.type === "graph.patch") {
        clearAiPoll(msg.jobId);
        clearAiRunning(set, get, msg.nodeId);
        get().applyGraphPatch(msg.nodeId, { nodes: msg.nodes, edges: msg.edges });
      }
    },

    expandNode: async (nodeId, force = false) => {
      if (!isEditor()) return;
      try {
        if (!force) {
          const { hasAiOutgoing } = await api.getAiOutgoing(nodeId);
          if (hasAiOutgoing) {
            set({ confirmAiExpandId: nodeId });
            return;
          }
        }
        set({ confirmAiExpandId: null, aiRunningNodeIds: new Set(get().aiRunningNodeIds).add(nodeId) });
        const { jobId } = await api.expandNode(nodeId, force);
        get().pollAiJob(jobId, nodeId);
      } catch (err) {
        clearAiRunning(set, get, nodeId);
        handleError(err);
      }
    },

    onNodesChange: (changes) => {
      const allowed = changes.filter((c) => c.type !== "remove");
      set({ nodes: applyNodeChanges(allowed, get().nodes) });
    },

    onEdgesChange: (changes) => {
      const allowed = changes.filter((c) => c.type !== "remove");
      set({ edges: applyEdgeChanges(allowed, get().edges) });
    },

    beginDrag: () => {
      dragBefore = get().snapshot();
    },

    endDrag: (moved) => {
      const before = dragBefore;
      dragBefore = null;
      let changed = false;
      for (const n of moved) {
        const prev = before?.nodes.find((p) => p.id === n.id);
        if (prev && prev.positionX === n.position.x && prev.positionY === n.position.y) continue;
        changed = true;
        saver.schedule(n.id, { positionX: n.position.x, positionY: n.position.y });
      }
      if (changed && before) set({ history: pushHistory(get().history, before) });
    },

    updateNode: (id, patch) => {
      if (!isEditor()) return;
      set({
        nodes: get().nodes.map((n) => {
          if (n.id !== id) return n;
          const { positionX, positionY, ...data } = patch;
          return {
            ...n,
            position: {
              x: positionX ?? n.position.x,
              y: positionY ?? n.position.y,
            },
            data: { ...n.data, ...data },
          };
        }),
      });
      saver.schedule(id, patch);
    },

    recordBefore: (before) => set({ history: pushHistory(get().history, before) }),

    snapshot: () => toSnapshot(get().nodes, get().edges),

    createNode: async (input) => {
      if (!isEditor()) return false;
      const before = get().snapshot();
      try {
        const node = await api.createNode(input);
        set({
          nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), { ...toFlowNode(node), selected: true }],
          history: pushHistory(get().history, before),
          selectedNodeId: node.id,
          selectedEdgeId: null,
        });
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },

    deleteNode: async (id) => {
      if (!isEditor()) return;
      const before = get().snapshot();
      try {
        saver.discard(id);
        await api.deleteNode(id);
        set({
          nodes: get().nodes.filter((n) => n.id !== id),
          edges: get().edges.filter((e) => e.source !== id && e.target !== id),
          history: pushHistory(get().history, before),
          selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
          connectSourceId: get().connectSourceId === id ? null : get().connectSourceId,
          confirmDeleteId: null,
        });
        toast("Узел удалён", {
          action: { label: "Отменить", onClick: () => void get().undo() },
        });
      } catch (err) {
        handleError(err);
      }
    },

    connect: async (sourceId, targetId) => {
      if (!isEditor()) return;
      if (sourceId === targetId) {
        toast.error(ERROR_MESSAGES.SELF_CONNECTION);
        return;
      }
      const before = get().snapshot();
      try {
        const edge = await api.createEdge({ sourceId, targetId });
        set({
          edges: [...get().edges, toFlowEdge(edge)],
          history: pushHistory(get().history, before),
        });
      } catch (err) {
        handleError(err);
      }
    },

    deleteEdge: async (id) => {
      if (!isEditor()) return;
      const before = get().snapshot();
      try {
        await api.deleteEdge(id);
        set({
          edges: get().edges.filter((e) => e.id !== id),
          history: pushHistory(get().history, before),
          selectedEdgeId: null,
        });
      } catch (err) {
        handleError(err);
      }
    },

    clickNode: (id) => {
      const s = get();
      if (s.connectMode && isEditor()) {
        if (!s.connectSourceId) {
          set({ connectSourceId: id, selectedNodeId: id, selectedEdgeId: null });
          return;
        }
        if (s.connectSourceId === id) {
          toast.error(ERROR_MESSAGES.SELF_CONNECTION);
          set({ connectSourceId: null });
          return;
        }
        const source = s.connectSourceId;
        set({ connectSourceId: null, selectedNodeId: id });
        void get().connect(source, id);
        return;
      }
      set({ selectedNodeId: id, selectedEdgeId: null });
      void get().ensureNodeDetail(id);
    },

    clickEdge: (id) => set({ selectedEdgeId: id, selectedNodeId: null, connectSourceId: null }),

    clearSelection: () =>
      set({
        selectedNodeId: null,
        selectedEdgeId: null,
        connectSourceId: null,
        nodes: get().nodes.some((n) => n.selected)
          ? get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n))
          : get().nodes,
      }),

    toggleConnectMode: () => {
      if (!isEditor()) return;
      set({ connectMode: !get().connectMode, connectSourceId: null });
    },

    undo: () => travel("undo"),
    redo: () => travel("redo"),
  };
});

export const saver = new PendingSaver(
  (id, patch) => api.patchNode(id, patch),
  (err) => {
    if (err instanceof ApiError && err.status === 401) {
      void useEditor.getState().logout();
      toast.error(ERROR_MESSAGES.UNAUTHORIZED);
    } else toast.error(`Изменения не сохранены: ${errorMessage(err)}`);
  },
);
