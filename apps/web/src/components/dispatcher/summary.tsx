import { CircleAlertIcon, ClockIcon, SirenIcon } from "lucide-react";

import LiveStatus, { type StreamStatus } from "@/components/live-status";
import { isActive, type Incident } from "./types";

export function DispatcherSummary({
  incidents,
  status,
}: {
  incidents: Pick<Incident, "status" | "recSeverity">[];
  status: StreamStatus;
}) {
  const active = incidents.filter(isActive);
  const red = active.filter((i) => i.recSeverity === "red").length;
  const waiting = active.filter((i) => i.status === "open").length;
  const tile =
    "flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm";
  return (
    <div
      className="flex shrink-0 flex-nowrap items-center gap-2"
      aria-label="Synthèse opérationnelle"
    >
      <span className={`${tile} bg-card font-semibold shadow-xs`}>
        <SirenIcon className="size-4 text-primary" aria-hidden="true" />
        <span className="tabular text-base">{active.length}</span> en cours
      </span>
      <span
        className={`${tile} border-sev-red/40 bg-sev-red-soft font-semibold text-sev-red`}
      >
        <CircleAlertIcon className="size-4" aria-hidden="true" />
        <span className="tabular text-base">{red}</span> RED
      </span>
      <span className={`${tile} bg-card shadow-xs`}>
        <ClockIcon
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="tabular text-base font-semibold">{waiting}</span> en
        attente
      </span>
      {status !== "pending" && <LiveStatus status={status} />}
    </div>
  );
}
