import type { Edge, Node } from "@xyflow/react";

import type { MarketEdge } from "./types";

const COLLAPSED_KEY = "bmap.collapsed";

export function loadCollapsedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function saveCollapsedIds(ids: Set<string>) {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
}

/** Hide descendants of collapsed nodes (client-only, no refetch). */
export function applyCollapsedView<N extends Node>(
  nodes: N[],
  edges: Edge[],
  collapsed: Set<string>,
): { nodes: N[]; edges: Edge[] } {
  if (!collapsed.size) return { nodes, edges };

  const children = new Map<string, string[]>();
  for (const e of edges) {
    const list = children.get(e.source);
    if (list) list.push(e.target);
    else children.set(e.source, [e.target]);
  }

  const hidden = new Set<string>();
  const stack = [...collapsed];
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of children.get(id) ?? []) {
      if (!hidden.has(child)) {
        hidden.add(child);
        stack.push(child);
      }
    }
  }

  const visibleNodes = nodes.filter((n) => !hidden.has(n.id));
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
  return { nodes: visibleNodes, edges: visibleEdges };
}

export function childCount(edges: Pick<MarketEdge, "sourceId" | "targetId">[], nodeId: string) {
  return edges.filter((e) => e.sourceId === nodeId).length;
}
