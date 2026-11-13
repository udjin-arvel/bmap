import type { GraphSnapshot } from "./types";

export const HISTORY_LIMIT = 5;

export interface HistoryState {
  past: GraphSnapshot[];
  future: GraphSnapshot[];
}

export const emptyHistory = (): HistoryState => ({ past: [], future: [] });

/** Record the state that existed *before* a significant change. Clears redo. */
export function pushHistory(h: HistoryState, before: GraphSnapshot): HistoryState {
  const past = [...h.past, before];
  while (past.length > HISTORY_LIMIT) past.shift();
  return { past, future: [] };
}

export function undoHistory(
  h: HistoryState,
  current: GraphSnapshot,
): { history: HistoryState; target: GraphSnapshot } | null {
  if (!h.past.length) return null;
  const target = h.past[h.past.length - 1]!;
  const future = [current, ...h.future].slice(0, HISTORY_LIMIT);
  return { history: { past: h.past.slice(0, -1), future }, target };
}

export function redoHistory(
  h: HistoryState,
  current: GraphSnapshot,
): { history: HistoryState; target: GraphSnapshot } | null {
  if (!h.future.length) return null;
  const [target, ...rest] = h.future as [GraphSnapshot, ...GraphSnapshot[]];
  const past = [...h.past, current];
  while (past.length > HISTORY_LIMIT) past.shift();
  return { history: { past, future: rest }, target };
}

export function mapHistory(
  h: HistoryState,
  fn: (s: GraphSnapshot) => GraphSnapshot,
): HistoryState {
  return { past: h.past.map(fn), future: h.future.map(fn) };
}
