import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEditor } from "@/lib/bmap/store";
import { NODE_TYPE_META, NODE_TYPES, type NodeType } from "@/lib/bmap/types";

import { ColorPalette } from "./ColorPalette";
import { NodeTypeIcon } from "./node-type-icon";

export function CreateNodeModal({ getCenter }: { getCenter: () => { x: number; y: number } }) {
  const open = useEditor((s) => s.createOpen);
  const { set, createNode } = useEditor.getState();

  const [name, setName] = useState("");
  const [nodeType, setNodeType] = useState<NodeType>("PROCESS");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string | null>("#4A90D9");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const c = getCenter();
    const ok = await createNode({
      name: name.trim(),
      nodeType,
      description: description.trim() || null,
      color,
      // centre the 230px-wide card on the viewport centre
      positionX: Math.round(c.x - 115),
      positionY: Math.round(c.y - 40),
    });
    setBusy(false);
    if (ok) set({ createOpen: false });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => set({ createOpen: o })}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="font-display">Новый узел</DialogTitle>
            <DialogDescription>Появится в центре текущего вида карты.</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="cn-name">Название *</Label>
            <Input
              id="cn-name"
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, «Доставка до завода дверей»"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Тип</Label>
            <Select value={nodeType} onValueChange={(v) => setNodeType(v as NodeType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NODE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    <span className="flex items-center gap-2">
                      <NodeTypeIcon type={t} className="size-4 text-muted-foreground" />
                      {NODE_TYPE_META[t].label}
                      <span className="text-xs text-muted-foreground">· {NODE_TYPE_META[t].hint}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cn-desc">Описание</Label>
            <Textarea
              id="cn-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Цвет</Label>
            <ColorPalette value={color} onChange={setColor} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => set({ createOpen: false })}>
              Отмена
            </Button>
            <Button type="submit" variant="signal" disabled={busy || !name.trim()}>
              {busy ? "Создаём…" : "Создать узел"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
