import { cn } from "@solvex-dergana/ui/lib/utils";
import { CircleAlertIcon, CircleCheckIcon, CircleHelpIcon, TriangleAlertIcon } from "lucide-react";

export type Severity = "red" | "yellow" | "green" | "unknown";

const STYLES: Record<Severity, { label: string; className: string; Icon: typeof CircleAlertIcon }> = {
  red: { label: "Rouge", className: "bg-sev-red-soft text-sev-red border-sev-red/40", Icon: CircleAlertIcon },
  yellow: { label: "Jaune", className: "bg-sev-yellow-soft text-sev-yellow border-sev-yellow/40", Icon: TriangleAlertIcon },
  green: { label: "Vert", className: "bg-sev-green-soft text-sev-green border-sev-green/40", Icon: CircleCheckIcon },
  unknown: { label: "Inconnu", className: "bg-sev-unknown-soft text-sev-unknown border-sev-unknown/40", Icon: CircleHelpIcon },
};

/** Triage severity. Always shows an icon and a word, never color alone. UNKNOWN is never green. */
export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const { label, className: tone, Icon } = STYLES[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        tone,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
