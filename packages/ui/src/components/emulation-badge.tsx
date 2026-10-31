import { cn } from "@solvex-dergana/ui/lib/utils";
import { FlaskConicalIcon } from "lucide-react";

/** Honesty rule: anything simulated carries this badge. Default text is "ÉMULATION". */
export function EmulationBadge({
  children = "ÉMULATION",
  className,
}: {
  children?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-emulation/40 bg-emulation-soft px-2.5 py-0.5 text-xs font-semibold text-emulation",
        className,
      )}
    >
      <FlaskConicalIcon className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}
