/** Mean Earth radius in metres. */
const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/** Great-circle distance between two positions, in metres (haversine formula). */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const p1 = toRadians(lat1);
  const p2 = toRadians(lat2);
  const dLat = p2 - p1;
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export type BoundingBox = { minLat: number; maxLat: number; minLng: number; maxLng: number };

/**
 * A box that contains every point within `radiusM` of a position. Cheap to filter on with indexed
 * latitude/longitude columns before the exact haversine check. Not meant for the poles or the antimeridian.
 */
export function boundingBox(lat: number, lng: number, radiusM: number): BoundingBox {
  const latDelta = toDegrees(radiusM / EARTH_RADIUS_M);
  const lngDelta = toDegrees(radiusM / (EARTH_RADIUS_M * Math.cos(toRadians(lat))));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}
