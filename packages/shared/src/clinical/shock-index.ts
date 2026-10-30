import { THRESHOLDS } from "../thresholds";

export type ShockFlag = "normal" | "elevated" | "critical";

export type ShockContext = {
  ageYears?: number | null;
  betaBlocker?: boolean;
  antihypertensive?: boolean;
  pregnant?: boolean;
};

export type ShockIndex = {
  /** Heart rate / systolic pressure to two decimals; null when the pressure could not be taken. */
  value: number | null;
  flag: ShockFlag;
  /** Why the number may be less reliable, in French for the medic. */
  caveats: string[];
};

const UNDERESTIMATES = "peut sous-estimer le choc";

const present = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Shock Index (PRD FR-S2-14). Null when the heart rate or the pressure is missing: never 0. */
export function shockIndex(
  hr: number | null | undefined,
  sbp: number | null | undefined,
  context: ShockContext = {},
): ShockIndex | null {
  if (!present(hr) || !present(sbp)) return null;
  const { elevatedAbove, criticalFrom, childUnderYears, elderlyOverYears } = THRESHOLDS.shockIndex;
  const { ageYears, betaBlocker, antihypertensive, pregnant } = context;

  const caveats: string[] = [];
  if (sbp === 0) caveats.push("PAS imprenable");
  if (betaBlocker) caveats.push(UNDERESTIMATES);
  if (typeof ageYears === "number" && ageYears < childUnderYears) caveats.push("seuils adultes non applicables");
  if (pregnant) caveats.push("grossesse : à interpréter avec prudence");
  if (antihypertensive && typeof ageYears === "number" && ageYears > elderlyOverYears) caveats.push(UNDERESTIMATES);

  if (sbp === 0) return { value: null, flag: "critical", caveats: [...new Set(caveats)] };

  const exact = hr / sbp;
  const flag: ShockFlag = exact >= criticalFrom ? "critical" : exact > elevatedAbove ? "elevated" : "normal";
  return { value: Math.round(exact * 100) / 100, flag, caveats: [...new Set(caveats)] };
}
