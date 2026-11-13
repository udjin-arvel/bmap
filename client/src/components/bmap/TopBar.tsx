import { useReactFlow } from "@xyflow/react";
import {
  Check,
  CircleUser,
  GitBranch,
  KeyRound,
  Loader2,
  LogOut,
  Maximize2,
  Plus,
  Redo2,
  Spline,
  Undo2,
} from "lucide-react";
import { useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { saver, useEditor } from "@/lib/bmap/store";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function SaveStatus() {
  const status = useSyncExternalStore(
    (cb) => saver.subscribe(cb),
    () => saver.status,
    () => "idle" as const,
  );
  const syncing = useEditor((s) => s.syncing);
  const s = syncing ? "saving" : status;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      {s === "saving" ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : s === "pending" ? (
        <span className="size-2 rounded-full bg-signal" />
      ) : (
        <Check className="size-3.5 text-success" />
      )}
      {s === "saving" ? "Сохраняем…" : s === "pending" ? "Есть изменения" : "Сохранено"}
    </span>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-9" aria-hidden>
        <path d="M8 22 L16 10 L24 18" className="fill-none stroke-muted-foreground" strokeWidth="1.6" />
        <circle cx="8" cy="22" r="3" className="fill-foreground" />
        <circle cx="16" cy="10" r="3" className="fill-foreground" />
        <circle cx="24" cy="18" r="3" className="fill-foreground" />
      </svg>
      <div className="leading-none">
        <div className="font-display text-base font-semibold">BMap</div>
        <div className="eyebrow mt-0.5 text-muted-foreground">карта рынка</div>
      </div>
    </div>
  );
}

export function TopBar() {
  const user = useEditor((s) => s.user);
  const connectMode = useEditor((s) => s.connectMode);
  const canUndo = useEditor((s) => s.history.past.length > 0 && !s.syncing);
  const canRedo = useEditor((s) => s.history.future.length > 0 && !s.syncing);
  const loaded = useEditor((s) => s.load === "ready");
  const graphFocusId = useEditor((s) => s.graphFocusId);
  const graphRoots = useEditor((s) => s.graphRoots);
  const selectedNodeId = useEditor((s) => s.selectedNodeId);
  const nodes = useEditor((s) => s.nodes);
  const { set, undo, redo, toggleConnectMode, logout, setGraphFocus } = useEditor.getState();
  const rf = useReactFlow();
  const isEditor = user?.role === "editor";
  const selectedLabel = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)?.data.name
    : undefined;
  const focusValue = graphFocusId ?? "__all__";

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4">
      <Logo />
      <Separator orientation="vertical" className="h-6" />

      {loaded && (graphRoots.length > 0 || graphFocusId) ? (
        <Select
          value={focusValue}
          onValueChange={(v) => void setGraphFocus(v === "__all__" ? null : v)}
        >
          <SelectTrigger className="h-8 w-[min(240px,28vw)] gap-2" aria-label="Область карты">
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="Вся карта" />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="__all__">Вся карта</SelectItem>
            {graphRoots.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
                {r.childCount > 0 ? ` (${r.childCount})` : ""}
              </SelectItem>
            ))}
            {selectedNodeId &&
            selectedLabel &&
            !graphRoots.some((r) => r.id === selectedNodeId) ? (
              <SelectItem value={selectedNodeId}>Ветка: {selectedLabel}</SelectItem>
            ) : null}
            {graphFocusId &&
            !graphRoots.some((r) => r.id === graphFocusId) &&
            graphFocusId !== selectedNodeId ? (
              <SelectItem value={graphFocusId}>Текущая ветка</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      ) : null}

      <div className="flex items-center gap-1">
        {isEditor && (
          <>
            <Tip label="Новый узел (N)">
              <Button size="sm" variant="signal" onClick={() => set({ createOpen: true })} disabled={!loaded}>
                <Plus /> Узел
              </Button>
            </Tip>
            <Tip label="Связать два узла кликами (C)">
              <Button
                size="sm"
                variant="toolbar"
                data-active={connectMode}
                onClick={toggleConnectMode}
                disabled={!loaded}
              >
                <Spline /> Связать
              </Button>
            </Tip>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Tip label={`Отменить (${MOD}+Z)`}>
              <Button size="icon" variant="toolbar" className="size-8" onClick={() => void undo()} disabled={!canUndo} aria-label="Отменить">
                <Undo2 />
              </Button>
            </Tip>
            <Tip label={`Повторить (${MOD}+Shift+Z)`}>
              <Button size="icon" variant="toolbar" className="size-8" onClick={() => void redo()} disabled={!canRedo} aria-label="Повторить">
                <Redo2 />
              </Button>
            </Tip>
          </>
        )}
        <Tip label="Показать всю карту">
          <Button
            size="icon"
            variant="toolbar"
            className="size-8"
            onClick={() => void rf.fitView({ padding: 0.15, duration: 300 })}
            disabled={!loaded}
            aria-label="Показать всю карту"
          >
            <Maximize2 />
          </Button>
        </Tip>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {isEditor && <SaveStatus />}
        <Badge variant={isEditor ? "default" : "secondary"} className="h-6">
          {isEditor ? "Редактирование" : "Просмотр"}
        </Badge>

        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <CircleUser /> {user.username}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="text-sm font-semibold">{user.username}</div>
                <div className="text-xs text-muted-foreground">
                  {isEditor ? "Может редактировать карту" : "Только просмотр"}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {!isEditor && (
                <DropdownMenuItem onSelect={() => set({ authOpen: true })}>
                  <KeyRound /> Ввести ключ редактора
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => set({ authOpen: true })}>
                <CircleUser /> Сменить пользователя
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void logout()}>
                <LogOut /> Выйти
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button variant="outline" size="icon" onClick={() => set({ authOpen: true })} aria-label="Войти">
            <CircleUser />
          </Button>
        )}
      </div>
    </header>
  );
}
