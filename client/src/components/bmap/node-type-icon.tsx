import { Building2, Cog, Package, Truck, type LucideProps } from "lucide-react";

import type { NodeType } from "@/lib/bmap/types";

const ICONS = { PROCESS: Cog, ACTOR: Building2, RESOURCE: Package, LOGISTICS: Truck } as const;

export function NodeTypeIcon({ type, ...props }: { type: NodeType } & LucideProps) {
  const Icon = ICONS[type] ?? Cog;
  return <Icon {...props} />;
}
