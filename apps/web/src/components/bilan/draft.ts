import type { VittelLevel, VittelState } from "@solvex-dergana/shared";

export type Sex = "male" | "female" | "unknown";

/** What the medic has entered for one victim so far. `null` means not measured / not entered. */
export type Draft = {
  profileId: string | null;
  estAge: number | null;
  sex: Sex;
  gcs: number | null;
  /** The three Glasgow components used by the detailed sliders. */
  gcsParts: { eye: number | null; verbal: number | null; motor: number | null };
  hr: number | null;
  sbp: number | null;
  dbp: number | null;
  spo2: number | null;
  rr: number | null;
  /** The medic's own Vittel answers (they overrule sensors and profile). Level 1 is never kept: it is measured. */
  medic: Partial<VittelState>;
  injuries: string[];
  treatments: string[];
  /** The hospital the medic retained, and why when it is not the recommended one. */
  chosenHospitalId: string | null;
  overrideReason: string;
};

/** The Glasgow total once all three detailed sliders have been measured. */
export const gcsTotal = (parts: Draft["gcsParts"]): number | null =>
  parts.eye !== null && parts.verbal !== null && parts.motor !== null ? parts.eye + parts.verbal + parts.motor : null;

export const emptyDraft = (): Draft => ({
  profileId: null,
  estAge: null,
  sex: "unknown",
  gcs: null,
  gcsParts: { eye: null, verbal: null, motor: null },
  hr: null,
  sbp: null,
  dbp: null,
  spo2: null,
  rr: null,
  medic: {},
  injuries: [],
  treatments: [],
  chosenHospitalId: null,
  overrideReason: "",
});

/** A copy of the medic's answers with one item set, or removed when `value` is null. */
export function withAnswer(
  medic: Partial<VittelState>,
  level: VittelLevel,
  id: string,
  value: boolean | number | null,
): Partial<VittelState> {
  const items = { ...medic[level] };
  if (value === null) delete items[id];
  else items[id] = { value, source: "medic" };
  return { ...medic, [level]: items };
}

/** The keys that hold a row of the database, as the bilan screen needs them. */
type SavedRow = {
  profileId: string | null;
  estAge: number | null;
  sex: Sex | null;
  gcs: number | null;
  hr: number | null;
  sbp: number | null;
  dbp: number | null;
  spo2: number | null;
  rr: number | null;
  vittel: Partial<VittelState> | null;
  suspectedInjuries: string[];
  treatments: string[];
  chosenHospitalId: string | null;
  overrideReason: string | null;
};

/** Rebuilds a draft from a saved bilan, keeping only what the medic answered (no sensor, profile or level 1). */
export function draftFromSaved(row: SavedRow): Draft {
  const medic: Partial<VittelState> = {};
  for (const level of ["l2", "l3", "l4", "l5"] as const) {
    // Without a profile, "age over 65" is derived from the estimated age on every computation, not an answer.
    const own = Object.entries(row.vittel?.[level] ?? {}).filter(
      ([id, item]) => item.source === "medic" && !(id === "ageOver65" && !row.profileId),
    );
    if (own.length > 0) medic[level] = Object.fromEntries(own);
  }
  return {
    ...emptyDraft(),
    profileId: row.profileId,
    estAge: row.estAge,
    sex: row.sex ?? "unknown",
    gcs: row.gcs,
    hr: row.hr,
    sbp: row.sbp,
    dbp: row.dbp,
    spo2: row.spo2,
    rr: row.rr,
    medic,
    injuries: row.suspectedInjuries,
    treatments: row.treatments,
    chosenHospitalId: row.chosenHospitalId,
    overrideReason: row.overrideReason ?? "",
  };
}
