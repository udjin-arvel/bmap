export const NODE_TYPES = ["PROCESS", "ACTOR", "RESOURCE", "LOGISTICS"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Palette is fixed by the spec and validated on the backend. */
export const COLOR_PALETTE = [
  { hex: "#4A90D9", label: "Синий" },
  { hex: "#E67E22", label: "Оранжевый" },
  { hex: "#27AE60", label: "Зелёный" },
  { hex: "#8E44AD", label: "Фиолетовый" },
  { hex: "#C0392B", label: "Красный" },
  { hex: "#7F8C8D", label: "Серый" },
] as const;
export const PALETTE_HEX: string[] = COLOR_PALETTE.map((c) => c.hex);

export const NODE_TYPE_META: Record<NodeType, { label: string; hint: string }> = {
  PROCESS: { label: "Процесс", hint: "Действие / этап" },
  ACTOR: { label: "Актор", hint: "Участник / исполнитель" },
  RESOURCE: { label: "Ресурс", hint: "Объект / материал" },
  LOGISTICS: { label: "Логистика", hint: "Перемещение" },
};

export type Role = "viewer" | "editor";

export type NodeOrigin = "base" | "user" | "ai";

export interface MarketNode {
  id: string;
  name: string;
  nodeType: NodeType;
  description?: string | null | undefined;
  color?: string | null | undefined;
  note?: string | null | undefined;
  positionX: number;
  positionY: number;
  descriptionPinned?: boolean | undefined;
  hasDescription?: boolean | undefined;
  isBase?: boolean | undefined;
  origin?: NodeOrigin | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}

export interface GraphRoot {
  id: string;
  name: string;
  isBase: boolean;
  childCount: number;
}

export interface MarketEdge {
  id: string;
  sourceId: string;
  targetId: string;
  createdAt?: string | undefined;
}

export interface GraphSnapshot {
  nodes: MarketNode[];
  edges: MarketEdge[];
}

export interface NodeCreate {
  /** Optional id hint (used when restoring via Undo); the server may ignore it. */
  id?: string | undefined;
  name: string;
  nodeType: NodeType;
  description?: string | null | undefined;
  color?: string | null | undefined;
  note?: string | null | undefined;
  positionX: number;
  positionY: number;
}

export type NodeUpdate = Partial<
  Pick<
    MarketNode,
    "name" | "description" | "color" | "note" | "positionX" | "positionY" | "descriptionPinned"
  >
>;

export interface BatchPatchItem extends NodeUpdate {
  id: string;
}

export interface EdgeCreate {
  sourceId: string;
  targetId: string;
}

export interface AuthUser {
  username: string;
  role: Role;
}

export interface AiJobResult {
  jobId: string;
  nodeId: string;
  status: "queued" | "running" | "completed" | "error";
  error?: string | null;
  nodes?: MarketNode[] | null;
  edges?: MarketEdge[] | null;
}
