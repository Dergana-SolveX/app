import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { SeverityBadge } from "@solvex-dergana/ui/components/severity-badge";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { incidentRef } from "@/lib/time";
import { isActive, statusLabels, type Incident } from "./types";

type QueueIncident = Pick<
  Incident,
  | "id"
  | "recSeverity"
  | "status"
  | "lat"
  | "lng"
  | "firstAlertAt"
  | "alertCount"
  | "estimatedVictims"
  | "commune"
  | "emulated"
  | "tentative"
>;
export function DispatcherQueue({
  incidents,
  selectedId,
  onSelect,
}: {
  incidents: QueueIncident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const sorted = incidents
    .filter(isActive)
    .toSorted(
      (a, b) =>
        Number(b.recSeverity === "red") - Number(a.recSeverity === "red") ||
        Number(b.status === "open") - Number(a.status === "open") ||
        new Date(b.firstAlertAt).getTime() - new Date(a.firstAlertAt).getTime(),
    );
  const groups = [
    {
      title: "Incidents localisés",
      rows: sorted.filter((i) => i.lat !== null && i.lng !== null),
    },
    {
      title: "Sans position",
      rows: sorted.filter((i) => i.lat === null || i.lng === null),
    },
  ];
  return (
    <aside
      aria-label="File des incidents"
      className="min-w-0 space-y-4 rounded-lg border bg-card p-3 xl:max-h-[calc(100vh-15rem)] xl:overflow-y-auto"
    >
      <h2 className="font-bold">File des incidents</h2>
      {!sorted.length && (
        <p className="py-8 text-sm text-muted-foreground">
          Aucun incident en cours.
        </p>
      )}
      {groups.map(({ title, rows }) => (
        <section key={title} aria-label={title}>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {title} · {rows.length}
          </h3>
          {title === "Sans position" && rows.length > 0 && (
            <p className="mb-2 text-xs text-muted-foreground">
              Rappeler pour préciser la commune ou le point kilométrique.
            </p>
          )}
          <ul className="space-y-2">
            {rows.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  aria-pressed={selectedId === i.id}
                  onClick={() => onSelect(i.id)}
                  className={cn(
                    "w-full rounded-md border p-3 text-start transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
                    selectedId === i.id && "border-primary bg-accent",
                  )}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <SeverityBadge severity={i.recSeverity} />
                    <span className="text-xs text-muted-foreground">
                      {statusLabels[i.status]}
                    </span>
                  </span>
                  <span className="mt-2 block font-bold">
                    {i.commune ?? `Incident #${incidentRef(i.id)}`}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {i.alertCount} alerte(s) · {i.estimatedVictims ?? "?"}{" "}
                    victime(s) ·{" "}
                    {new Date(i.firstAlertAt).toLocaleTimeString("fr-DZ", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {i.emulated && (
                    <span className="mt-2 block">
                      <EmulationBadge />
                    </span>
                  )}
                  {i.tentative && (
                    <span className="mt-1 block text-xs font-bold text-sev-yellow">
                      Fusion à confirmer
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
