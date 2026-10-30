import { THRESHOLDS } from "../thresholds";
import type { VittelItem, VittelLevel, VittelState } from "./vittel";

const LEVELS: VittelLevel[] = ["l1", "l2", "l3", "l4", "l5"];

/** Whole years on a given day, or null when the birth date cannot be read. */
export function ageYears(birthDate: string | null | undefined, on: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate ?? "");
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const hadBirthday = on.getUTCMonth() + 1 > month || (on.getUTCMonth() + 1 === month && on.getUTCDate() >= day);
  return on.getUTCFullYear() - year - (hadBirthday ? 0 : 1);
}

const measured = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const item = (value: boolean, source: VittelItem["source"]): VittelItem => ({ value, source });

/** Level 1, computed from the vitals the medic measured. A measure not taken says nothing. */
export function vittelFromVitals(vitals: {
  gcs?: number | null;
  sbp?: number | null;
  spo2?: number | null;
}): Partial<VittelState> {
  const { gcsBelow, sbpBelow, spo2Below } = THRESHOLDS.vittel;
  const l1: Record<string, VittelItem> = {};
  if (measured(vitals.gcs)) l1.gcsLow = item(vitals.gcs < gcsBelow, "medic");
  if (measured(vitals.sbp)) l1.sbpLow = item(vitals.sbp < sbpBelow, "medic");
  if (measured(vitals.spo2)) l1.spo2Low = item(vitals.spo2 < spo2Below, "medic");
  return { l1 };
}

/**
 * Level 5, from the registered profile. Cardiac and respiratory insufficiency are not here: the profile keeps
 * chronic conditions as free text, so the medic ticks those.
 */
export function vittelFromProfile(profile: {
  ageYears: number | null;
  pregnancy: "none" | "t1" | "t2" | "t3";
  medications: { name: string; class: string }[];
}): Partial<VittelState> {
  const l5: Record<string, VittelItem> = {};
  if (profile.ageYears !== null) l5.ageOver65 = item(profile.ageYears > THRESHOLDS.vittel.ageAbove, "app");
  l5.pregnancyT2T3 = item(profile.pregnancy === "t2" || profile.pregnancy === "t3", "app");
  l5.coagulationDisorder = item(profile.medications.some((m) => m.class === "anticoagulant"), "app");
  return { l5 };
}

/**
 * Puts the sources together; a later one wins on the same item: sensors, then the profile, then the measured
 * vitals, then what the medic ticked. The medic can therefore overrule a sensor either way.
 */
export function assembleVittel(sources: {
  sensors?: Partial<VittelState>;
  profile?: Partial<VittelState>;
  vitals?: Partial<VittelState>;
  medic?: Partial<VittelState>;
}): VittelState {
  const state: VittelState = { l1: {}, l2: {}, l3: {}, l4: {}, l5: {} };
  for (const source of [sources.sensors, sources.profile, sources.vitals, sources.medic]) {
    for (const level of LEVELS) Object.assign(state[level], structuredClone(source?.[level] ?? {}));
  }
  return state;
}
