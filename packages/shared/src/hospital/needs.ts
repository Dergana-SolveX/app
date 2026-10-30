import { THRESHOLDS } from "../thresholds";
import type { VittelState } from "../clinical/vittel";

/** What a hospital can offer. The same names are the keys of a hospital's accept/divert status. */
export const NEEDS = [
  "neurosurgery",
  "ct_scanner",
  "burn_unit",
  "icu",
  "trauma_surgery",
  "obstetrics",
  "blood_bank",
  "pediatric",
] as const;
export type Need = (typeof NEEDS)[number];

/** French names, for the cards and the reasons. */
export const NEED_LABELS: Record<Need, string> = {
  neurosurgery: "Neurochirurgie",
  ct_scanner: "Scanner",
  burn_unit: "Centre de brûlés",
  icu: "Réanimation",
  trauma_surgery: "Chirurgie traumatologique",
  obstetrics: "Obstétrique",
  blood_bank: "Banque de sang",
  pediatric: "Pédiatrie",
};

type Region = "head" | "neck" | "spine" | "thorax" | "abdomen" | "pelvis" | "limbs";

/** The injuries a medic can tick, and what each one means for the rules. Plain text is what gets saved. */
export const INJURY_TAGS: Record<string, Region | "burn" | "none"> = {
  Tête: "head",
  "Rachis cervical": "spine",
  Thorax: "thorax",
  Abdomen: "abdomen",
  Bassin: "pelvis",
  "Membre supérieur": "limbs",
  "Membre inférieur": "limbs",
  "Hémorragie externe": "none",
  Brûlure: "burn",
};

/** Vittel anatomical answers that also say which part of the body is hurt. */
const VITTEL_REGIONS: Record<string, Region | "burn"> = {
  penetratingHead: "head",
  penetratingNeck: "neck",
  penetratingThorax: "thorax",
  flailChest: "thorax",
  penetratingAbdomen: "abdomen",
  pelvicFracture: "pelvis",
  spinalInjury: "spine",
  penetratingArm: "limbs",
  penetratingThigh: "limbs",
  proximalAmputation: "limbs",
  limbIschaemia: "limbs",
  severeBurnOrSmoke: "burn",
};

export type NeedFacts = {
  gcs: number | null;
  sbp: number | null;
  /** The Shock Index value shown to the medic. */
  shockIndex: number | null;
  headTrauma: boolean;
  burn: boolean;
  spinal: boolean;
  pregnant: boolean;
  ageYears: number | null;
  polytrauma: boolean;
};

/** Turns the bilan (measures, ticked injuries, Vittel answers) into the facts the need rules read. */
export function needFacts(bilan: {
  gcs: number | null;
  sbp: number | null;
  shockIndex: number | null;
  ageYears: number | null;
  pregnant: boolean;
  injuries: string[];
  vittel: Partial<VittelState>;
}): NeedFacts {
  const areas = new Set<Region | "burn">();
  for (const tag of bilan.injuries) {
    const area = INJURY_TAGS[tag];
    if (area && area !== "none") areas.add(area);
  }
  for (const [id, area] of Object.entries(VITTEL_REGIONS)) {
    if (bilan.vittel.l3?.[id]?.value === true) areas.add(area);
  }
  const regions = [...areas].filter((a) => a !== "burn");
  return {
    gcs: bilan.gcs,
    sbp: bilan.sbp,
    shockIndex: bilan.shockIndex,
    headTrauma: areas.has("head"),
    burn: areas.has("burn"),
    spinal: areas.has("spine"),
    pregnant: bilan.pregnant,
    ageYears: bilan.ageYears,
    polytrauma: regions.length >= 2,
  };
}

export type NeedResult = {
  required: Need[];
  /** Wanted but never a reason to rank a hospital lower. */
  preferred: Need[];
  /** Why each need is asked for, in French. */
  reasons: { need: Need; why: string }[];
};

/** Shock: a pressure under 90 or a Shock Index above 0.9 (PRD FR-S2-26). */
export function isInShock(facts: Pick<NeedFacts, "sbp" | "shockIndex">): boolean {
  const lowPressure = facts.sbp !== null && facts.sbp < THRESHOLDS.vittel.sbpBelow;
  const highIndex = facts.shockIndex !== null && facts.shockIndex > THRESHOLDS.shockIndex.elevatedAbove;
  return lowPressure || highIndex;
}

/** Which care the victim needs (PRD FR-S2-26). */
export function deriveNeeds(facts: NeedFacts): NeedResult {
  const { gcsAtMost, pediatricUnderYears } = THRESHOLDS.needs;
  const reasons: { need: Need; why: string }[] = [];
  const ask = (needs: Need[], why: string) => needs.forEach((need) => reasons.push({ need, why }));

  if (facts.gcs !== null && facts.gcs <= gcsAtMost) ask(["neurosurgery", "ct_scanner"], `Glasgow ${facts.gcs} (${gcsAtMost} ou moins)`);
  if (facts.headTrauma) ask(["neurosurgery", "ct_scanner"], "Traumatisme crânien");
  if (facts.spinal) ask(["neurosurgery", "ct_scanner"], "Atteinte du rachis suspectée");
  if (facts.burn) ask(["burn_unit"], "Brûlure ou inhalation de fumées");

  if (isInShock(facts)) {
    const lowPressure = facts.sbp !== null && facts.sbp < THRESHOLDS.vittel.sbpBelow;
    ask(["trauma_surgery", "blood_bank", "icu"], lowPressure ? `PAS ${facts.sbp} (moins de ${THRESHOLDS.vittel.sbpBelow})` : "Indice de choc élevé");
  }
  if (facts.pregnant) ask(["obstetrics"], "Victime enceinte");
  if (facts.polytrauma) ask(["trauma_surgery", "icu", "ct_scanner"], "Polytraumatisme (plusieurs régions du corps)");

  const asked = new Set(reasons.map((r) => r.need));
  const preferred: Need[] = [];
  if (facts.ageYears !== null && facts.ageYears < pediatricUnderYears) {
    preferred.push("pediatric");
    reasons.push({ need: "pediatric", why: `Enfant de ${facts.ageYears} an${facts.ageYears > 1 ? "s" : ""} (pédiatrie souhaitée)` });
  }

  return { required: NEEDS.filter((need) => asked.has(need)), preferred, reasons };
}
