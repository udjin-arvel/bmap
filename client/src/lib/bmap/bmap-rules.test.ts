import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseApiError, errorMessage } from "./errors";
import { diffSnapshots, wouldCreateCycle } from "./graph-utils";
import { HISTORY_LIMIT, emptyHistory, pushHistory, redoHistory, undoHistory } from "./history";
import { PendingSaver, SAVE_DEBOUNCE_MS } from "./pending-saver";
import type { GraphSnapshot } from "./types";

const snap = (tag: number): GraphSnapshot => ({
  nodes: [{ id: "a", name: `v${tag}`, nodeType: "PROCESS", positionX: tag, positionY: 0 }],
  edges: [],
});

describe("Undo/Redo history", () => {
  it("keeps at most 5 steps", () => {
    let h = emptyHistory();
    for (let i = 0; i < 8; i++) h = pushHistory(h, snap(i));
    expect(HISTORY_LIMIT).toBe(5);
    expect(h.past).toHaveLength(5);
    expect(h.past[0]!.nodes[0]!.positionX).toBe(3);
  });

  it("undo returns the previous snapshot and redo brings the current one back", () => {
    const h = pushHistory(emptyHistory(), snap(1));
    const u = undoHistory(h, snap(2))!;
    expect(u.target.nodes[0]!.positionX).toBe(1);
    const r = redoHistory(u.history, u.target)!;
    expect(r.target.nodes[0]!.positionX).toBe(2);
  });

  it("a new change clears redo", () => {
    const u = undoHistory(pushHistory(emptyHistory(), snap(1)), snap(2))!;
    expect(pushHistory(u.history, snap(3)).future).toHaveLength(0);
  });
});

describe("Edge rules", () => {
  const edges = [
    { sourceId: "a", targetId: "b" },
    { sourceId: "b", targetId: "c" },
  ];
  it("rejects a link that closes a cycle", () => {
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
  });
  it("allows a link that keeps the graph acyclic", () => {
    expect(wouldCreateCycle(edges, "a", "c")).toBe(false);
  });
  it("maps backend error codes to Russian toasts", () => {
    expect(errorMessage(parseApiError(400, { detail: "x", code: "CYCLE_DETECTED" }))).toMatch(/цикл/);
    expect(parseApiError(400, { detail: { code: "DUPLICATE_EDGE" } }).code).toBe("DUPLICATE_EDGE");
  });
});

describe("Undo of a node deletion", () => {
  it("restores the node and its links", () => {
    const before: GraphSnapshot = {
      nodes: [
        { id: "a", name: "A", nodeType: "ACTOR", positionX: 0, positionY: 0 },
        { id: "b", name: "B", nodeType: "RESOURCE", positionX: 1, positionY: 0 },
      ],
      edges: [{ id: "e1", sourceId: "a", targetId: "b" }],
    };
    const after: GraphSnapshot = { nodes: [before.nodes[0]!], edges: [] };
    const d = diffSnapshots(after, before);
    expect(d.createNodes.map((n) => n.id)).toEqual(["b"]);
    expect(d.createEdges.map((e) => e.id)).toEqual(["e1"]);
    // deleting a node does not separately delete its edges (server cascades)
    expect(diffSnapshots(before, after).deleteEdgeIds).toEqual([]);
  });
});

describe("Debounced save", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends one merged PATCH 800 ms after the last change", async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    const s = new PendingSaver(patch);
    s.schedule("a", { positionX: 1 });
    vi.advanceTimersByTime(500);
    s.schedule("a", { positionY: 2 });
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1);
    expect(patch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(SAVE_DEBOUNCE_MS).toBe(800);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("a", { positionX: 1, positionY: 2 });
  });

  it("drain hands unsent changes to the beacon and cancels the timer", async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    const s = new PendingSaver(patch);
    s.schedule("a", { note: "x" });
    expect(s.drain()).toEqual([{ id: "a", note: "x" }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(patch).not.toHaveBeenCalled();
  });
});
