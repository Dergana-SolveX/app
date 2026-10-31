import {
  assessVictim,
  hospitalFromRow,
  INJURY_TAGS,
  recommendForBilan,
  type LatLng,
  type RoadGraph,
  type Severity,
  type VittelLevel,
  type VittelState,
} from "@solvex-dergana/shared";
import { Button } from "@solvex-dergana/ui/components/button";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { LoaderCircleIcon, MarsIcon, SaveIcon, UserRoundIcon, VenusIcon } from "lucide-react";
import { useEffect, useMemo } from "react";

import { GcsPicker, NumberStepper, ToggleChip } from "./controls";
import type { Draft } from "./draft";
import { gcsTotal, withAnswer } from "./draft";
import { EnRoutePanel, type HandoverView } from "./en-route-panel";
import { OrientationPanel } from "./orientation-panel";
import { ShockIndexBadge } from "./shock-index-badge";
import { VittelPanel } from "./vittel-panel";

export type MissionProfile = {
  id: string;
  fullName: string;
  birthDate: string;
  ageYears: number | null;
  sex: "male" | "female";
  bloodType: string | null;
  allergies: string[];
  pregnancyStatus: "none" | "t1" | "t2" | "t3";
  medications: { name: string; class: string }[];
};

// Lists the team owns and can change (PRD §7.7 note): the words a medic ticks, saved as plain text.
const INJURIES = Object.keys(INJURY_TAGS);
const TREATMENTS = ["Oxygène", "Voie veineuse", "Remplissage", "Collier cervical", "Garrot", "Pansement compressif", "Immobilisation", "Analgésie"];

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("@container min-w-0 rounded-lg border bg-card p-4 shadow-xs", className)}>
      <h2 className="mb-3 text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}

function toggled(list: string[], value: string, on: boolean) {
  return on ? [...list, value] : list.filter((v) => v !== value);
}

