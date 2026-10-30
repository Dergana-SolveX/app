export type ProfileMedication = {
  name: string;
  class: "anticoagulant" | "beta_blocker" | "insulin" | "antihypertensive" | "other";
};

export type ProfileForRisk = {
  medications?: ProfileMedication[] | null;
  allergies?: string[] | null;
  bloodType?: string | null;
};

export type ProfileRisk = { level: "high" | "normal"; flags: string[]; prepTags: string[] };

/** What the dispatcher and the hospital should know before the patient arrives (FR-S2-18). */
export function profileRisk(profile: ProfileForRisk): ProfileRisk {
  const classes = new Set((profile.medications ?? []).map((m) => m.class));
  const flags: string[] = [];
  const prepTags: string[] = [];

  if (classes.has("anticoagulant")) {
    flags.push("risque hémorragique interne");
    prepTags.push("bilan de coagulation / antidote");
  }
  if (classes.has("insulin")) prepTags.push("glycémie capillaire");
  if (classes.has("beta_blocker")) flags.push("SI peu fiable");
  for (const allergy of profile.allergies ?? []) flags.push(`Allergie : ${allergy}`);
  if (profile.bloodType) prepTags.push(`préparer culots ${profile.bloodType} / O−`);

  return { level: classes.has("anticoagulant") ? "high" : "normal", flags, prepTags };
}
