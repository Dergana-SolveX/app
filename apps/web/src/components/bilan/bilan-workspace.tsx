import { SeverityBadge } from "@solvex-dergana/ui/components/severity-badge";
import { Button } from "@solvex-dergana/ui/components/button";
import { Skeleton } from "@solvex-dergana/ui/components/skeleton";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, InboxIcon, PlusIcon, UserRoundIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { incidentRef, timeAgo } from "@/lib/time";
import { trpc } from "@/utils/trpc";

import { BilanForm } from "./bilan-form";
import { draftFromSaved, emptyDraft, type Draft } from "./draft";

function IncidentPicker({ onPick }: { onPick: (incidentId: string) => void }) {
  const incidents = useQuery(trpc.assessments.openIncidents.queryOptions());
  return (
    <section aria-labelledby="pick-title" className="p-4 md:p-6">
      <h2 id="pick-title" className="text-base font-bold">Choisir l'incident</h2>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        La mission n'est pas encore envoyée à l'ambulance par le dispatch : en attendant, choisissez ici l'incident sur lequel vous intervenez.
      </p>
      {incidents.isPending && <Skeleton className="h-20 w-full max-w-xl" />}
      {incidents.isError && <p role="alert" className="text-sm text-destructive">Impossible de charger les incidents : {incidents.error.message}</p>}
      {incidents.isSuccess && incidents.data.length === 0 && (
        <div className="grid max-w-xl place-items-center rounded-lg border border-dashed bg-card/60 px-6 py-10 text-center">
          <InboxIcon className="mb-2 size-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-semibold">Aucun incident en cours</p>
          <p className="text-sm text-muted-foreground">Envoyez une alerte depuis la console (« Réseau GSM (émulé) ») pour en créer un.</p>
        </div>
      )}
      <ul className="flex max-w-xl flex-col gap-2">
        {incidents.data?.map((incident) => (
          <li key={incident.id}>
            <button
              type="button"
              onClick={() => onPick(incident.id)}
              className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border bg-card px-4 text-start transition-colors duration-150 outline-none hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span>
                <span className="tabular block font-mono text-sm font-bold">{incidentRef(incident.id)}</span>
                <span className="text-xs text-muted-foreground">
                  {incident.alertCount} alerte{incident.alertCount > 1 ? "s" : ""} · {timeAgo(incident.firstAlertAt)}
                </span>
              </span>
              <SeverityBadge severity={incident.recSeverity} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function VictimWorkspace({ incidentId, unitId, onBack }: { incidentId: string; unitId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const mission = useQuery(trpc.assessments.mission.queryOptions({ incidentId }));
  const [drafts, setDrafts] = useState<Record<number, Draft>>({ 1: emptyDraft() });
  const [active, setActive] = useState(1);

  // Saved victims come back as drafts once, when the mission first loads.
  const loaded = mission.data?.incident.id;
  useEffect(() => {
    const saved = mission.data?.assessments;
    if (!saved || saved.length === 0) return;
    setDrafts(Object.fromEntries(saved.map((row) => [row.victimIndex, draftFromSaved(row)])));
    setActive(saved[0]!.victimIndex);
    // Only when a different mission arrives, never on a refetch: that would erase what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const save = useMutation(
    trpc.assessments.save.mutationOptions({
      onSuccess: (result) => {
        const index = result.shockIndex;
        toast.success(
          `Bilan enregistré${index?.value != null ? ` · indice de choc ${index.value.toFixed(2).replace(".", ",")}` : ""}${result.vittel.severe ? " · traumatisé grave" : ""}`,
        );
        queryClient.invalidateQueries({ queryKey: trpc.assessments.mission.queryKey({ incidentId }) });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (mission.isPending) return <div className="p-4 md:p-6"><Skeleton className="h-40 w-full" /></div>;
  if (mission.isError) {
    return <p role="alert" className="p-4 text-sm text-destructive md:p-6">Impossible de charger l'incident : {mission.error.message}</p>;
  }

  const victims = Object.keys(drafts).map(Number).sort((a, b) => a - b);
  const draft = drafts[active] ?? emptyDraft();
  const update = (next: Draft) => setDrafts((current) => ({ ...current, [active]: next }));
  const addVictim = () => {
    const next = Math.max(...victims) + 1;
    setDrafts((current) => ({ ...current, [next]: emptyDraft() }));
    setActive(next);
  };

  const submit = () =>
    save.mutate({
      incidentId,
      unitId,
      victimIndex: active,
      profileId: draft.profileId ?? undefined,
      estAge: draft.profileId ? undefined : (draft.estAge ?? undefined),
      sex: draft.profileId ? undefined : draft.sex,
      vittel: draft.medic,
      gcs: draft.gcs ?? undefined,
      hr: draft.hr ?? undefined,
      sbp: draft.sbp ?? undefined,
      dbp: draft.dbp ?? undefined,
      spo2: draft.spo2 ?? undefined,
      rr: draft.rr ?? undefined,
      suspectedInjuries: draft.injuries,
      treatments: draft.treatments,
    });

  return (
    <section aria-label="Bilan secouriste" className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeftIcon className="rtl:rotate-180" aria-hidden="true" />
          Autre incident
        </Button>
        <p className="tabular font-mono text-sm font-bold">Incident {incidentRef(incidentId)}</p>
        <SeverityBadge severity={mission.data.incident.recSeverity} />
      </div>

      <div role="tablist" aria-label="Victimes" className="mb-4 flex flex-wrap gap-2">
        {victims.map((n) => (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={n === active}
            onClick={() => setActive(n)}
            className={cn(
              "inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-md border px-4 text-sm font-bold transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              n === active ? "border-primary bg-accent text-accent-foreground" : "border-input bg-card hover:border-primary/60",
            )}
          >
            <UserRoundIcon className="size-4" aria-hidden="true" />
            Victime {n}
          </button>
        ))}
        <Button type="button" variant="outline" size="lg" onClick={addVictim}>
          <PlusIcon aria-hidden="true" />
          Ajouter une victime
        </Button>
      </div>

      <div className="max-w-4xl">
        <BilanForm
          key={active}
          draft={draft}
          onChange={update}
          profiles={mission.data.profiles}
          sensors={mission.data.incident.vittelPrefill}
          onSave={submit}
          saving={save.isPending}
          now={new Date()}
        />
      </div>
    </section>
  );
}

export default function BilanWorkspace({ unitId }: { unitId: string }) {
  const [incidentId, setIncidentId] = useState<string | null>(null);
  if (!incidentId) return <IncidentPicker onPick={setIncidentId} />;
  return <VictimWorkspace incidentId={incidentId} unitId={unitId} onBack={() => setIncidentId(null)} />;
}