/** The bilan secouriste of one victim. All results are computed here, live, from `packages/shared`. */
export function BilanForm({
  draft,
  onChange,
  profiles,
  sensors,
  onSave,
  saving,
  now,
  scene,
  severity,
  orientationData,
  graph,
  handovers,
  onSend,
  sending,
  assessmentId,
}: {
  assessmentId?: string | null;
  draft: Draft;
  onChange: (draft: Draft) => void;
  profiles: MissionProfile[];
  /** The incident's sensor prefill. */
  sensors: Partial<VittelState> | null;
  onSave: () => void;
  saving: boolean;
  now: Date;
  /** Where the victims are: the incident position, null while unknown. */
  scene: LatLng | null;
  severity: Severity;
  orientationData: {
    data: { hospitals: Parameters<typeof hospitalFromRow>[0][]; zones: Parameters<typeof recommendForBilan>[0]["zones"][number][] } | undefined;
    savedAt: number | null;
    fromCache: boolean;
    loading: boolean;
  };
  graph: RoadGraph | null | "error";
  /** The handovers already sent for this victim, oldest first. */
  handovers: HandoverView[];
  /** Saves the bilan, then sends the AT-MIST to the retained hospital. */
  onSend: () => void;
  sending: boolean;
}) {
  const profile = profiles.find((p) => p.id === draft.profileId) ?? null;
  const assessment = assessVictim({
    now,
    sensors: sensors ?? undefined,
    profile: profile && { birthDate: profile.birthDate, pregnancy: profile.pregnancyStatus, medications: profile.medications },
    estAge: draft.estAge,
    vitals: draft,
    medic: draft.medic,
  });
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  // Hospital ranking, computed here with no network from the cached list and the bundled road graph.
  const hospitals = useMemo(() => orientationData.data?.hospitals.map(hospitalFromRow) ?? [], [orientationData.data]);
  // A hospital that diverted this victim is not offered again: the next best is preselected below.
  const declined = useMemo(() => handovers.filter((h) => h.status === "diverted").map((h) => h.hospitalId), [handovers]);
  const orientation = useMemo(() => {
    if (!scene || !graph || graph === "error" || hospitals.length === 0) return null;
    return recommendForBilan({
      bilan: {
        gcs: draft.gcs,
        sbp: draft.sbp,
        shockIndex: assessment.shockIndex?.value ?? null,
        ageYears: assessment.age,
        pregnant: (profile?.pregnancyStatus ?? "none") !== "none",
        injuries: draft.injuries,
        vittel: assessment.state,
      },
      hospitals,
      origin: scene,
      graph,
      zones: orientationData.data?.zones ?? [],
      severity,
      declined,
    });
    // `assessment.state` is rebuilt on each render, so it cannot be a dependency: its inputs are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, graph, hospitals, orientationData.data?.zones, severity, declined, draft.gcs, draft.sbp, draft.injuries, draft.medic, draft.estAge, draft.profileId, draft.hr, draft.spo2, sensors, now, assessment.shockIndex?.value, assessment.age, profile?.pregnancyStatus]);
  const recommendedId = orientation?.recommended?.hospitalId ?? null;

  // When the retained hospital diverts, the next best is chosen for the medic: one tap to send again.
  const retainedDeclined = draft.chosenHospitalId !== null && declined.includes(draft.chosenHospitalId);
  useEffect(() => {
    if (retainedDeclined) onChange({ ...draft, chosenHospitalId: recommendedId, overrideReason: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retainedDeclined, recommendedId]);
  // Any choice other than the recommended one needs a reason, also when nothing could be recommended.
  const missingReason =
    draft.chosenHospitalId !== null &&
    draft.chosenHospitalId !== recommendedId &&
    draft.overrideReason.trim() === "";
  const answer = (level: VittelLevel, id: string, value: boolean | number | null) =>
    set({ medic: withAnswer(draft.medic, level, id, value) });

  return (
    <div className="@container flex min-w-0 flex-col gap-4">
      {/* Always in view while the medic types; Vittel details live on the victim indicator in the left rail. */}
      <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-2 backdrop-blur-sm">
        <ShockIndexBadge result={assessment.shockIndex} />
      </div>

      {/*
        One column on a tablet held upright, in the order the medic works (the `order-*` values).
        Two columns once the form itself is wide: the measures on the left, the decisions on the right.
      */}
      <div className="flex flex-col gap-4 @4xl:grid @4xl:grid-cols-2 @4xl:items-start">
      <div className="contents @4xl:flex @4xl:min-w-0 @4xl:flex-col @4xl:gap-4">
      <Section title="Victime" className="order-1">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="inline-flex min-h-10 items-center gap-2 rounded-md border bg-raised px-3 text-sm">
              <UserRoundIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground">Profil :</span>
              <strong>{profile?.fullName ?? "Inconnu"}</strong>
            </p>
            {profiles.length > 0 && (
              <div role="group" aria-label="Profils liés à l'incident" className="flex flex-wrap gap-2">
                {profiles.map((p) => (
                  <ToggleChip
                    key={p.id}
                    label={`${p.fullName}${p.ageYears !== null ? `, ${p.ageYears} ans` : ""}`}
                    pressed={draft.profileId === p.id}
                    onPressedChange={() => set({ profileId: p.id, estAge: null })}
                  />
                ))}
              </div>
            )}
          </div>

          {profile ? (
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex gap-2"><dt className="text-muted-foreground">Groupe sanguin</dt><dd className="font-semibold">{profile.bloodType ?? "inconnu"}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground">Allergies</dt><dd className="font-semibold">{profile.allergies.length ? profile.allergies.join(", ") : "aucune connue"}</dd></div>
              <div className="flex gap-2 sm:col-span-2"><dt className="text-muted-foreground">Traitements</dt><dd className="font-semibold">{profile.medications.length ? profile.medications.map((m) => m.name).join(", ") : "aucun"}</dd></div>
            </dl>
          ) : (
            <div className="grid items-end gap-4 @2xl:grid-cols-[minmax(14rem,1fr)_auto]">
              <NumberStepper
                label="Âge estimé"
                unit="ans"
                value={draft.estAge}
                onChange={(estAge) => set({ estAge })}
                min={0}
                max={120}
                fallback={30}
                quickStep={10}
              />
              <div role="group" aria-label="Sexe" className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">Sexe</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-pressed={draft.sex === "male"}
                    onClick={() => set({ sex: draft.sex === "male" ? "unknown" : "male" })}
                    className={cn(
                      "inline-flex min-h-12 items-center gap-2 rounded-md border px-4 text-sm font-semibold outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      draft.sex === "male"
                        ? "border-info/60 bg-info-soft text-info"
                        : "border-input bg-card text-info hover:border-info/60 hover:bg-info-soft",
                    )}
                  >
                    <MarsIcon className="size-5" aria-hidden="true" />
                    Homme
                  </button>
                  <button
                    type="button"
                    aria-pressed={draft.sex === "female"}
                    onClick={() => set({ sex: draft.sex === "female" ? "unknown" : "female" })}
                    className={cn(
                      "inline-flex min-h-12 items-center gap-2 rounded-md border px-4 text-sm font-semibold outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      draft.sex === "female"
                        ? "border-pink-500/60 bg-pink-500/10 text-pink-600 dark:text-pink-400"
                        : "border-input bg-card text-pink-600 hover:border-pink-500/60 hover:bg-pink-500/10 dark:text-pink-400",
                    )}
                  >
                    <VenusIcon className="size-5" aria-hidden="true" />
                    Femme
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section title="Constantes" className="order-2">
        <div className="grid grid-cols-1 gap-4">
          <NumberStepper label="FC" unit="bpm" value={draft.hr} onChange={(hr) => set({ hr })} min={0} max={300} fallback={80} quickStep={10} />
          <NumberStepper label="PAS" unit="mmHg" value={draft.sbp} onChange={(sbp) => set({ sbp })} min={0} max={350} step={5} fallback={120} quickStep={10} />
          <NumberStepper label="PAD" unit="mmHg" value={draft.dbp} onChange={(dbp) => set({ dbp })} min={0} max={250} step={5} fallback={80} quickStep={10} />
          <NumberStepper label="SpO2" unit="%" value={draft.spo2} onChange={(spo2) => set({ spo2 })} min={0} max={100} fallback={97} quickStep={10} />
          <NumberStepper label="FR" unit="/min" value={draft.rr} onChange={(rr) => set({ rr })} min={0} max={80} fallback={16} quickStep={10} />
        </div>
        <div className="mt-4">
          <GcsPicker
            eye={draft.gcsParts.eye}
            verbal={draft.gcsParts.verbal}
            motor={draft.gcsParts.motor}
            onChange={(gcsParts) => set({ gcsParts, gcs: gcsTotal(gcsParts) })}
          />
          {(draft.gcs !== null || draft.gcsParts.eye !== null || draft.gcsParts.verbal !== null || draft.gcsParts.motor !== null) && (
            <Button
              type="button"
              variant="outline"
              className="mt-2 h-12"
              onClick={() => set({ gcs: null, gcsParts: { eye: null, verbal: null, motor: null } })}
            >
              Effacer le Glasgow
            </Button>
          )}
          {draft.gcs !== null && draft.gcsParts.eye === null && (
            <p className="mt-1.5 text-xs text-muted-foreground">Glasgow enregistré : {draft.gcs} / 15. Les détails E/V/M n'étaient pas conservés.</p>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Un champ vide veut dire « non mesuré » : il n'est jamais compté comme 0.</p>
      </Section>

      <Section title="Lésions suspectées" className="order-4">
        <div className="flex flex-wrap gap-2">
          {INJURIES.map((name) => (
            <ToggleChip key={name} label={name} pressed={draft.injuries.includes(name)} onPressedChange={(on) => set({ injuries: toggled(draft.injuries, name, on) })} />
          ))}
        </div>
      </Section>

      <Section title="Gestes réalisés" className="order-5">
        <div className="flex flex-wrap gap-2">
          {TREATMENTS.map((name) => (
            <ToggleChip key={name} label={name} pressed={draft.treatments.includes(name)} onPressedChange={(on) => set({ treatments: toggled(draft.treatments, name, on) })} />
          ))}
        </div>
      </Section>
      </div>

      <div className="contents @4xl:flex @4xl:min-w-0 @4xl:flex-col @4xl:gap-4">
      <Section title="Critères de Vittel" className="order-3">
        <VittelPanel state={assessment.state} onAnswer={answer} />
      </Section>

      <Section title="Orientation hospitalière" className="order-6">
        {!scene ? (
          <p className="text-sm text-muted-foreground">La position de l'incident n'est pas connue : le classement des hôpitaux n'est pas possible.</p>
        ) : orientation ? (
          <div className="flex flex-col gap-4">
            <EnRoutePanel
              chosen={
                draft.chosenHospitalId && !declined.includes(draft.chosenHospitalId)
                  ? { id: draft.chosenHospitalId, name: hospitals.find((h) => h.id === draft.chosenHospitalId)?.name ?? "l'hôpital" }
                  : null
              }
              handovers={handovers}
              names={new Map(hospitals.map((h) => [h.id, h.name]))}
              nextBest={
                orientation.recommended
                  ? { name: hospitals.find((h) => h.id === orientation.recommended!.hospitalId)?.name ?? "", etaMin: orientation.recommended.etaMin }
                  : null
              }
              sending={sending}
              canSend={!missingReason}
              onSend={onSend}
              now={now}
              assessmentId={assessmentId}
              initialVitals={{
                hr: draft.hr,
                sbp: draft.sbp,
                dbp: draft.dbp,
                spo2: draft.spo2,
                gcs: draft.gcs,
                rr: draft.rr,
              }}
            />
            <OrientationPanel
            orientation={orientation}
            hospitals={hospitals}
            scene={scene}
            graph={graph}
            chosenId={draft.chosenHospitalId}
            overrideReason={draft.overrideReason}
            onChoose={(hospitalId) => set({ chosenHospitalId: hospitalId, overrideReason: hospitalId === recommendedId ? "" : draft.overrideReason })}
            onReason={(overrideReason) => set({ overrideReason })}
            cache={orientationData.fromCache && orientationData.savedAt ? { savedAt: orientationData.savedAt } : null}
          />
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {graph === "error"
              ? "Le réseau routier n'a pas pu être chargé."
              : orientationData.loading || graph === null
                ? "Chargement des hôpitaux et du réseau routier…"
                : "Aucune liste d'hôpitaux disponible : connectez la tablette une première fois pour la mémoriser."}
          </p>
        )}
      </Section>
      </div>
      </div>

      <div className="sticky bottom-0 -mx-1 border-t bg-background/95 px-1 py-3 backdrop-blur-sm">
        {missingReason && (
          <p role="alert" className="mb-2 text-sm font-semibold text-destructive">
            Indiquez le motif pour enregistrer un autre hôpital que le recommandé.
          </p>
        )}
        <div className="flex justify-end">
          <Button type="button" size="lg" onClick={onSave} disabled={saving || missingReason}>
            {saving ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <SaveIcon aria-hidden="true" />}
            {saving ? "Enregistrement…" : "Enregistrer le bilan"}
          </Button>
        </div>
      </div>
    </div>
  );
}
