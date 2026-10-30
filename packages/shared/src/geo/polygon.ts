/** A GeoJSON polygon: the first ring is the outline, any others are holes. Positions are [lng, lat]. */
export type GeoJsonPolygon = { type: "Polygon"; coordinates: number[][][] };

/** Ray casting: is a position inside the ring (a closed list of [lng, lat])? */
function inRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lngI, latI] = ring[i]!;
    const [lngJ, latJ] = ring[j]!;
    const crosses =
      latI! > lat !== latJ! > lat && lng < ((lngJ! - lngI!) * (lat - latI!)) / (latJ! - latI!) + lngI!;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Whether a position is inside a polygon (holes count as outside). */
export function pointInPolygon(lat: number, lng: number, polygon: GeoJsonPolygon): boolean {
  const [outline, ...holes] = polygon.coordinates;
  if (!outline || !inRing(lat, lng, outline)) return false;
  return !holes.some((hole) => inRing(lat, lng, hole));
}
