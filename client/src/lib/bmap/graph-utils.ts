import type { GraphSnapshot, MarketEdge, MarketNode, NodeUpdate } from "./types";

/** True if adding source→target would close a cycle (target already reaches source). */
export function wouldCreateCycle(
  edges: Pick<MarketEdge, "sourceId" | "targetId">[],
  sourceId: string,
  targetId: string,
): boolean {
  if (sourceId === targetId) return true;
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.sourceId);
    if (list) list.push(e.targetId);
    else out.set(e.sourceId, [e.targetId]);
  }
  const stack = [targetId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === sourceId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of out.get(cur) ?? []) stack.push(next);
  }
  return false;
}

const PATCH_FIELDS = [
  "name",
  "description",
  "color",
  "note",
  "positionX",
  "positionY",
  "descriptionPinned",
] as const;

export interface SnapshotDiff {
  createNodes: MarketNode[];
  deleteNodeIds: string[];
  patchNodes: { id: string; patch: NodeUpdate }[];
  createEdges: MarketEdge[];
  deleteEdgeIds: string[];
}

/** What has to be sent to the server to turn `from` into `to`. */
export function diffSnapshots(from: GraphSnapshot, to: GraphSnapshot): SnapshotDiff {
  const fromNodes = new Map(from.nodes.map((n) => [n.id, n]));
  const toNodes = new Map(to.nodes.map((n) => [n.id, n]));
  const fromEdges = new Map(from.edges.map((e) => [e.id, e]));
  const toEdges = new Map(to.edges.map((e) => [e.id, e]));

  const createNodes = to.nodes.filter((n) => !fromNodes.has(n.id));
  const deleteNodeIds = from.nodes.filter((n) => !toNodes.has(n.id)).map((n) => n.id);
  const deletedSet = new Set(deleteNodeIds);

  const patchNodes: SnapshotDiff["patchNodes"] = [];
  for (const n of to.nodes) {
    const prev = fromNodes.get(n.id);
    if (!prev) continue;
    const patch: NodeUpdate = {};
    for (const f of PATCH_FIELDS) {
      const a = prev[f] ?? null;
      const b = n[f] ?? null;
      if (a !== b) (patch as Record<string, unknown>)[f] = b;
    }
    if (Object.keys(patch).length) patchNodes.push({ id: n.id, patch });
  }

  const createEdges = to.edges.filter((e) => !fromEdges.has(e.id));
  // Edges attached to deleted nodes are removed by the server together with the node.
  const deleteEdgeIds = from.edges
    .filter((e) => !toEdges.has(e.id))
    .filter((e) => !deletedSet.has(e.sourceId) && !deletedSet.has(e.targetId))
    .map((e) => e.id);

  return { createNodes, deleteNodeIds, patchNodes, createEdges, deleteEdgeIds };
}

export function remapSnapshot(
  snap: GraphSnapshot,
  nodeIds: Map<string, string>,
  edgeIds: Map<string, string>,
): GraphSnapshot {
  if (!nodeIds.size && !edgeIds.size) return snap;
  const n = (id: string) => nodeIds.get(id) ?? id;
  return {
    nodes: snap.nodes.map((node) => (nodeIds.has(node.id) ? { ...node, id: n(node.id) } : node)),
    edges: snap.edges.map((e) => ({
      ...e,
      id: edgeIds.get(e.id) ?? e.id,
      sourceId: n(e.sourceId),
      targetId: n(e.targetId),
    })),
  };
}
