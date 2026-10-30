export type UrbanZone = {
  name: string;
  /** GeoJSON polygon, coordinates in [lng, lat] order. */
  polygon: { type: "Polygon"; coordinates: number[][][] };
};

export type AuthorityRoute = {
  authority: "surete_nationale" | "gendarmerie_nationale";
  phones: string[];
  reason: string;
};

/** Ray casting on the outer ring; `x` is longitude and `y` latitude. */
function insideRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi! > lat !== yj! > lat && lng < ((xj! - xi!) * (lat - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

/**
 * Inside an urban perimeter the Sûreté Nationale answers, anywhere else (rural roads, national
 * roads and motorways outside a perimeter) the Gendarmerie Nationale does (FR-S2-19).
 * `roadRef` is kept for the reason text only, the rule never lets a road override a perimeter.
 */
export function routeAuthority(
  lat: number | null | undefined,
  lng: number | null | undefined,
  zones: UrbanZone[],
  roadRef?: string | null,
): AuthorityRoute | null {
  if (lat == null || lng == null) return null;

  const zone = zones.find((z) => insideRing(lat, lng, z.polygon.coordinates[0] ?? []));
  if (zone) {
    return {
      authority: "surete_nationale",
      phones: ["17", "1548"],
      reason: `Périmètre urbain : ${zone.name}`,
    };
  }
  return {
    authority: "gendarmerie_nationale",
    phones: ["1055"],
    reason: roadRef ? `Hors périmètre urbain (${roadRef})` : "Hors périmètre urbain",
  };
}
