/** A commune of Algiers with the centre we place an alert at when a caller only names the commune. */
type Commune = { name: string; arabic: string; lat: number; lng: number };

/**
 * The communes the hospital seed covers. Positions are approximate commune centres (not surveyed):
 * good enough for a coarse "somewhere in this commune", which is why `uncertaintyM` is large.
 */
const COMMUNES: readonly Commune[] = [
  { name: "Alger-Centre", arabic: "الجزائر الوسطى", lat: 36.77, lng: 3.06 },
  { name: "Aïn Taya", arabic: "عين طاية", lat: 36.7928, lng: 3.2886 },
  { name: "Bab El Oued", arabic: "باب الوادي", lat: 36.7897, lng: 3.0514 },
  { name: "Bab Ezzouar", arabic: "باب الزوار", lat: 36.7255, lng: 3.1836 },
  { name: "Baraki", arabic: "براقي", lat: 36.6667, lng: 3.1 },
  { name: "Beni Messous", arabic: "بني مسوس", lat: 36.79, lng: 2.998 },
  { name: "Bologhine", arabic: "بولوغين", lat: 36.8083, lng: 3.0361 },
  { name: "El Harrach", arabic: "الحراش", lat: 36.7197, lng: 3.1347 },
  { name: "El Madania", arabic: "المدنية", lat: 36.7392, lng: 3.0678 },
  { name: "Hussein Dey", arabic: "حسين داي", lat: 36.7411, lng: 3.1019 },
  { name: "Rouiba", arabic: "الرويبة", lat: 36.7381, lng: 3.28 },
  { name: "Sidi M'Hamed", arabic: "سيدي امحمد", lat: 36.755, lng: 3.059 },
  { name: "Zéralda", arabic: "زرالدة", lat: 36.7117, lng: 2.8394 },
];

/** A commune is a few km across: the real spot can be well away from its centre. */
export const COMMUNE_UNCERTAINTY_M = 1_500;

export type CommunePlace = { commune: string; lat: number; lng: number; uncertaintyM: number };

/** Lower case, no accents or Arabic vowel marks, one kind of alef, punctuation as single spaces. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ًͯ-ٟ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const byName = new Map(
  COMMUNES.flatMap((c) => [
    [normalize(c.name), c] as const,
    [normalize(c.arabic), c] as const,
  ]),
);

/** Finds a commune of Algiers from what a caller typed (French or Arabic), or null if unknown. */
export function geocodeCommune(text: string): CommunePlace | null {
  const commune = byName.get(normalize(text));
  if (!commune) return null;
  return { commune: commune.name, lat: commune.lat, lng: commune.lng, uncertaintyM: COMMUNE_UNCERTAINTY_M };
}

type KilometrePoint = { pk: number; lat: number; lng: number };

/**
 * Road stretches we can place a kilometre point on, by straight-line interpolation between two
 * reference towns. Approximate (the real road bends); to be checked by a team member against a map.
 */
const ROADS: Record<string, readonly KilometrePoint[]> = {
  rn5: [
    { pk: 9, lat: 36.7197, lng: 3.1347 }, // El Harrach
    { pk: 24, lat: 36.7381, lng: 3.28 }, // Rouiba
  ],
};

/** A kilometre point is more precise than a commune, but the road is only approximated. */
export const KILOMETRE_POINT_UNCERTAINTY_M = 800;

export type LocationPlace = {
  commune?: string;
  /** Set for a kilometre point, e.g. `RN5` and 12. */
  roadRef?: string;
  pk?: number;
  lat: number;
  lng: number;
  uncertaintyM: number;
};

const KILOMETRE_POINT = /^\s*(rn)\s*(\d+)\s*,?\s*p\.?\s*k\.?\s*(\d+(?:[.,]\d+)?)\s*$/i;

function geocodeKilometrePoint(text: string): LocationPlace | null {
  const match = KILOMETRE_POINT.exec(text);
  if (!match) return null;
  const stretch = ROADS[`rn${match[2]}`];
  if (!stretch) return null;
  const pk = Number(match[3]!.replace(",", "."));
  const [from, to] = [stretch[0]!, stretch[stretch.length - 1]!];
  if (pk < from.pk || pk > to.pk) return null;
  const t = (pk - from.pk) / (to.pk - from.pk);
  return {
    roadRef: `RN${match[2]}`,
    pk,
    lat: from.lat + t * (to.lat - from.lat),
    lng: from.lng + t * (to.lng - from.lng),
    uncertaintyM: KILOMETRE_POINT_UNCERTAINTY_M,
  };
}

/** Where an alert is, from what a caller typed: a commune name or a road kilometre point such as "RN5 PK 12". */
export function geocodeLocation(text: string): LocationPlace | null {
  return geocodeKilometrePoint(text) ?? geocodeCommune(text);
}
