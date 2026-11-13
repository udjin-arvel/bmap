import { Check } from "lucide-react";

import { COLOR_PALETTE } from "@/lib/bmap/types";
import { cn } from "@/lib/utils";

interface Props {
  value: string | null | undefined;
  onChange: (hex: string | null) => void;
  disabled?: boolean;
  allowNone?: boolean;
}

/** Swatches for the spec's fixed 6-colour palette (colours are data, not theme). */
export function ColorPalette({ value, onChange, disabled, allowNone = true }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Цвет узла">
      {COLOR_PALETTE.map((c) => {
        const active = value?.toUpperCase() === c.hex;
        return (
          <button
            key={c.hex}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={c.label}
            title={c.label}
            disabled={disabled}
            onClick={() => onChange(c.hex)}
            style={{ backgroundColor: c.hex }}
            className={cn(
              "grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-card transition-transform",
              "hover:scale-110 disabled:pointer-events-none disabled:opacity-50",
              active && "ring-2 ring-foreground",
            )}
          >
            {active && <Check className="size-3.5 text-foreground" strokeWidth={3} />}
          </button>
        );
      })}
      {allowNone && (
        <button
          type="button"
          role="radio"
          aria-checked={!value}
          disabled={disabled}
          onClick={() => onChange(null)}
          className={cn(
            "h-7 rounded-full border border-dashed border-input px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50",
            !value && "border-solid border-foreground text-foreground",
          )}
        >
          Без цвета
        </button>
      )}
    </div>
  );
}
