import type { BatchPatchItem, NodeUpdate } from "./types";

export const SAVE_DEBOUNCE_MS = 800;

type PatchFn = (id: string, patch: NodeUpdate) => Promise<unknown>;

/**
 * Collects per-node changes and sends one PATCH per node after 800 ms of quiet.
 * Unsent changes can be drained for navigator.sendBeacon on page hide.
 */
export class PendingSaver {
  private pending = new Map<string, NodeUpdate>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private inflight = 0;
  private listeners = new Set<() => void>();

  constructor(
    private patch: PatchFn,
    private onError: (err: unknown) => void = () => {},
    private delay = SAVE_DEBOUNCE_MS,
  ) {}

  setPatchFn(fn: PatchFn) {
    this.patch = fn;
  }

  schedule(id: string, patch: NodeUpdate) {
    this.pending.set(id, { ...this.pending.get(id), ...patch });
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.set(
      id,
      setTimeout(() => void this.flush(id), this.delay),
    );
    this.emit();
  }

  async flush(id: string) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    const patch = this.pending.get(id);
    this.pending.delete(id);
    if (!patch) return;
    this.inflight++;
    this.emit();
    try {
      await this.patch(id, patch);
    } catch (err) {
      this.onError(err);
    } finally {
      this.inflight--;
      this.emit();
    }
  }

  async flushAll() {
    await Promise.all([...this.pending.keys()].map((id) => this.flush(id)));
  }

  /** Drop changes for a node that no longer exists. */
  discard(id: string) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    this.pending.delete(id);
    this.emit();
  }

  rename(oldId: string, newId: string) {
    const p = this.pending.get(oldId);
    if (!p) return;
    this.discard(oldId);
    this.schedule(newId, p);
  }

  /** Take all unsent changes (timers cancelled) — for sendBeacon. */
  drain(): BatchPatchItem[] {
    const items = [...this.pending.entries()].map(([id, patch]) => ({ id, ...patch }));
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.pending.clear();
    this.emit();
    return items;
  }

  get status(): "idle" | "pending" | "saving" {
    if (this.inflight > 0) return "saving";
    if (this.pending.size > 0) return "pending";
    return "idle";
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}
