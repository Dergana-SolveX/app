import { lazy, Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { Button } from "@solvex-dergana/ui/components/button";
import { trpc, trpcClient } from "@/utils/trpc";
import { DispatcherQueue } from "./queue";
import { DispatcherSummary } from "./summary";
import { IncidentDetailPanel, type Correction } from "./detail";
import { isActive } from "./types";

const DispatcherMap = lazy(() =>
  import("./map").then((module) => ({ default: module.DispatcherMap })),
);

export default function DispatcherWorkspace() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const incidents = useQuery(trpc.incidents.list.queryOptions());
  const layers = useQuery(
    trpc.incidents.mapLayers.queryOptions(undefined, {
      refetchInterval: 30_000,
    }),
  );
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.incidents.list.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.incidents.byId.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.incidents.mapLayers.queryKey(),
      }),
    ]);
  const stream = useSubscription(
    trpc.incidents.onChange.subscriptionOptions(
      {},
      {
        onData: () => {
          void refresh();
        },
      },
    ),
  );
  const detail = useQuery(
    trpc.incidents.byId.queryOptions(
      { id: selectedId ?? "" },
      { enabled: selectedId !== null },
    ),
  );
  // Refetch on every selection, and discard cached clinical data after leaving the incident.
  const profiles = useQuery(
    trpc.incidents.profiles.queryOptions(
      { id: selectedId ?? "" },
      {
        enabled: selectedId !== null,
        staleTime: 0,
        gcTime: 0,
        refetchOnMount: "always",
      },
    ),
  );
  async function correct(action: Correction) {
    if (!detail.data)
      throw new Error("Rechargez l'incident avant de le corriger.");
    const input = {
      id: detail.data.id,
      version: detail.data.version,
      reason: action.reason,
    };
    try {
      if (action.kind === "false_alarm")
        await trpcClient.incidents.markFalseAlarm.mutate(input);
      else if (action.kind === "split") {
        const created = await trpcClient.incidents.split.mutate({
          ...input,
          alertIds: action.alertIds,
        });
        setSelectedId(created.id);
      } else {
        const target = incidents.data?.find((i) => i.id === action.targetId);
        if (!target)
          throw new Error(
            "La destination n'est plus disponible. Actualisez la file.",
          );
        await trpcClient.incidents.merge.mutate({
          sourceId: input.id,
          sourceVersion: input.version,
          targetId: target.id,
          targetVersion: target.version,
          reason: action.reason,
        });
        setSelectedId(target.id);
      }
    } finally {
      await refresh();
      await queryClient.invalidateQueries({
        queryKey: trpc.incidents.profiles.queryKey(),
      });
    }
  }
  return (
    <div className="p-3 md:p-5">
      {incidents.isPending ? (
        <p role="status">Chargement de la file…</p>
      ) : incidents.isError ? (
        <div role="alert">
          <p>Impossible de charger les incidents.</p>
          <Button onClick={() => incidents.refetch()}>Réessayer</Button>
        </div>
      ) : (
        <DispatcherSummary incidents={incidents.data} status={stream.status} />
      )}
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(220px,0.7fr)_minmax(280px,1fr)_minmax(340px,1fr)]">
        <DispatcherQueue
          incidents={incidents.data ?? []}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <div className="min-w-0">
          {layers.isError && (
            <div role="alert" className="mb-3 rounded-md border p-3">
              <p>Unités, hôpitaux et zones indisponibles.</p>
              <Button variant="outline" onClick={() => layers.refetch()}>
                Recharger la carte
              </Button>
            </div>
          )}
          {layers.isPending && (
            <p role="status">Chargement des unités et des hôpitaux…</p>
          )}
          <Suspense fallback={<p role="status">Chargement de la carte…</p>}>
            <DispatcherMap
              incidents={(incidents.data ?? []).filter(isActive)}
              layers={layers.data ?? { units: [], hospitals: [], zones: [] }}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </Suspense>
        </div>
        {!selectedId ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Sélectionnez un incident dans la file ou sur la carte.
          </div>
        ) : detail.isPending ? (
          <p role="status">Chargement de l'incident…</p>
        ) : detail.isError ? (
          <div role="alert">
            <p>{detail.error.message}</p>
            <Button onClick={() => detail.refetch()}>Réessayer</Button>
          </div>
        ) : (
          <IncidentDetailPanel
            key={detail.data.id}
            incident={detail.data}
            profiles={profiles.data}
            profilesError={
              profiles.error
                ? "Impossible de charger les profils médicaux. Réessayez en sélectionnant l'incident."
                : undefined
            }
            candidates={incidents.data ?? []}
            onCorrect={correct}
          />
        )}
      </div>
    </div>
  );
}
