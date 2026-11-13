import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, Loader2, Sparkles, StickyNote } from "lucide-react";
import { memo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useEditor, type MarketFlowNode } from "@/lib/bmap/store";
import { NODE_TYPE_META, type GraphSnapshot } from "@/lib/bmap/types";
import { cn } from "@/lib/utils";

import { NodeTypeIcon } from "./node-type-icon";

function MarketNodeViewImpl({ id, data }: NodeProps<MarketFlowNode>) {
  const isEditor = useEditor((s) => s.user?.role === "editor");
  const isSource = useEditor((s) => s.connectSourceId === id);
  const connectMode = useEditor((s) => s.connectMode);
  const isSelected = useEditor((s) => s.selectedNodeId === id);
  const updateNode = useEditor((s) => s.updateNode);
  const recordBefore = useEditor((s) => s.recordBefore);
  const snapshot = useEditor((s) => s.snapshot);
  const edges = useEditor((s) => s.edges);
  const collapsedNodeIds = useEditor((s) => s.collapsedNodeIds);
  const toggleNodeCollapsed = useEditor((s) => s.toggleNodeCollapsed);
  const aiRunning = useEditor((s) => s.aiRunningNodeIds.has(id));
  const expandNode = useEditor((s) => s.expandNode);

  const hasChildren = edges.some((e) => e.source === id);
  const isCollapsed = collapsedNodeIds.has(id);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.name);
  const before = useRef<GraphSnapshot | null>(null);

  const color = data.color || undefined;
  const meta = NODE_TYPE_META[data.nodeType];

  const startEdit = () => {
    if (!isEditor || connectMode) return;
    before.current = snapshot();
    setDraft(data.name);
    setEditing(true);
  };

  const finishEdit = (save: boolean) => {
    setEditing(false);
    const next = draft.trim();
    if (save && next && next !== data.name && before.current) {
      recordBefore(before.current);
      updateNode(id, { name: next });
    }
    before.current = null;
  };

  return (
    <div
      onDoubleClick={startEdit}
      className={cn(
        "group relative w-[230px] overflow-hidden rounded-lg border bg-card text-card-foreground shadow-node transition-shadow",
        "hover:shadow-lift",
        isSelected && !isSource && "ring-2 ring-foreground/70",
        isSource && "animate-signal ring-2 ring-signal",
      )}
    >
      <div
        className="absolute inset-y-0 left-0 w-1.5 bg-muted-foreground/40"
        style={color ? { backgroundColor: color } : undefined}
      />
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isEditor}
        className={cn(!isEditor && "opacity-0")}
      />
      <div className="py-3 pr-3 pl-4">
        <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
          <span
            className="grid size-5 place-items-center rounded bg-muted text-foreground"
            style={color ? { color } : undefined}
          >
            <NodeTypeIcon type={data.nodeType} className="size-3.5" />
          </span>
          <span className="eyebrow">{meta?.label ?? data.nodeType}</span>
          {hasChildren ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="nodrag nopan size-6 shrink-0"
              aria-label={isCollapsed ? "Развернуть ветку" : "Свернуть ветку"}
              onClick={(e) => {
                e.stopPropagation();
                toggleNodeCollapsed(id);
              }}
            >
              {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </Button>
          ) : null}
          {data.note ? (
            <span
              className="ml-auto inline-flex items-center gap-1 rounded bg-signal-soft px-1.5 py-0.5 text-signal"
              title={data.note}
            >
              <StickyNote className="size-3" />
              <span className="eyebrow">заметка</span>
            </span>
          ) : null}
        </div>

        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => finishEdit(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") finishEdit(true);
              if (e.key === "Escape") finishEdit(false);
              e.stopPropagation();
            }}
            className="nodrag w-full rounded border border-input bg-background px-1.5 py-0.5 text-sm font-semibold outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <div className="text-sm leading-snug font-semibold">{data.name}</div>
        )}

        {data.descriptionPinned && data.description ? (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {data.description}
          </p>
        ) : null}

        {isEditor ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="nodrag nopan mt-2 h-7 gap-1 px-2 text-xs"
            disabled={aiRunning || connectMode}
            onClick={(e) => {
              e.stopPropagation();
              void expandNode(id);
            }}
          >
            {aiRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            AI
          </Button>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isEditor}
        className={cn(!isEditor && "opacity-0")}
      />
    </div>
  );
}

export const MarketNodeView = memo(MarketNodeViewImpl);
