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
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-3 text-sm"
      aria-label="Synthèse opérationnelle"
    >
      <span className="rounded-md border bg-card px-3 py-2 font-bold">
        {active.length} en cours
      </span>
      <span className="rounded-md border border-sev-red/40 bg-sev-red-soft px-3 py-2 font-bold text-sev-red">
        {active.filter((i) => i.recSeverity === "red").length} RED
      </span>
      <span className="rounded-md border bg-card px-3 py-2">
        {active.filter((i) => i.status === "open").length} en attente
      </span>
      <LiveStatus status={status} />
    </div>
  );
}
