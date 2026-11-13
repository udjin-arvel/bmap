import "@xyflow/react/dist/style.css";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { Loader2, MousePointerClick, Plus, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/bmap/api";
import { saver, useEditor, type MarketFlowNode } from "@/lib/bmap/store";
import { NODE_TYPE_META, NODE_TYPES } from "@/lib/bmap/types";
import { applyCollapsedView } from "@/lib/bmap/visibility";
import { connectEditorWs } from "@/lib/bmap/editor-ws";
import { cn } from "@/lib/utils";

import { AuthModal } from "./AuthModal";
import { AiExpandConfirmModal } from "./AiExpandConfirmModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { CreateNodeModal } from "./CreateNodeModal";
import { Inspector } from "./Inspector";
import { MarketNodeView } from "./MarketNodeView";
import { NodeTypeIcon } from "./node-type-icon";
import { TopBar } from "./TopBar";

const nodeTypes = { market: MarketNodeView };

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = useEditor.getState();
      if (s.authOpen || s.createOpen || s.confirmDeleteId) return;
      const isEditor = s.user?.role === "editor";
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") {
        e.preventDefault();
        void (e.shiftKey ? s.redo() : s.undo());
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        void s.redo();
        return;
      }
      if (e.key === "Escape") {
        if (s.connectSourceId) s.set({ connectSourceId: null });
        else if (s.connectMode) s.set({ connectMode: false });
        else s.clearSelection();
        return;
      }
      if (!isEditor || mod || e.altKey) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (s.selectedEdgeId) void s.deleteEdge(s.selectedEdgeId);
        else if (s.selectedNodeId) s.set({ confirmDeleteId: s.selectedNodeId });
        return;
      }
      if (key === "c" && s.load === "ready") s.toggleConnectMode();
      if (key === "n" && s.load === "ready") {
        e.preventDefault();
        s.set({ createOpen: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Unsaved debounced changes are sent via navigator.sendBeacon when the tab goes away. */
function useBeacon() {
  useEffect(() => {
    const send = () => {
      if (useEditor.getState().user?.role !== "editor") return;
      api.beaconBatchPatch(saver.drain());
    };
    const onVisibility = () => document.visibilityState === "hidden" && send();
    window.addEventListener("pagehide", send);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", send);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}

function Legend() {
  return (
    <div className="glass-panel absolute top-3 left-3 z-10 flex items-center gap-3 rounded-lg px-3 py-2">
      {NODE_TYPES.map((t) => (
        <span key={t} className="flex items-center gap-1.5 text-xs text-muted-foreground" title={NODE_TYPE_META[t].hint}>
          <NodeTypeIcon type={t} className="size-3.5 text-foreground" />
          {NODE_TYPE_META[t].label}
        </span>
      ))}
    </div>
  );
}

function ConnectHint() {
  const connectMode = useEditor((s) => s.connectMode);
  const source = useEditor((s) => s.nodes.find((n) => n.id === s.connectSourceId));
  if (!connectMode) return null;
  return (
    <div className="glass-panel absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full py-2 pr-2 pl-4 text-sm">
      <MousePointerClick className="size-4 text-signal" />
      {source ? (
        <span>
          Из <b className="font-semibold">«{source.data.name}»</b> — теперь выберите узел-цель
        </span>
      ) : (
        <span>Выберите узел-источник</span>
      )}
      <span className="eyebrow text-muted-foreground">Esc — отмена</span>
      <Button size="sm" variant="ghost" className="h-7 rounded-full" onClick={() => useEditor.getState().toggleConnectMode()}>
        Готово
      </Button>
    </div>
  );
}

function Overlay() {
  const user = useEditor((s) => s.user);
  const authChecked = useEditor((s) => s.authChecked);
  const load = useEditor((s) => s.load);
  const empty = useEditor((s) => s.nodes.length === 0);
  const { set, loadGraph } = useEditor.getState();

  let content: React.ReactNode = null;
  if (!authChecked || load === "loading") {
    content = (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Загружаем карту…
      </div>
    );
  } else if (load === "error") {
    content = (
      <div className="glass-panel rounded-2xl p-6 text-center">
        <p className="text-sm">Не удалось загрузить карту.</p>
        <Button variant="outline" className="mt-3" onClick={() => void loadGraph()}>
          <RotateCw /> Повторить
        </Button>
      </div>
    );
  } else if (load === "ready" && empty) {
    content = (
      <div className="glass-panel max-w-xs rounded-2xl p-6 text-center">
        <p className="text-sm text-muted-foreground">Карта пока пуста.</p>
        {user?.role === "editor" && (
          <Button variant="signal" className="mt-3" onClick={() => set({ createOpen: true })}>
            <Plus /> Первый узел
          </Button>
        )}
      </div>
    );
  }
  if (!content) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <div className="pointer-events-auto">{content}</div>
    </div>
  );
}

function Canvas() {
  const nodes = useEditor((s) => s.nodes);
  const edges = useEditor((s) => s.edges);
  const collapsedNodeIds = useEditor((s) => s.collapsedNodeIds);
  const { nodes: visibleNodes, edges: visibleEdges } = useMemo(
    () => applyCollapsedView(nodes, edges, collapsedNodeIds),
    [nodes, edges, collapsedNodeIds],
  );
  const load = useEditor((s) => s.load);
  const isEditor = useEditor((s) => s.user?.role === "editor");
  const connectMode = useEditor((s) => s.connectMode);
  const {
    onNodesChange,
    onEdgesChange,
    clickNode,
    clickEdge,
    clearSelection,
    beginDrag,
    endDrag,
    connect,
  } = useEditor.getState();
  const rf = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (load !== "ready") return;
    const t = setTimeout(() => void rf.fitView({ padding: 0.15 }), 50);
    return () => clearTimeout(t);
  }, [load, rf]);

  const getCenter = useCallback(() => {
    const r = wrapper.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }, [rf]);

  return (
    <div ref={wrapper} className={cn("relative min-h-0 flex-1", connectMode && "bmap-connect")}>
      <ReactFlow<MarketFlowNode>
        nodes={visibleNodes}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, n) => clickNode(n.id)}
        onEdgeClick={(_, e) => clickEdge(e.id)}
        onPaneClick={clearSelection}
        onNodeDragStart={() => beginDrag()}
        onNodeDragStop={(_, _n, moved) => endDrag(moved)}
        onConnect={(c) => c.source && c.target && void connect(c.source, c.target)}
        nodesDraggable={isEditor && !connectMode}
        nodesConnectable={isEditor && !connectMode}
        edgesFocusable
        deleteKeyCode={null}
        onlyRenderVisibleElements={visibleNodes.length > 300}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} />
        <Controls showInteractive={false} position="bottom-left" />
        {visibleNodes.length > 0 && (
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeBorderRadius={6}
          nodeColor={(n) => ((n.data as MarketFlowNode["data"]).color as string) || "var(--muted-foreground)"}
        />
        )}
      </ReactFlow>
      <Legend />
      <Inspector />
      <ConnectHint />
      <Overlay />
      <CreateNodeModal getCenter={getCenter} />
    </div>
  );
}

function useEditorWebSocket() {
  const user = useEditor((s) => s.user);
  useEffect(() => {
    if (user?.role !== "editor") return;
    const dispose = connectEditorWs((msg) => useEditor.getState().handleAiWsMessage(msg));
    return () => dispose?.();
  }, [user?.role, user?.username]);
}

export default function Editor() {
  useHotkeys();
  useBeacon();
  useEditorWebSocket();
  useEffect(() => {
    void useEditor.getState().bootstrap();
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <ReactFlowProvider>
        <div className="flex h-dvh flex-col">
          <TopBar />
          <Canvas />
        </div>
        <AuthModal />
        <AiExpandConfirmModal />
        <ConfirmDeleteModal />
      </ReactFlowProvider>
    </TooltipProvider>
  );
}
