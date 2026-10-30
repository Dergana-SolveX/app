import { Button } from "@solvex-dergana/ui/components/button";
import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { SeverityBadge } from "@solvex-dergana/ui/components/severity-badge";
import { Skeleton } from "@solvex-dergana/ui/components/skeleton";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useSubscription } from "@trpc/tanstack-react-query";
import { GitMergeIcon, InboxIcon, MapPinIcon, UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";

import LiveStatus from "@/components/live-status";
import { incidentRef, timeAgo } from "@/lib/time";
import { trpc } from "@/utils/trpc";

/** A new incident stays highlighted for this long. */
const FRESH_MS = 15_000;

/** How much to trust the incident, as a bar and as a number (never the bar alone). */
function ConfidenceMeter({ score }: { score: number }) {
  const percent = Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score * 100))) : 0;
  return (
    <div className="flex items-center gap-2" title="Confiance dans l'incident, selon le nombre et le type d'alertes">
      <div
        role="meter"
        aria-label="Confiance"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent} %`}
        className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      {/* The meter above already announces the value to screen readers. */}
      <span aria-hidden="true" className="tabular font-mono text-xs text-muted-foreground">
        Confiance {percent} %
      </span>
    </div>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export default function IncidentQueue({ canOpenConsole }: { canOpenConsole: boolean }) {
  const queryClient = useQueryClient();
  const now = useNow(5_000);
  const incidents = useQuery(trpc.incidents.list.queryOptions());

  // Snapshot + stream: on `ready`, `resync` and every change, fetch the list again.
  const stream = useSubscription(
    trpc.incidents.onChange.subscriptionOptions(
      {},
      {
        onData: () =>
          queryClient.invalidateQueries({ queryKey: trpc.incidents.list.queryKey() }),
      },
    ),
  );

  const open = (incidents.data ?? []).filter((i) => i.status !== "closed" && i.status !== "false_alarm");

  return (
    <section aria-labelledby="queue-title" className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="queue-title" className="text-base font-bold">
            File des incidents
          </h2>
          {/* One contextual status line for screen readers, not a bare number. */}
          <p role="status" className="text-sm text-muted-foreground">
            {incidents.isSuccess
              ? `${open.length} incident${open.length > 1 ? "s" : ""} en cours`
              : "Chargement des incidents…"}
          </p>
        </div>
        <LiveStatus status={stream.status} />
      </div>

      {incidents.isPending && (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {incidents.isError && (
        <div role="alert" className="rounded-lg border border-sev-red/40 bg-sev-red-soft p-4 text-sev-red">
          <p className="font-semibold">Impossible de charger les incidents.</p>
          <Button variant="outline" className="mt-3" onClick={() => incidents.refetch()}>
            Réessayer
          </Button>
        </div>
      )}

      {incidents.isSuccess && open.length === 0 && (
        <div className="grid place-items-center rounded-lg border border-dashed bg-card/60 px-6 py-14 text-center">
          <span className="mb-4 grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
            <InboxIcon className="size-6" aria-hidden="true" />
          </span>
          <p className="text-base font-bold">Aucun incident en cours</p>
          <p className="mt-1 max-w-md text-muted-foreground">
            Les alertes reçues par SMS, application ou puce apparaissent ici en direct.
          </p>
          {canOpenConsole && (
            <Button render={<Link to="/console" />} variant="outline" className="mt-5">
              Simuler une alerte dans la console
            </Button>
          )}
        </div>
      )}

      {open.length > 0 && (
        <ul className="space-y-2">
          {open.map((incident) => {
            const fresh = now.getTime() - new Date(incident.firstAlertAt).getTime() < FRESH_MS;
            return (
              <li
                key={incident.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-4 py-3 transition-colors",
                  fresh && "border-primary bg-accent",
                )}
              >
                <SeverityBadge severity={incident.recSeverity} />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-bold tracking-wide">
                    #{incidentRef(incident.id)}
                    {fresh && (
                      <span className="ms-2 rounded bg-primary px-1.5 py-0.5 font-sans text-[0.68rem] font-bold tracking-wider text-primary-foreground uppercase">
                        Nouveau
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {incident.alertCount} alerte{incident.alertCount > 1 ? "s" : ""} · {timeAgo(incident.firstAlertAt, now)}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPinIcon className="size-4" aria-hidden="true" />
                  <span className="font-mono">{incident.geohash8 ?? "position inconnue"}</span>
                </span>
                {incident.estimatedVictims !== null && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <UsersIcon className="size-4" aria-hidden="true" />
                    {incident.estimatedVictims}
                    {incident.estimatedVictims >= 9 ? "+" : ""} victime{incident.estimatedVictims > 1 ? "s" : ""}
                  </span>
                )}
                <ConfidenceMeter score={Number(incident.confidenceScore)} />
                {incident.tentative && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md border border-sev-yellow/40 bg-sev-yellow-soft px-2 py-0.5 text-xs font-bold text-sev-yellow"
                    title="Une alerte a été rattachée à cet incident par proximité approximative. À confirmer."
                  >
                    <GitMergeIcon className="size-3.5" aria-hidden="true" />
                    Fusion à confirmer
                  </span>
                )}
                {/* Honesty rule: an incident born from the emulated GSM network must say so. */}
                {incident.emulated && <EmulationBadge />}
                <span className="rounded-md border px-2 py-0.5 text-xs font-semibold text-muted-foreground uppercase">
                  Ouvert
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
