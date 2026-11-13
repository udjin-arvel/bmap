import { ArrowRight, Loader2, Trash2, X } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useEditor } from "@/lib/bmap/store";
import { NODE_TYPE_META, type GraphSnapshot, type NodeUpdate } from "@/lib/bmap/types";

import { ColorPalette } from "./ColorPalette";
import { NodeTypeIcon } from "./node-type-icon";

function formatDate(v?: string) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export function Inspector() {
  const selectedNodeId = useEditor((s) => s.selectedNodeId);
  const selectedEdgeId = useEditor((s) => s.selectedEdgeId);
  const connectSourceId = useEditor((s) => s.connectSourceId);
  const node = useEditor((s) => s.nodes.find((n) => n.id === s.selectedNodeId));
  const edge = useEditor((s) => s.edges.find((e) => e.id === s.selectedEdgeId));
  const nodes = useEditor((s) => s.nodes);
  const isEditor = useEditor((s) => s.user?.role === "editor");
  const nodeDetailLoadingId = useEditor((s) => s.nodeDetailLoadingId);
  const { updateNode, recordBefore, snapshot, clearSelection, set, deleteEdge } = useEditor.getState();

  const focusSnap = useRef<GraphSnapshot | null>(null);
  const focusValue = useRef<string>("");

  if (connectSourceId) return null;

  if (edge && selectedEdgeId) {
    const src = nodes.find((n) => n.id === edge.source);
    const tgt = nodes.find((n) => n.id === edge.target);
    return (
      <aside className="glass-panel absolute top-3 right-3 z-10 w-80 rounded-xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="eyebrow text-muted-foreground">Связь · NEXT_STEP</span>
          <Button variant="ghost" size="icon" className="size-7" onClick={clearSelection} aria-label="Закрыть">
            <X />
          </Button>
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="min-w-0 flex-1 truncate">{src?.data.name ?? "?"}</span>
          <ArrowRight className="size-4 shrink-0 text-signal" />
          <span className="min-w-0 flex-1 truncate text-right">{tgt?.data.name ?? "?"}</span>
        </div>
        {isEditor && (
          <Button
            variant="outline"
            className="mt-4 w-full text-destructive hover:text-destructive"
            onClick={() => void deleteEdge(edge.id)}
          >
            <Trash2 /> Удалить связь
          </Button>
        )}
      </aside>
    );
  }

  if (!node) return null;
  const d = node.data;
  const meta = NODE_TYPE_META[d.nodeType];
  const descLoading = nodeDetailLoadingId === node.id;

  const descPlaceholder = () => {
    if (descLoading) return "Загрузка…";
    if (d.hasDescription && !d.description) return "Нажмите, чтобы загрузить описание";
    return isEditor ? "Кратко, что это" : "—";
  };

  const onFocus = (value: string) => {
    focusSnap.current = snapshot();
    focusValue.current = value;
  };
  const onBlur = (field: keyof NodeUpdate, value: string) => {
    if (field === "name" && !value.trim()) {
      updateNode(node.id, { name: focusValue.current });
    } else if (value !== focusValue.current && focusSnap.current) {
      recordBefore(focusSnap.current);
    }
    focusSnap.current = null;
  };
  const text = (field: "name" | "description" | "note") => ({
    value: (d[field] as string | null | undefined) ?? "",
    readOnly: !isEditor,
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => onFocus(e.target.value),
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => onBlur(field, e.target.value),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      updateNode(node.id, { [field]: field === "name" ? e.target.value : e.target.value || null }),
    onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
  });

  return (
    <aside
      key={node.id}
      className="glass-panel absolute top-3 right-3 bottom-3 z-10 flex w-80 flex-col overflow-hidden rounded-xl"
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span
          className="grid size-7 place-items-center rounded-md bg-muted"
          style={d.color ? { color: d.color } : undefined}
        >
          <NodeTypeIcon type={d.nodeType} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="eyebrow text-muted-foreground">{meta.label}</div>
          <div className="truncate text-xs text-muted-foreground">{meta.hint}</div>
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={clearSelection} aria-label="Закрыть">
          <X />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="insp-name">Название</Label>
          <Input id="insp-name" {...text("name")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="insp-desc">Описание</Label>
          <div className="relative">
            {descLoading ? (
              <Loader2 className="absolute top-2.5 right-2 size-4 animate-spin text-muted-foreground" />
            ) : null}
            <Textarea id="insp-desc" rows={3} placeholder={descPlaceholder()} {...text("description")} />
          </div>
          {isEditor ? (
            <div className="flex items-center justify-between gap-2 pt-1">
              <Label htmlFor="insp-pin" className="text-xs font-normal text-muted-foreground">
                Закрепить описание на карточке
              </Label>
              <Switch
                id="insp-pin"
                checked={!!d.descriptionPinned}
                onCheckedChange={(checked) => {
                  recordBefore(snapshot());
                  updateNode(node.id, { descriptionPinned: checked });
                }}
              />
            </div>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="insp-note">Заметка</Label>
          <Textarea
            id="insp-note"
            rows={4}
            placeholder={isEditor ? "Ваши наблюдения, цифры, ссылки" : "—"}
            {...text("note")}
          />
        </div>
        <div className="space-y-2">
          <Label>Цветовая метка</Label>
          <ColorPalette
            value={d.color}
            disabled={!isEditor}
            onChange={(hex) => {
              if ((d.color ?? null) === hex) return;
              recordBefore(snapshot());
              updateNode(node.id, { color: hex });
            }}
          />
        </div>
        <dl className="grid grid-cols-2 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
          <dt>Создан</dt>
          <dd className="text-right">{formatDate(d.createdAt)}</dd>
          <dt>Изменён</dt>
          <dd className="text-right">{formatDate(d.updatedAt)}</dd>
        </dl>
      </div>

      {isEditor && (
        <div className="border-t px-4 py-3">
          <Button
            variant="outline"
            className="w-full text-destructive hover:text-destructive"
            onClick={() => set({ confirmDeleteId: node.id })}
          >
            <Trash2 /> Удалить узел
          </Button>
        </div>
      )}
    </aside>
  );
}
