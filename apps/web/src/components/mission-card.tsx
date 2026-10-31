import { Button } from "@solvex-dergana/ui/components/button";
import { SeverityBadge } from "@solvex-dergana/ui/components/severity-badge";
import { Skeleton } from "@solvex-dergana/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { AlertTriangleIcon, ClipboardListIcon, FlagIcon, InboxIcon, MapPinIcon, UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { placeLabel } from "@/lib/place";
import { incidentRef, timeAgo } from "@/lib/time";
import { trpc } from "@/utils/trpc";

const UNIT_NAMES: Record<string, string> = {
  ambulance_medicalisee: "Ambulance médicalisée",
  desincarceration: "Désincarcération",
  vsav_standard: "VSAV",
};

/**
 * The mission screen of the ambulance tablet (FR-S6-01): where to go, what the dispatcher said, who the victim may be.
 * It listens to the unit's own live channel, so a dispatch appears without reloading.
 */
export default function MissionCard({
  unitId,
  onOpenBilan,
}: {
  unitId: string;
  onOpenBilan: (incidentId: string) => void;
}) {
  const queryClient = useQueryClient();
  const mission = useQuery(trpc.dispatch.currentMission.queryOptions({ unitId }));

  // Snapshot + stream: on `ready`, `resync` and every assignment, fetch the mission again.
  useSubscription(
    trpc.dispatch.onUnit.subscriptionOptions(
      { unitId },
      { onData: () => queryClient.invalidateQueries({ queryKey: trpc.dispatch.currentMission.queryKey({ unitId }) }) },
    ),
  );
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHeaderEl(document.getElementById("header-center"));
  }, []);

  const arrive = useMutation(
    trpc.dispatch.arrive.mutationOptions({
      onSuccess: () => toast.success("Arrivée enregistrée : l'incident est sur les lieux."),
      onError: (error) => toast.error(error.message),
      onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.dispatch.currentMission.queryKey({ unitId }) }),
    }),
  );

  const current = mission.data ?? null;

  return (
    <>
      {headerEl && mission.isPending &&
        createPortal(<Skeleton className="h-8 w-44" aria-hidden="true" />, headerEl)}
      {headerEl && mission.isSuccess && mission.data === null &&
        createPortal(
          <p
            role="status"
            className="inline-flex min-h-8 max-w-full items-center gap-2 rounded-md border bg-card px-3 text-xs font-semibold text-muted-foreground"
          >
            <InboxIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Aucune mission pour l'instant</span>
          </p>,
          headerEl,
        )}

      {mission.isError && (
        <p role="alert" className="text-sm text-destructive">
          Mission indisponible : {mission.error.message}
        </p>
      )}

      {mission.isSuccess && current && (
        <section className="p-4 pb-0 md:p-6 md:pb-0">
          <article
            aria-label={`Incident ${incidentRef(current.incidentId)}`}
            className="max-w-3xl space-y-4 rounded-lg border bg-card p-4"
          >
          <header className="flex flex-wrap items-center gap-3">
            <SeverityBadge severity={current.severity} />
            <h3 className="font-mono text-base font-bold">#{incidentRef(current.incidentId)}</h3>
            <span className="ms-auto text-sm font-semibold">
              {current.status === "on_scene" ? "Sur les lieux" : "En route vers l'incident"}
            </span>
          </header>

          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base">
            <span className="inline-flex items-center gap-1.5">
              <MapPinIcon className="size-5" aria-hidden="true" />
              <span className="font-mono font-semibold">{placeLabel(current.location)}</span>
              {current.location.commune && current.location.geohash8 && (
                <span className="text-muted-foreground">· {current.location.commune}</span>
              )}
            </span>
            {current.victims !== null && (
              <span className="inline-flex items-center gap-1.5">
                <UsersIcon className="size-5" aria-hidden="true" />
                {current.victims} victime{current.victims > 1 ? "s" : ""}
              </span>
            )}
          </p>
          {current.location.lat !== null && current.location.lng !== null && (
            <p className="tabular font-mono text-sm text-muted-foreground">
              {current.location.lat.toFixed(5)}, {current.location.lng.toFixed(5)}
              {current.location.uncertaintyM ? ` (± ${current.location.uncertaintyM} m)` : ""}
            </p>
          )}

          {current.notes && (
            <p className="flex items-start gap-2 rounded-md border bg-raised p-3 text-sm">
              <ClipboardListIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                <strong>Consignes du dispatch :</strong> {current.notes}
              </span>
            </p>
          )}

          {current.profileBanner && (
            <div
              role="note"
              className="rounded-md border border-sev-red/40 bg-sev-red-soft p-3 text-sm text-sev-red"
            >
              <p className="flex items-center gap-2 font-bold">
                <AlertTriangleIcon className="size-4" aria-hidden="true" />
                Profil médical lié à cet incident
              </p>
              <ul className="mt-1 list-disc ps-5">
                {current.profileBanner.flags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
                {current.profileBanner.prepTags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Unités :{" "}
            {current.units.map((unit) => `${unit.callSign} (${UNIT_NAMES[unit.type] ?? unit.type})`).join(", ")} ·
            dispatché par {current.dispatcherName ?? "le dispatch"} {timeAgo(current.dispatchedAt)}
          </p>

          <div className="flex flex-wrap gap-3">
            {current.status === "dispatched" && (
              <Button
                size="lg"
                className="min-h-14 flex-1"
                disabled={arrive.isPending}
                onClick={() => arrive.mutate({ incidentId: current.incidentId, unitId })}
              >
                <FlagIcon /> Arrivé sur les lieux
              </Button>
            )}
            <Button
              size="lg"
              variant="outline"
              className="min-h-14 flex-1"
              onClick={() => onOpenBilan(current.incidentId)}
            >
              Ouvrir le bilan secouriste
            </Button>
          </div>
          </article>
        </section>
      )}
    </>
  );
}
