export type SvxFieldKind = "header" | "who" | "where" | "when" | "severity" | "status" | "proof" | "other";

export type SvxField = {
  key: string;
  value: string;
  /** What it says, in French, for the packet anatomy card. */
  meaning: string;
  /** Its role, so the card can colour the fields by what they are for. */
  kind: SvxFieldKind;
};

const yesNo = (value: string) => (value === "1" ? "oui" : "non");

/** Algeria is on UTC+1 all year. */
function algiersClock(minutesSince1970: number): string {
  const minuteOfDay = (((minutesSince1970 + 60) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")} (Alger)`;
}

const KNOWN: Record<string, { kind: SvxFieldKind; meaning: (value: string) => string }> = {
  L: { kind: "who", meaning: (v) => ({ "1": "puce embarquée", "2": "application mobile", "3": "relais USSD" })[v] ?? "origine inconnue" },
  GH: { kind: "where", meaning: () => "position (geohash, environ 20 m)" },
  T: { kind: "when", meaning: (v) => algiersClock(parseInt(v, 36)) },
  G: { kind: "severity", meaning: (v) => `${v} g` },
  R: { kind: "status", meaning: yesNo },
  FIRE: { kind: "status", meaning: yesNo },
  V: { kind: "severity", meaning: (v) => `${v} victime${v === "1" ? "" : "s"}` },
  C: { kind: "status", meaning: (v) => ({ "0": "inconscient", "1": "conscient", "2": "inconnu" })[v] ?? "inconnu" },
  TR: { kind: "status", meaning: yesNo },
  B: { kind: "status", meaning: yesNo },
  UID: { kind: "who", meaning: () => "code du profil médical (aucune donnée médicale)" },
  DV: { kind: "severity", meaning: (v) => `${v} km/h` },
  CI: { kind: "where", meaning: () => "antenne GSM la plus proche (Cell-ID)" },
  H: { kind: "proof", meaning: () => "signature HMAC de la puce" },
  CK: { kind: "proof", meaning: () => "somme de contrôle CRC-8" },
};

/**
 * Takes an SVX v1 SMS apart, field by field, with what each one means and how many of the 160 characters of
 * one SMS it uses up (for the packet anatomy card of the IoT Showcase, PRD FR-S8-08).
 */
export function explainSvx(sms: string): { fields: SvxField[]; length: number; limit: number } {
  const fields: SvxField[] = sms === "" ? [] : sms.split("#").map((part, index) => {
    if (index === 0) return { key: part, value: "", meaning: "protocole SVX version 1", kind: "header" as const };
    const colon = part.indexOf(":");
    const key = colon === -1 ? part : part.slice(0, colon);
    const value = colon === -1 ? "" : part.slice(colon + 1);
    const known = KNOWN[key];
    return known
      ? { key, value, meaning: known.meaning(value), kind: known.kind }
      : { key, value, meaning: "champ inconnu", kind: "other" as const };
  });
  return { fields, length: sms.length, limit: 160 };
}
