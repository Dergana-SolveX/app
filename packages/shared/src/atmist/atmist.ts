import type { ShockFlag, ShockIndex } from "../clinical/shock-index";
import type { VittelResult } from "../clinical/vittel";
import { NEEDS, type Need } from "../hospital/needs";
import { toGsm7 } from "../sms/gsm7";
import { profileRisk, type ProfileForRisk } from "../triage/profileRisk";

type Vitals = { gcs?: number | null; hr?: number | null; sbp?: number | null; dbp?: number | null; spo2?: number | null; rr?: number | null };

export type AtMistInput = {
  /** When the incident began (its first alert). */
  incidentAt: Date | string;
  /** Call sign of the ambulance. */
  unit: string;
  victimIndex: number;
  /** Minutes to the hospital, from the road graph. */
  etaMin: number | null;
  age: number | null;
  sex: "male" | "female" | "unknown" | null;
  vittel: VittelResult;
  /** Injuries the medic ticked. */
  injuries: string[];
  treatments: string[];
  vitals: Vitals;
  shockIndex: ShockIndex | null;
  needs: Need[];
  /** Only what the hospital must prepare for: never the name, contact or profile code, even if given. */
  profile: ProfileForRisk | null;
};

/** The structured handover (PRD FR-S2-29): Age/sex, Time, Mechanism, Injuries, Signs, Treatment, plus what to prepare. */
export type AtMist = {
  version: 1;
  unit: string;
  victimIndex: number;
  age: number | null;
  sex: "male" | "female" | "unknown" | null;
  /** Time of the incident, "HH:MM" in Algiers. */
  time: string;
  mechanism: string[];
  injuries: string[];
  signs: {
    gcs: number | null;
    hr: number | null;
    sbp: number | null;
    dbp: number | null;
    spo2: number | null;
    rr: number | null;
    shockIndex: { value: number | null; flag: ShockFlag; caveats: string[] } | null;
  };
  treatments: string[];
  /** Whether a Vittel criterion is positive ("traumatisé grave"). */
  severe: boolean;
  needs: Need[];
  prep: string[];
  bloodType: string | null;
  allergies: string[];
  etaMin: number | null;
};

const PREP: Record<Exclude<Need, "blood_bank">, string> = {
  neurosurgery: "bloc de neurochirurgie",
  ct_scanner: "scanner",
  burn_unit: "centre de brûlés",
  icu: "lit de réanimation",
  trauma_surgery: "bloc de traumatologie",
  obstetrics: "équipe obstétrique",
  pediatric: "équipe pédiatrique",
};

/** Algeria is on UTC+1 all year. */
function algiersTime(at: Date | string): string {
  const shifted = new Date(new Date(at).getTime() + 3_600_000);
  return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
}

const unique = (items: string[]) => items.filter((item, i) => items.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === i);

export function buildAtMist(input: AtMistInput): AtMist {
  const risk = input.profile ? profileRisk(input.profile) : null;
  const needs = NEEDS.filter((need) => input.needs.includes(need));
  const knownBlood = Boolean(input.profile?.bloodType);
  const fromNeeds = needs.flatMap((need) =>
    need === "blood_bank" ? (knownBlood ? [] : ["culots O−"]) : [PREP[need]],
  );
  const at = (level: string) => input.vittel.positives.filter((p) => p.level === level).map((p) => p.label);

  return {
    version: 1,
    unit: input.unit,
    victimIndex: input.victimIndex,
    age: input.age,
    sex: input.sex,
    time: algiersTime(input.incidentAt),
    mechanism: at("l2"),
    injuries: unique([...input.injuries, ...at("l3")]),
    signs: {
      gcs: input.vitals.gcs ?? null,
      hr: input.vitals.hr ?? null,
      sbp: input.vitals.sbp ?? null,
      dbp: input.vitals.dbp ?? null,
      spo2: input.vitals.spo2 ?? null,
      rr: input.vitals.rr ?? null,
      shockIndex: input.shockIndex && { value: input.shockIndex.value, flag: input.shockIndex.flag, caveats: input.shockIndex.caveats },
    },
    treatments: input.treatments,
    severe: input.vittel.severe,
    needs,
    prep: unique([...fromNeeds, ...(risk?.prepTags ?? [])]),
    bloodType: input.profile?.bloodType ?? null,
    allergies: input.profile?.allergies ?? [],
    etaMin: input.etaMin === null ? null : Math.round(input.etaMin),
  };
}

/** Three parts of a long SMS, 153 characters each. */
const MAX_SMS_CHARS = 3 * 153;

const SEPARATOR = " ; ";
const FLAG_WORDS: Record<ShockFlag, string> = { normal: "", elevated: " ELEVE", critical: " CRITIQUE" };

/**
 * The handover as one SMS of at most 3 parts, in plain GSM-7 (PRD FR-S2-29). When it is too long the optional
 * parts are dropped, least important first; the age, time, signs, ETA and severity are always kept.
 */
export function renderAtMistSms(atmist: AtMist): string {
  const { signs } = atmist;
  const sex = atmist.sex === "male" ? "H" : atmist.sex === "female" ? "F" : "";
  const age = atmist.age === null ? "" : `${atmist.age}a`;
  const vitals = [
    signs.hr !== null && `FC${signs.hr}`,
    signs.sbp !== null && `PAS${signs.sbp}${signs.dbp !== null ? `/${signs.dbp}` : ""}`,
    signs.spo2 !== null && `SpO2 ${signs.spo2}`,
    signs.rr !== null && `FR${signs.rr}`,
    signs.gcs !== null && `GCS${signs.gcs}`,
    signs.shockIndex?.value != null && `IC${signs.shockIndex.value.toFixed(2).replace(".", ",")}${FLAG_WORDS[signs.shockIndex.flag]}`,
    signs.shockIndex && signs.shockIndex.value === null && "PAS imprenable CRITIQUE",
  ].filter(Boolean) as string[];

  const list = (items: unknown) =>
    Array.isArray(items) ? items.filter(Boolean).join(", ") : typeof items === "string" ? items : "";
  const part = (label: string, value: string | false | null | undefined) => (value ? `${label}:${value}` : null);

  // Parts in reading order; `optional` ones are dropped from the last of this list upwards.
  const parts: { text: string | null; optional?: number }[] = [
    { text: `AT-MIST ${atmist.unit} V${atmist.victimIndex}` },
    { text: part("A", [age, sex].filter(Boolean).join(" ")) },
    { text: part("T", atmist.time) },
    { text: part("M", list(atmist.mechanism)), optional: 2 },
    { text: part("I", list(atmist.injuries)), optional: 1 },
    { text: part("S", vitals.join(" ")) },
    { text: part("TX", list(atmist.treatments)), optional: 5 },
    { text: part("ETA", atmist.etaMin !== null && `${atmist.etaMin}min`) },
    { text: part("PREP", list(atmist.prep)), optional: 3 },
    { text: part("GS", atmist.bloodType), optional: 4 },
    { text: part("ALLERG", list(atmist.allergies)), optional: 6 },
    { text: atmist.severe ? "GRAVE (Vittel)" : null },
  ];

  const kept = parts.filter((p) => p.text);
  const render = () => toGsm7(kept.map((p) => p.text).join(SEPARATOR));
  // The highest `optional` rank goes first.
  for (const rank of [6, 5, 4, 3, 2, 1]) {
    if (render().length <= MAX_SMS_CHARS) break;
    const index = kept.findIndex((p) => p.optional === rank);
    if (index >= 0) kept.splice(index, 1);
  }
  return render().slice(0, MAX_SMS_CHARS);
}
