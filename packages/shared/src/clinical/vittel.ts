import { THRESHOLDS } from "../thresholds";

export type VittelLevel = "l1" | "l2" | "l3" | "l4" | "l5";
export type VittelSource = "iot" | "app" | "medic";
export type VittelItem = { value: boolean | number | string; source: VittelSource };
export type VittelState = Record<VittelLevel, Record<string, VittelItem>>;

type ItemDefinition = {
  level: VittelLevel;
  id: string;
  label: string;
  /** What counts as positive: a yes, or a measure beyond a cut-off. */
  positive: (value: VittelItem["value"]) => boolean;
};

const yes = (value: VittelItem["value"]) => value === true;
const above = (limit: number) => (value: VittelItem["value"]) => typeof value === "number" && value > limit;

const { fallAboveM, fluidsAboveMl } = THRESHOLDS.vittel;

/** The frozen list of Vittel criteria (PRD FR-S2-13), lowest level first. Any positive item means severe. */
export const VITTEL_ITEMS: readonly ItemDefinition[] = [
  { level: "l1", id: "gcsLow", label: "Glasgow < 13", positive: yes },
  { level: "l1", id: "sbpLow", label: "PAS < 90 mmHg", positive: yes },
  { level: "l1", id: "spo2Low", label: "SpO2 < 90 %", positive: yes },
  { level: "l2", id: "ejection", label: "Éjection", positive: yes },
  { level: "l2", id: "deathInVehicle", label: "Décès dans le même véhicule", positive: yes },
  { level: "l2", id: "fallHeightM", label: `Chute de plus de ${fallAboveM} m`, positive: above(fallAboveM) },
  { level: "l2", id: "thrownOrCrushed", label: "Projeté ou écrasé", positive: yes },
  { level: "l2", id: "globalAssessment", label: "Évaluation globale (déformation, vitesse, sans ceinture ni casque)", positive: yes },
  { level: "l2", id: "blast", label: "Effet de souffle", positive: yes },
  { level: "l2", id: "rollover", label: "Tonneaux", positive: yes },
  { level: "l2", id: "trapped", label: "Victime incarcérée", positive: yes },
  { level: "l3", id: "penetratingHead", label: "Plaie pénétrante de la tête", positive: yes },
  { level: "l3", id: "penetratingNeck", label: "Plaie pénétrante du cou", positive: yes },
  { level: "l3", id: "penetratingThorax", label: "Plaie pénétrante du thorax", positive: yes },
  { level: "l3", id: "penetratingAbdomen", label: "Plaie pénétrante de l'abdomen", positive: yes },
  { level: "l3", id: "penetratingArm", label: "Plaie pénétrante du bras", positive: yes },
  { level: "l3", id: "penetratingThigh", label: "Plaie pénétrante de la cuisse", positive: yes },
  { level: "l3", id: "flailChest", label: "Volet thoracique", positive: yes },
  { level: "l3", id: "severeBurnOrSmoke", label: "Brûlure grave ou inhalation de fumées", positive: yes },
  { level: "l3", id: "pelvicFracture", label: "Fracture du bassin", positive: yes },
  { level: "l3", id: "spinalInjury", label: "Suspicion de lésion du rachis", positive: yes },
  { level: "l3", id: "proximalAmputation", label: "Amputation au-dessus du poignet ou de la cheville", positive: yes },
  { level: "l3", id: "limbIschaemia", label: "Ischémie aiguë d'un membre", positive: yes },
  { level: "l4", id: "assistedVentilation", label: "Ventilation assistée", positive: yes },
  { level: "l4", id: "fluidsMl", label: `Remplissage de plus de ${fluidsAboveMl} ml`, positive: above(fluidsAboveMl) },
  { level: "l4", id: "catecholamines", label: "Catécholamines", positive: yes },
  { level: "l4", id: "antiShockGarment", label: "Pantalon antichoc", positive: yes },
  { level: "l5", id: "ageOver65", label: `Âge de plus de ${THRESHOLDS.vittel.ageAbove} ans`, positive: yes },
  { level: "l5", id: "cardiacInsufficiency", label: "Insuffisance cardiaque ou coronarienne", positive: yes },
  { level: "l5", id: "respiratoryInsufficiency", label: "Insuffisance respiratoire", positive: yes },
  { level: "l5", id: "pregnancyT2T3", label: "Grossesse (2e ou 3e trimestre)", positive: yes },
  { level: "l5", id: "coagulationDisorder", label: "Trouble de la coagulation", positive: yes },
];

export type VittelPositive = { level: VittelLevel; id: string; label: string; source: VittelSource };
export type VittelResult = { severe: boolean; positives: VittelPositive[] };

/** One positive item means severe (PRD FR-S2-13). Items the list does not know are ignored. */
export function evaluateVittel(state: Partial<VittelState>): VittelResult {
  const positives: VittelPositive[] = [];
  for (const { level, id, label, positive } of VITTEL_ITEMS) {
    const item = state[level]?.[id];
    if (item && positive(item.value)) positives.push({ level, id, label, source: item.source });
  }
  return { severe: positives.length > 0, positives };
}
