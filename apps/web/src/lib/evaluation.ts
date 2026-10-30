export type Severity = "red" | "yellow" | "green" | "unknown";

type PrefillItem = { value: boolean | number | string; source: "iot" | "app" | "medic" };

/** The fields of `incidents.byId` the card reads. */
export type EvaluationInput = {
  recSeverity: Severity;
  recUnits: { type: string; count: number; reason?: string }[] | null;
  recAuthority: "surete_nationale" | "gendarmerie_nationale" | null;
  authorityReason?: string | null;
  authorityNotification?: { notifiedAt: string; phone: string; authority: string } | null;
  reasons: { fr: string; ar: string }[];
  vittelPrefill: Partial<Record<"l1" | "l2" | "l3" | "l4" | "l5", Record<string, PrefillItem>>> | null;
};

const UNIT_NAMES: Record<string, string> = {
  ambulance_medicalisee: "Ambulance médicalisée",
  desincarceration: "Désincarcération",
  vsav_standard: "VSAV",
};

const AUTHORITIES = {
  surete_nationale: { name: "Sûreté Nationale", phones: "17 / 1548", primaryPhone: "17" },
  gendarmerie_nationale: { name: "Gendarmerie Nationale", phones: "1055", primaryPhone: "1055" },
} as const;

/** One sentence per severity, so the card never depends on colour to be understood. UNKNOWN is never "fine". */
const HEADLINES: Record<Severity, string> = {
  red: "Urgence vitale probable",
  yellow: "Vigilance : intervention rapide",
  green: "Priorité basse",
  unknown: "À qualifier : données insuffisantes",
};

const SOURCES = { iot: "Capteur du véhicule", app: "Application", medic: "Secouriste" } as const;

/** Everything the evaluation card shows, as plain text and lists (kept free of React so it is easy to test). */
export function evaluationView(card: EvaluationInput) {
  return {
    severity: card.recSeverity,
    headline: HEADLINES[card.recSeverity],
    reasons: card.reasons,
    units: (card.recUnits ?? []).map((unit) => {
      const name = UNIT_NAMES[unit.type] ?? unit.type;
      return { name: unit.count > 1 ? `${name} × ${unit.count}` : name, reason: unit.reason ?? null };
    }),
    authority: card.recAuthority
      ? {
          ...AUTHORITIES[card.recAuthority],
          reason: card.authorityReason ?? null,
          notification: card.authorityNotification ?? null,
        }
      : null,
    vittel: Object.entries(card.vittelPrefill ?? {}).flatMap(([level, items]) =>
      Object.entries(items ?? {}).map(([label, item]) => ({
        level: `Niveau ${level.slice(1)}`,
        label,
        source: SOURCES[item.source],
      })),
    ),
  };
}
