import { isHighEnergy } from "./kinematics";

export type VittelPrefillItem = { value: true; source: "iot" | "app" };
export type VittelPrefill = {
  l2?: Record<string, VittelPrefillItem>;
  l3?: Record<string, VittelPrefillItem>;
};

export type PrefillFacts = {
  gForce?: number | null;
  deltaVKmh?: number | null;
  rollover?: boolean | null;
  fire?: boolean | null;
  trapped?: boolean | null;
};

/**
 * Items the sensors and witnesses let us tick before a medic arrives (FR-S2-11).
 * The medic still confirms each one: every item says where it came from.
 */
export function vittelPrefill(facts: PrefillFacts, source: "iot" | "app"): VittelPrefill {
  const item: VittelPrefillItem = { value: true, source };
  const l2: Record<string, VittelPrefillItem> = {};
  if (isHighEnergy(facts)) l2["évaluation globale"] = item;
  if (facts.rollover) l2["tonneaux"] = item;
  if (facts.trapped) l2["victime incarcérée"] = item;

  const result: VittelPrefill = {};
  if (Object.keys(l2).length > 0) result.l2 = l2;
  if (facts.fire) result.l3 = { "brûlure / inhalation (suspectée)": item };
  return result;
}
