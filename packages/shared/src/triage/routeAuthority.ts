import { pointInPolygon, type GeoJsonPolygon } from "../geo/polygon";

export type UrbanZone = {
  name: string;
  /** GeoJSON polygon, coordinates in [lng, lat] order. */
  polygon: GeoJsonPolygon;
};

export type AuthorityRoute = {
  authority: "surete_nationale" | "gendarmerie_nationale";
  phones: string[];
  reason: string;
};

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

  const zone = zones.find((z) => pointInPolygon(lat, lng, z.polygon));
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
