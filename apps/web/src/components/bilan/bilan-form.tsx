import {
  assessVictim,
  deriveNeeds,
  hospitalFromRow,
  INJURY_TAGS,
  isInShock,
  matchHospitals,
  needFacts,
  type LatLng,
  type RoadGraph,
  type VittelLevel,
  type VittelState,
} from "@solvex-dergana/shared";
import { Button } from "@solvex-dergana/ui/components/button";
import { Input } from "@solvex-dergana/ui/components/input";
import { Label } from "@solvex-dergana/ui/components/label";
import { LoaderCircleIcon, SaveIcon } from "lucide-react";
import { useId, useMemo } from "react";

import { GcsPicker, NumberStepper, ToggleChip } from "./controls";
import type { Draft, Sex } from "./draft";
import { gcsTotal, withAnswer } from "./draft";
import { OrientationPanel } from "./orientation-panel";
import { ShockIndexBadge } from "./shock-index-badge";
import { VittelBanner, VittelPanel } from "./vittel-panel";

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

const SEX_LABELS: Record<Sex, string> = { unknown: "Inconnu", male: "Homme", female: "Femme" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4">
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
}: {
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
  severity: "red" | "yellow" | "green" | "unknown";
  orientationData: {
    data: { hospitals: Parameters<typeof hospitalFromRow>[0][]; zones: Parameters<typeof matchHospitals>[0]["zones"][number][] } | undefined;
    savedAt: number | null;
    fromCache: boolean;
    loading: boolean;
  };
  graph: RoadGraph | null | "error";
}) {
  const ageId = useId();
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
  const orientation = useMemo(() => {
    if (!scene || !graph || graph === "error" || hospitals.length === 0) return null;
    const facts = needFacts({
      gcs: draft.gcs,
      sbp: draft.sbp,
      shockIndex: assessment.shockIndex?.value ?? null,
      ageYears: assessment.age,
      pregnant: (profile?.pregnancyStatus ?? "none") !== "none",
      injuries: draft.injuries,
      vittel: assessment.state,
    });
    const needs = deriveNeeds(facts);
    return {
      needs,
      result: matchHospitals({
        needs, hospitals, origin: scene, graph, zones: orientationData.data?.zones ?? [], severity, inShock: isInShock(facts),
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, graph, hospitals, severity, draft.gcs, draft.sbp, draft.injuries, assessment.shockIndex?.value, assessment.age, assessment.state, profile?.pregnancyStatus]);
  const recommendedId = orientation?.result.recommended?.hospitalId ?? null;
  const missingReason =
    draft.chosenHospitalId !== null && recommendedId !== null && draft.chosenHospitalId !== recommendedId && draft.overrideReason.trim() === "";
  const answer = (level: VittelLevel, id: string, value: boolean | number | null) =>
    set({ medic: withAnswer(draft.medic, level, id, value) });

  return (
    <div className="flex flex-col gap-4">
      {/* Always in view while the medic types: the two results that change what they do next. */}
      <div className="sticky top-0 z-10 -mx-1 flex flex-col gap-2 bg-background/95 px-1 py-2 backdrop-blur-sm">
        <VittelBanner result={assessment.vittel} />
        <ShockIndexBadge result={assessment.shockIndex} />
      </div>

      <Section title="Victime">
        <div className="flex flex-col gap-4">
          <div role="group" aria-label="Profil de la victime" className="flex flex-wrap gap-2">
            <ToggleChip label="Inconnu" pressed={draft.profileId === null} onPressedChange={() => set({ profileId: null })} />
            {profiles.map((p) => (
              <ToggleChip
                key={p.id}
                label={`${p.fullName}${p.ageYears !== null ? `, ${p.ageYears} ans` : ""}`}
                pressed={draft.profileId === p.id}
                onPressedChange={() => set({ profileId: p.id, estAge: null })}
              />
            ))}
          </div>
          {profiles.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun profil n'est lié à cet incident : la victime est inconnue.</p>
          )}

          {profile ? (
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex gap-2"><dt className="text-muted-foreground">Groupe sanguin</dt><dd className="font-semibold">{profile.bloodType ?? "inconnu"}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground">Allergies</dt><dd className="font-semibold">{profile.allergies.length ? profile.allergies.join(", ") : "aucune connue"}</dd></div>
              <div className="flex gap-2 sm:col-span-2"><dt className="text-muted-foreground">Traitements</dt><dd className="font-semibold">{profile.medications.length ? profile.medications.map((m) => m.name).join(", ") : "aucun"}</dd></div>
            </dl>
          ) : (
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-40">
                <Label htmlFor={ageId} className="mb-1.5 block text-sm font-semibold">Âge estimé (ans)</Label>
                <Input
                  id={ageId}
                  className="h-12"
                  inputMode="numeric"
                  placeholder="—"
                  value={draft.estAge ?? ""}
                  onChange={(event) => {
                    const n = Number(event.target.value);
                    set({ estAge: event.target.value.trim() === "" || !Number.isFinite(n) ? null : Math.min(120, Math.max(0, Math.round(n))) });
                  }}
                />
              </div>
              <div role="group" aria-label="Sexe" className="flex flex-wrap gap-2">
                {(["unknown", "male", "female"] as const).map((sex) => (
                  <ToggleChip key={sex} label={SEX_LABELS[sex]} pressed={draft.sex === sex} onPressedChange={() => set({ sex })} />
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section title="Constantes">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberStepper label="FC" unit="bpm" value={draft.hr} onChange={(hr) => set({ hr })} min={0} max={300} fallback={80} />
          <NumberStepper label="PAS" unit="mmHg" value={draft.sbp} onChange={(sbp) => set({ sbp })} min={0} max={350} step={5} fallback={120} />
          <NumberStepper label="PAD" unit="mmHg" value={draft.dbp} onChange={(dbp) => set({ dbp })} min={0} max={250} step={5} fallback={80} />
          <NumberStepper label="SpO2" unit="%" value={draft.spo2} onChange={(spo2) => set({ spo2 })} min={0} max={100} fallback={97} />
          <NumberStepper label="FR" unit="/min" value={draft.rr} onChange={(rr) => set({ rr })} min={0} max={80} fallback={16} />
        </div>
        <div className="mt-4">
          <GcsPicker
            eye={draft.gcsParts.eye}
            verbal={draft.gcsParts.verbal}
            motor={draft.gcsParts.motor}
            onChange={(parts) => set({ gcsParts: parts, gcs: gcsTotal(parts) })}
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
            <p className="mt-1.5 text-xs text-muted-foreground">Glasgow enregistré : {draft.gcs} / 15 (le détail E/V/M n'est pas conservé).</p>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Un champ vide veut dire « non mesuré » : il n'est jamais compté comme 0.</p>
      </Section>

      <Section title="Critères de Vittel">
        <VittelPanel state={assessment.state} onAnswer={answer} />
      </Section>

      <Section title="Lésions suspectées">
        <div className="flex flex-wrap gap-2">
          {INJURIES.map((name) => (
            <ToggleChip key={name} label={name} pressed={draft.injuries.includes(name)} onPressedChange={(on) => set({ injuries: toggled(draft.injuries, name, on) })} />
          ))}
        </div>
      </Section>

      <Section title="Gestes réalisés">
        <div className="flex flex-wrap gap-2">
          {TREATMENTS.map((name) => (
            <ToggleChip key={name} label={name} pressed={draft.treatments.includes(name)} onPressedChange={(on) => set({ treatments: toggled(draft.treatments, name, on) })} />
          ))}
        </div>
      </Section>

      <Section title="Orientation hospitalière">
        {!scene ? (
          <p className="text-sm text-muted-foreground">La position de l'incident n'est pas connue : le classement des hôpitaux n'est pas possible.</p>
        ) : orientation ? (
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

      <div className="sticky bottom-0 -mx-1 bg-background/95 px-1 py-3 backdrop-blur-sm">
        {missingReason && (
          <p role="alert" className="mb-2 text-sm font-semibold text-destructive">
            Indiquez le motif pour enregistrer un autre hôpital que le recommandé.
          </p>
        )}
        <Button type="button" size="lg" className="w-full sm:w-auto" onClick={onSave} disabled={saving || missingReason}>
          {saving ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <SaveIcon aria-hidden="true" />}
          {saving ? "Enregistrement…" : "Enregistrer le bilan"}
        </Button>
      </div>
    </div>
  );
}
