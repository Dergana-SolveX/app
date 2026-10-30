import { cn } from "@solvex-dergana/ui/lib/utils";
import type { ShockIndex } from "@solvex-dergana/shared";
import { CircleAlertIcon, CircleCheckIcon, CircleHelpIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";

const FLAGS = {
  normal: { word: "Normal", tone: "border-sev-green/40 bg-sev-green-soft text-sev-green", Icon: CircleCheckIcon },
  elevated: { word: "Élevé", tone: "border-sev-yellow/40 bg-sev-yellow-soft text-sev-yellow", Icon: TriangleAlertIcon },
  critical: { word: "Critique", tone: "border-sev-red/40 bg-sev-red-soft text-sev-red", Icon: CircleAlertIcon },
} as const;

/** Live Shock Index (heart rate / systolic pressure). Announced politely each time it changes. */
export function ShockIndexBadge({ result }: { result: ShockIndex | null }) {
  if (!result) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-lg border border-sev-unknown/40 bg-sev-unknown-soft px-3 py-2 text-sev-unknown"
      >
        <CircleHelpIcon className="size-5 shrink-0" aria-hidden="true" />
        <p className="text-sm font-semibold">Indice de choc : saisir la FC et la PAS</p>
      </div>
    );
  }
  const { word, tone, Icon } = FLAGS[result.flag];
  const shown = result.value === null ? "—" : result.value.toFixed(2).replace(".", ",");
  return (
    <div role="status" className={cn("rounded-lg border px-3 py-2", tone)}>
      <div className="flex items-center gap-2">
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        <p className="text-sm font-semibold">
          Indice de choc <span className="tabular font-mono text-xl font-extrabold">{shown}</span>{" "}
          <span className="font-bold uppercase">{word}</span>
        </p>
      </div>
      {result.caveats.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1 text-sm text-foreground">
          {result.caveats.map((caveat) => (
            <li key={caveat} className="flex items-start gap-1.5">
              <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {caveat}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
