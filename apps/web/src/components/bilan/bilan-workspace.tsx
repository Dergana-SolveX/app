import { assessVictim, type VittelResult } from "@solvex-dergana/shared";
import { SeverityBadge } from "@solvex-dergana/ui/components/severity-badge";
import { Button } from "@solvex-dergana/ui/components/button";
import { Skeleton } from "@solvex-dergana/ui/components/skeleton";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { ArrowLeftIcon, InboxIcon, MinusIcon, PlusIcon, UserRoundIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useOrientationData } from "@/lib/orientation-cache";
import { useRoadGraph } from "@/lib/road-graph";
import { incidentRef, timeAgo } from "@/lib/time";
import { trpc } from "@/utils/trpc";

import { BilanForm } from "./bilan-form";
import { draftFromSaved, emptyDraft, type Draft } from "./draft";
import { VittelIndicator } from "./vittel-indicator";

function IncidentPicker({ onPick }: { onPick: (incidentId: string) => void }) {
  const incidents = useQuery(trpc.assessments.openIncidents.queryOptions());
  return (
    <section aria-labelledby="pick-title" className="p-4 md:p-6">
      <h2 id="pick-title" className="text-base font-bold">Choisir l'incident</h2>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Sans mission reçue du dispatch, choisissez ici l'incident sur lequel vous intervenez.
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
  // Taken once: the age a profile gives must not change under the medic between renders.
  const [now] = useState(() => new Date());
  const orientationData = useOrientationData(unitId);
  const graph = useRoadGraph();
  // The saved bilan of each victim: what a handover is attached to.
  const [assessmentIds, setAssessmentIds] = useState<Record<number, string>>({});
  const assessmentId = assessmentIds[active];

  // Saved victims come back as drafts once, when the mission first loads.
  const loaded = mission.data?.incident.id;
  useEffect(() => {
    const saved = mission.data?.assessments;
    if (!saved || saved.length === 0) return;
    setDrafts(Object.fromEntries(saved.map((row) => [row.victimIndex, draftFromSaved(row)])));
    setAssessmentIds(Object.fromEntries(saved.map((row) => [row.victimIndex, row.id])));
    setActive(saved[0]!.victimIndex);
    // Only when a different mission arrives, never on a refetch: that would erase what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const save = useMutation(
    trpc.assessments.save.mutationOptions({
      onSuccess: (result, variables) => {
        setAssessmentIds((current) => ({ ...current, [variables.victimIndex ?? 1]: result.assessmentId }));
        const index = result.shockIndex;
        toast.success(
          `Bilan enregistré${index?.value != null ? ` · indice de choc ${index.value.toFixed(2).replace(".", ",")}` : ""}${result.vittel.severe ? " · traumatisé grave" : ""}`,
        );
        queryClient.invalidateQueries({ queryKey: trpc.assessments.mission.queryKey({ incidentId }) });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const send = useMutation(
    trpc.handovers.send.mutationOptions({
      onSuccess: () => {
        toast.success("AT-MIST envoyé à l'hôpital");
        queryClient.invalidateQueries({ queryKey: trpc.handovers.forAssessment.pathKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const handovers = useQuery({
    ...trpc.handovers.forAssessment.queryOptions({ assessmentId: assessmentId ?? "" }),
    enabled: Boolean(assessmentId),
  });
  // The hospital's answer reaches the tablet live; the list is fetched again on every event.
  useSubscription(
    trpc.handovers.onUnit.subscriptionOptions(
      { unitId },
      { onData: () => queryClient.invalidateQueries({ queryKey: trpc.handovers.forAssessment.pathKey() }) },
    ),
  );

  if (mission.isPending) return <div className="p-4 md:p-6"><Skeleton className="h-40 w-full" /></div>;
  if (mission.isError) {
    return <p role="alert" className="p-4 text-sm text-destructive md:p-6">Impossible de charger l'incident : {mission.error.message}</p>;
  }

  const victims = Object.keys(drafts).map(Number).sort((a, b) => a - b);
  const vittelByVictim: Record<number, VittelResult> = Object.fromEntries(
    victims.map((victimIndex) => {
      const victimDraft = drafts[victimIndex] ?? emptyDraft();
      const profile = mission.data.profiles.find((candidate) => candidate.id === victimDraft.profileId) ?? null;
      const result = assessVictim({
        now,
        sensors: mission.data.incident.vittelPrefill ?? undefined,
        profile: profile
          ? { birthDate: profile.birthDate, pregnancy: profile.pregnancyStatus, medications: profile.medications }
          : null,
        estAge: victimDraft.estAge,
        vitals: victimDraft,
        medic: victimDraft.medic,
      }).vittel;
      return [victimIndex, result];
    }),
  );
  const draft = drafts[active] ?? emptyDraft();
  const update = (next: Draft) => setDrafts((current) => ({ ...current, [active]: next }));
  const addVictim = () => {
    const next = Math.max(...victims) + 1;
    setDrafts((current) => ({ ...current, [next]: emptyDraft() }));
    setActive(next);
  };
  const removeVictim = () => {
    if (victims.length === 1) return;
    const activePosition = victims.indexOf(active);
    const nextActive =
      victims[activePosition - 1] ?? victims[activePosition + 1]!;
    setDrafts((current) => {
      const { [active]: _removed, ...remaining } = current;
      return remaining;
    });
    setAssessmentIds((current) => {
      const { [active]: _removed, ...remaining } = current;
      return remaining;
    });
    setActive(nextActive);
  };

  const payload = () => ({
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
      chosenHospitalId: draft.chosenHospitalId ?? undefined,
      overrideReason: draft.overrideReason.trim() || undefined,
    });
  const submit = () => save.mutate(payload());
  // One tap: save the bilan with the retained hospital, then warn that hospital.
  const saveAndSend = async () => {
    try {
      const saved = await save.mutateAsync(payload());
      await send.mutateAsync({ assessmentId: saved.assessmentId });
    } catch {
      // Both mutations already show their own error.
    }
  };

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

      <div className="grid max-w-7xl grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
        <aside
          role="group"
          aria-label="Victimes"
          className="sticky top-3 rounded-lg border bg-card p-2 shadow-xs sm:p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <h2 className="text-xs font-bold text-muted-foreground sm:text-sm">
              Victimes
            </h2>
            <span
              className="tabular text-xs font-semibold text-muted-foreground"
              aria-label={`${victims.length} victime${victims.length > 1 ? "s" : ""}`}
            >
              {victims.length}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {victims.map((n) => {
              const vittel = vittelByVictim[n]!;
              return (
                <div key={n} className="relative">
                  <button
                    type="button"
                    aria-current={n === active ? "true" : undefined}
                    onClick={() => setActive(n)}
                    className={cn(
                      "inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-md border px-2 text-sm font-bold transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:justify-start sm:px-3",
                      vittel.severe && "pe-10",
                      n === active
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-input bg-background hover:border-primary/60",
                    )}
                  >
                    <UserRoundIcon className="size-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Victime </span>
                    {n}
                  </button>
                  <VittelIndicator victim={n} result={vittel} />
                </div>
              );
            })}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="w-full"
              onClick={removeVictim}
              disabled={victims.length === 1}
              aria-label={`Supprimer la victime ${active}`}
              title={
                victims.length === 1
                  ? "Une victime au minimum"
                  : `Supprimer la victime ${active}`
              }
            >
              <MinusIcon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="w-full"
              onClick={addVictim}
              aria-label="Ajouter une victime"
              title="Ajouter une victime"
            >
              <PlusIcon aria-hidden="true" />
            </Button>
          </div>
        </aside>

        <div className="min-w-0">
          <BilanForm
            key={active}
            assessmentId={assessmentId}
            draft={draft}
            onChange={update}
            profiles={mission.data.profiles}
            sensors={mission.data.incident.vittelPrefill}
            onSave={submit}
            saving={save.isPending}
            now={now}
            scene={
              mission.data.incident.lat !== null &&
              mission.data.incident.lng !== null
                ? [mission.data.incident.lat, mission.data.incident.lng]
                : null
            }
            severity={mission.data.incident.recSeverity}
            orientationData={orientationData}
            graph={graph}
            handovers={handovers.data ?? []}
            onSend={saveAndSend}
            sending={save.isPending || send.isPending}
          />
        </div>
      </div>
    </section>
  );
}

export default function BilanWorkspace({
  unitId,
  initialIncidentId = null,
}: {
  unitId: string;
  /** The incident of the mission the medic just opened, so the picker is skipped. */
  initialIncidentId?: string | null;
}) {
  const [incidentId, setIncidentId] = useState<string | null>(initialIncidentId);
  if (!incidentId) return <IncidentPicker onPick={setIncidentId} />;
  return <VictimWorkspace incidentId={incidentId} unitId={unitId} onBack={() => setIncidentId(null)} />;
}
