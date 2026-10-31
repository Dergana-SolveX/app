import { lazy, Suspense, useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { BarChart3Icon, MapIcon, MousePointerClickIcon, RadioTowerIcon } from "lucide-react";

import { Button } from "@solvex-dergana/ui/components/button";
import { Skeleton } from "@solvex-dergana/ui/components/skeleton";
import { cn } from "@solvex-dergana/ui/lib/utils";
import DispatchForm from "@/components/dispatch-form";
import EvaluationCard from "@/components/evaluation-card";
import { suppressArrivalsFor, useAlertArrivals, type Arrival } from "@/lib/alert-sound";
import { trpc, trpcClient } from "@/utils/trpc";
import { AlertSoundControl } from "./sound-control";
import { DispatcherQueue } from "./queue";
import { DispatcherStats } from "./stats";
import { DispatcherSummary } from "./summary";
import { IncidentDetailPanel, type Correction } from "./detail";
import type { MapFocus } from "./map";
import { isActive } from "./types";

const DispatcherMap = lazy(() => import("./map").then((module) => ({ default: module.DispatcherMap })));

/** Hover comes from the list or the map: only the list moves the map, or the map would chase the pointer. */
type Highlight = { id: string; from: "list" | "map" } | null;

export default function DispatcherWorkspace() {
  const [activeTab, setActiveTab] = useState<"live" | "stats">("live");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [highlight, setHighlight] = useState<Highlight>(null);
  const [focus, setFocus] = useState<MapFocus>(null);
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(() => new Set());
  const queryClient = useQueryClient();
  const incidents = useQuery(trpc.incidents.list.queryOptions());
  const layers = useQuery(
    trpc.incidents.mapLayers.queryOptions(undefined, {
      refetchInterval: 30_000,
      enabled: mapOpen,
    }),
  );
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.incidents.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.incidents.byId.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.incidents.profiles.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.incidents.mapLayers.queryKey() }),
      // The dispatch form carries the incident version: a new alert must refresh it, or approval is refused as stale.
      queryClient.invalidateQueries({ queryKey: trpc.dispatch.recommendation.pathKey() }),
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

  useAlertArrivals(
    incidents.data,
    useCallback((arrivals: Arrival[]) => {
      setUnseen((ids) => new Set([...ids, ...arrivals.map((a) => a.id)]));
    }, []),
  );

  const select = (id: string) => {
    setSelectedId(id);
    setFocus({ id, mode: "hover", nonce: Date.now() });
    setUnseen((ids) => {
      if (!ids.has(id)) return ids;
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
  };
  const highlightFromList = (id: string | null) => {
    setHighlight(id ? { id, from: "list" } : null);
    if (id) setFocus({ id, mode: "hover", nonce: Date.now() });
  };
  const highlightFromMap = (id: string | null) => setHighlight(id ? { id, from: "map" } : null);
  const locate = (id: string) => {
    setMapOpen(true);
    setFocus({ id, mode: "locate", nonce: Date.now() });
  };

  const detail = useQuery(
    trpc.incidents.byId.queryOptions({ id: selectedId ?? "" }, { enabled: selectedId !== null }),
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
    if (!detail.data) throw new Error("Rechargez l'incident avant de le corriger.");
    const input = {
      id: detail.data.id,
      version: detail.data.version,
      reason: action.reason,
    };
    suppressArrivalsFor(10_000);
    try {
      if (action.kind === "false_alarm") await trpcClient.incidents.markFalseAlarm.mutate(input);
      else if (action.kind === "split") {
        const created = await trpcClient.incidents.split.mutate({
          ...input,
          alertIds: action.alertIds,
        });
        setSelectedId(created.id);
      } else {
        const target = incidents.data?.find((i) => i.id === action.targetId);
        if (!target) throw new Error("La destination n'est plus disponible. Actualisez la file.");
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
    }
  }

  const tab = (value: "live" | "stats", label: string, Icon: typeof RadioTowerIcon) => (
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === value}
      onClick={() => setActiveTab(value)}
      className={cn(
        "inline-flex min-h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors",
        activeTab === value
          ? "bg-card text-foreground shadow-xs border border-border"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </button>
  );

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-muted/60 p-1" role="tablist" aria-label="Vue du poste">
          {tab("live", "Opérations directes", RadioTowerIcon)}
          {tab("stats", "Statistiques", BarChart3Icon)}
        </div>
        {activeTab === "live" && (
          <div className="flex flex-wrap items-center gap-2">
            <AlertSoundControl />
            <Button
              variant={mapOpen ? "default" : "outline"}
              aria-pressed={mapOpen}
              onClick={() => setMapOpen((open) => !open)}
            >
              <MapIcon aria-hidden="true" />
              {mapOpen ? "Masquer la carte" : "Afficher la carte"}
            </Button>
          </div>
        )}
      </div>

      {activeTab === "stats" ? (
        <DispatcherStats />
      ) : (
        <>
          {incidents.isPending ? (
            <p role="status" className="text-muted-foreground">
              Chargement des alertes…
            </p>
          ) : incidents.isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-sev-red/40 bg-sev-red-soft p-4 text-sev-red">
              <p className="font-semibold">Impossible de charger les alertes.</p>
              <Button variant="outline" size="sm" onClick={() => incidents.refetch()}>
                Réessayer
              </Button>
            </div>
          ) : (
            <DispatcherSummary incidents={incidents.data} status={stream.status} />
          )}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-4">
              <DispatcherQueue
                incidents={incidents.data ?? []}
                selectedId={selectedId}
                onSelect={select}
                highlightedId={highlight?.id ?? null}
                onHighlight={highlightFromList}
                onLocate={locate}
                unseenIds={unseen}
              />
            </div>
            <div className="min-w-0 space-y-4">
              {mapOpen && (
                <div className="min-w-0">
                  {layers.isError && (
                    <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-sev-yellow/40 bg-sev-yellow-soft p-3 text-sm text-sev-yellow">
                      <p className="font-medium">Unités, hôpitaux et zones indisponibles.</p>
                      <Button variant="outline" size="sm" onClick={() => layers.refetch()}>
                        Recharger la carte
                      </Button>
                    </div>
                  )}
                  <Suspense fallback={<Skeleton className="h-[440px] w-full rounded-lg" />}>
                    <DispatcherMap
                      incidents={(incidents.data ?? []).filter(isActive)}
                      layers={layers.data ?? { units: [], hospitals: [], zones: [] }}
                      selectedId={selectedId}
                      onSelect={select}
                      highlightedId={highlight?.id ?? null}
                      onHighlight={highlightFromMap}
                      focus={focus}
                      onClose={() => setMapOpen(false)}
                    />
                  </Suspense>
                </div>
              )}
              {!selectedId ? (
                <div className="grid place-items-center gap-2 rounded-lg border border-dashed bg-card/60 px-6 py-14 text-center">
                  <span className="grid size-12 place-items-center rounded-full bg-brand-soft text-brand-soft-foreground">
                    <MousePointerClickIcon className="size-6" aria-hidden="true" />
                  </span>
                  <p className="font-semibold">Sélectionnez une alerte</p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Choisissez une alerte dans la file pour l'évaluer et décider du dispatch. Le bouton carte de chaque alerte
                    montre sa position.
                  </p>
                </div>
              ) : detail.isPending ? (
                <Skeleton className="h-64 w-full rounded-lg" aria-label="Chargement de l'incident" />
              ) : detail.isError ? (
                <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-sev-red/40 bg-sev-red-soft p-4 text-sev-red">
                  <p className="font-semibold">{detail.error.message}</p>
                  <Button variant="outline" size="sm" onClick={() => detail.refetch()}>
                    Réessayer
                  </Button>
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
                  evaluation={
                    <div className="space-y-4">
                      <EvaluationCard incidentId={detail.data.id} />
                      {isActive(detail.data) && <DispatchForm key={detail.data.id} incidentId={detail.data.id} />}
                    </div>
                  }
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
