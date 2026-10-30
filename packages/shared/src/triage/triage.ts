import { THRESHOLDS } from "../thresholds";
import { isHighEnergy } from "./kinematics";

export type Severity = "red" | "yellow" | "green" | "unknown";
export type UnitType = "vsav_standard" | "ambulance_medicalisee" | "desincarceration";

export type TriageFacts = {
  fire?: boolean | null;
  trapped?: boolean | null;
  rollover?: boolean | null;
  bleeding?: boolean | null;
  gForce?: number | null;
  deltaVKmh?: number | null;
  victims?: number | null;
  /** Same codes as the SVX protocol and the witness form: 0 = no, 1 = yes, 2 = don't know. */
  conscious?: 0 | 1 | 2 | null;
  /** From `profileRisk()` for the linked medical profiles; null when no profile is linked. */
  profileRisk?: "high" | null;
};

export type Reason = { fr: string; ar: string };
export type RecommendedUnit = { type: UnitType; count: number; reason?: string };
export type TriageResult = { severity: Severity; units: RecommendedUnit[]; reasons: Reason[] };

/** IoT g at or above this is RED on its own (FR-S2-15). */
const RED_G_FORCE = 8;
/** This many victims is RED, and adds one VSAV (FR-S2-15, FR-S2-16). */
const MASS_CASUALTY_VICTIMS = 3;

/** Witnesses said everybody is conscious. "Don't know" (2) and missing never count as conscious. */
function allConscious(facts: TriageFacts): boolean {
  return facts.victims != null && facts.conscious === 1;
}

export function triage(facts: TriageFacts): TriageResult {
  const g = facts.gForce ?? 0;
  const kinetic = isHighEnergy(facts) || Boolean(facts.rollover);
  const highRiskProfile = facts.profileRisk === "high";
  const massCasualty = (facts.victims ?? 0) >= MASS_CASUALTY_VICTIMS;

  // RED rules that justify a medicalised ambulance.
  const medicalReasons: Reason[] = [];
  if (facts.fire) medicalReasons.push({ fr: "Incendie signalé", ar: "تم الإبلاغ عن حريق" });
  if (facts.trapped) medicalReasons.push({ fr: "Victime incarcérée", ar: "ضحية محتجزة" });
  if (kinetic && facts.conscious === 0) {
    medicalReasons.push({ fr: "Choc violent et aucune victime consciente", ar: "صدمة عنيفة ولا ضحية واعية" });
  }
  if (g >= RED_G_FORCE) {
    medicalReasons.push({ fr: `Choc très violent (${g} g)`, ar: `صدمة شديدة جدا (${g} g)` });
  }
  if (highRiskProfile && g >= THRESHOLDS.vittelL2HighEnergy.peakG) {
    medicalReasons.push({ fr: "Profil à risque élevé et choc d'au moins 4 g", ar: "ملف عالي الخطورة وصدمة لا تقل عن 4 g" });
  }

  const redReasons = [...medicalReasons];
  if (massCasualty) {
    redReasons.push({ fr: `${facts.victims} victimes ou plus`, ar: `${facts.victims} ضحايا أو أكثر` });
  }

  const yellowReasons: Reason[] = [];
  if (kinetic) yellowReasons.push({ fr: "Choc à haute énergie", ar: "صدمة عالية الطاقة" });
  if (facts.bleeding) yellowReasons.push({ fr: "Saignement signalé", ar: "تم الإبلاغ عن نزيف" });
  if (highRiskProfile) yellowReasons.push({ fr: "Profil médical à risque élevé", ar: "ملف طبي عالي الخطورة" });

  const lowImpact = facts.gForce != null && g < THRESHOLDS.vittelL2HighEnergy.peakG;

  let severity: Severity;
  let reasons: Reason[];
  if (redReasons.length > 0) {
    severity = "red";
    reasons = redReasons;
  } else if (yellowReasons.length > 0) {
    severity = "yellow";
    reasons = yellowReasons;
  } else if (lowImpact && allConscious(facts)) {
    severity = "green";
    reasons = [{ fr: "Choc faible, toutes les victimes sont conscientes", ar: "صدمة خفيفة وجميع الضحايا واعون" }];
  } else {
    severity = "unknown";
    reasons = [{ fr: "Données insuffisantes", ar: "بيانات غير كافية" }];
  }

  const units: RecommendedUnit[] = [];
  if (medicalReasons.length > 0) {
    units.push({ type: "ambulance_medicalisee", count: 1, reason: medicalReasons[0]!.fr });
  }
  if (facts.trapped || facts.rollover) {
    units.push({ type: "desincarceration", count: 1, reason: facts.trapped ? "Victime incarcérée" : "Tonneaux" });
  }
  if (massCasualty || severity === "yellow" || severity === "green") {
    const reason = massCasualty ? redReasons[redReasons.length - 1]!.fr : reasons[0]!.fr;
    units.push({ type: "vsav_standard", count: 1, reason: severity === "green" ? "Priorité basse" : reason });
  }
  return { severity, units, reasons };
}
