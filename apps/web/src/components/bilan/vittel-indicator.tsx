import type { VittelResult } from "@solvex-dergana/shared";
import { CircleAlertIcon } from "lucide-react";
import { useState } from "react";

export function VittelIndicator({ victim, result }: { victim: number; result: VittelResult }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  if (!result.severe) return null;

  const show = () => setOpen(true);
  const hide = () => {
    if (!pinned) setOpen(false);
  };
  const toggle = () => {
    const next = !pinned;
    setPinned(next);
    setOpen(next);
  };

  return (
    <span className="absolute end-1 top-1/2 z-20 -translate-y-1/2">
      <button
        type="button"
        aria-label={`Détails Vittel de la victime ${victim}`}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={() => {
          setPinned(false);
          setOpen(false);
        }}
        className="grid size-8 cursor-pointer place-items-center rounded-md border border-sev-red/50 bg-sev-red-soft text-sev-red outline-none transition-colors hover:bg-sev-red/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <CircleAlertIcon className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute start-full top-0 z-50 ms-2 w-72 rounded-lg border border-sev-red/40 bg-popover p-3 text-start text-popover-foreground shadow-lg"
        >
          <span className="flex items-center gap-2 text-sm font-bold text-sev-red">
            <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
            Traumatisé grave (Vittel)
          </span>
          <span className="mt-2 block text-xs font-semibold text-foreground">
            {result.positives.map((positive) => (
              <span key={`${positive.level}.${positive.id}`} className="mt-1 block">
                • {positive.label}
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}
