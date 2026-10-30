import { assembleVittel, ageYears, vittelFromProfile, vittelFromVitals } from "./assemble";
import { shockIndex, type ShockIndex } from "./shock-index";
import { evaluateVittel, type VittelResult, type VittelState } from "./vittel";
import { THRESHOLDS } from "../thresholds";

export type VictimProfile = {
  birthDate: string;
  pregnancy: "none" | "t1" | "t2" | "t3";
  medications: { name: string; class: string }[];
};

export type VictimAssessment = {
  age: number | null;
  /** The five Vittel levels, every source put together. */
  state: VittelState;
  vittel: VittelResult;
  shockIndex: ShockIndex | null;
};

/**
 * Everything computed from what is known about one victim (PRD FR-S2-13/14, FR-S6-04). The tablet runs it live
 * while the medic types, with no network; the server runs the same function when the bilan is saved.
 */
export function assessVictim(input: {
  now: Date;
  /** Prefill from the sensors (the incident's `vittelPrefill`). */
  sensors?: Partial<VittelState>;
  profile?: VictimProfile | null;
  /** Age the medic estimated, used when there is no profile. */
  estAge?: number | null;
  vitals?: { gcs?: number | null; hr?: number | null; sbp?: number | null; spo2?: number | null };
  /** What the medic ticked. Level 1 is ignored: it always comes from the measures. */
  medic?: Partial<VittelState>;
}): VictimAssessment {
  const { profile, vitals = {} } = input;
  const age = profile ? ageYears(profile.birthDate, input.now) : (input.estAge ?? null);
  const medications = profile?.medications ?? [];
  const pregnancy = profile?.pregnancy ?? "none";

  const state = assembleVittel({
    sensors: input.sensors,
    profile: profile ? vittelFromProfile({ ageYears: age, pregnancy, medications }) : undefined,
    vitals: vittelFromVitals(vitals),
    medic: { ...input.medic, l1: undefined },
  });
  if (!profile && age !== null) {
    state.l5.ageOver65 ??= { value: age > THRESHOLDS.vittel.ageAbove, source: "medic" };
  }

  return {
    age,
    state,
    vittel: evaluateVittel(state),
    shockIndex: shockIndex(vitals.hr, vitals.sbp, {
      ageYears: age,
      betaBlocker: medications.some((m) => m.class === "beta_blocker"),
      antihypertensive: medications.some((m) => m.class === "antihypertensive"),
      pregnant: pregnancy !== "none",
    }),
  };
}
