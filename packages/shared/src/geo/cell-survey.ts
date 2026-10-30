/**
 * Cell Survey domain model and utilities (PRD FR-S4-08).
 * Provides typing, validation, parsing, and Algerian operator mapping for cellular tower surveys.
 */

export type CellIdentifier = {
  mcc: number;
  mnc: number;
  lac: number;
  cid: number;
};

export type OperatorInfo = {
  name: string;
  nameAr: string;
  brandColor: string;
  mcc: number;
  mnc: number;
};

export type CellSurveyInput = CellIdentifier & {
  lat: number;
  lng: number;
  rangeM?: number;
  signalDbm?: number | null;
  recordedAt?: string | null;
};

export type ValidatedCellSurvey = CellIdentifier & {
  lat: number;
  lng: number;
  rangeM: number;
  source: "survey";
  signalDbm?: number | null;
  recordedAt: string;
};

const OPERATORS_DZ: Record<number, { name: string; nameAr: string; brandColor: string }> = {
  1: { name: "Mobilis", nameAr: "موبيليس", brandColor: "#10b981" },
  2: { name: "Djezzy", nameAr: "جيزي", brandColor: "#ef4444" },
  3: { name: "Ooredoo", nameAr: "أوريدو", brandColor: "#f59e0b" },
};

/**
 * Returns brand metadata for an operator given MCC and MNC.
 */
export function getOperatorInfo(mcc: number, mnc: number): OperatorInfo {
  if (mcc === 603 && OPERATORS_DZ[mnc]) {
    const op = OPERATORS_DZ[mnc]!;
    return {
      name: op.name,
      nameAr: op.nameAr,
      brandColor: op.brandColor,
      mcc,
      mnc,
    };
  }
  return {
    name: `Opérateur ${mcc}-${mnc}`,
    nameAr: "شبكة غير معروفة",
    brandColor: "#64748b",
    mcc,
    mnc,
  };
}

/**
 * Formats cell parameters into standard hyphenated string (e.g., "603-1-100-2").
 */
export function formatCellId({ mcc, mnc, lac, cid }: CellIdentifier): string {
  return `${mcc}-${mnc}-${lac}-${cid}`;
}

/**
 * Parses a standard cell id string (e.g., "603-1-100-2" or "603-01-100-2") into numeric components.
 * Returns null if the format is invalid.
 */
export function parseCellId(str: string): CellIdentifier | null {
  if (!str || typeof str !== "string") return null;
  const parts = str.trim().split("-");
  if (parts.length !== 4) return null;

  const [mccStr, mncStr, lacStr, cidStr] = parts;
  const mcc = Number.parseInt(mccStr!, 10);
  const mnc = Number.parseInt(mncStr!, 10);
  const lac = Number.parseInt(lacStr!, 10);
  const cid = Number.parseInt(cidStr!, 10);

  if (
    Number.isNaN(mcc) ||
    Number.isNaN(mnc) ||
    Number.isNaN(lac) ||
    Number.isNaN(cid) ||
    mcc <= 0 ||
    mnc <= 0 ||
    lac <= 0 ||
    cid <= 0
  ) {
    return null;
  }

  return { mcc, mnc, lac, cid };
}

/**
 * Validates a cell survey input point before sending to the server or database.
 */
export function validateCellSurvey(input: CellSurveyInput): ValidatedCellSurvey {
  const { mcc, mnc, lac, cid, lat, lng, rangeM, signalDbm, recordedAt } = input;

  if (!Number.isInteger(mcc) || mcc <= 0) {
    throw new Error(`Code MCC invalide (${mcc}) : doit être un entier positif.`);
  }
  if (!Number.isInteger(mnc) || mnc <= 0) {
    throw new Error(`Code MNC invalide (${mnc}) : doit être un entier positif.`);
  }
  if (!Number.isInteger(lac) || lac <= 0) {
    throw new Error(`Code LAC invalide (${lac}) : doit être un entier positif.`);
  }
  if (!Number.isInteger(cid) || cid <= 0) {
    throw new Error(`Code CID invalide (${cid}) : doit être un entier positif.`);
  }

  if (typeof lat !== "number" || Number.isNaN(lat) || lat < -90 || lat > 90) {
    throw new Error(`Latitude invalide (${lat}) : doit être comprise entre -90 et +90.`);
  }
  if (typeof lng !== "number" || Number.isNaN(lng) || lng < -180 || lng > 180) {
    throw new Error(`Longitude invalide (${lng}) : doit être comprise entre -180 et +180.`);
  }

  const validRangeM =
    typeof rangeM === "number" && !Number.isNaN(rangeM) && rangeM > 0
      ? Math.round(rangeM)
      : 1000;

  return {
    mcc,
    mnc,
    lac,
    cid,
    lat,
    lng,
    rangeM: validRangeM,
    source: "survey",
    signalDbm: typeof signalDbm === "number" ? signalDbm : null,
    recordedAt: recordedAt ?? new Date().toISOString(),
  };
}
