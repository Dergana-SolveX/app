const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const EARTH_RADIUS_M = 6_371_000;

export type GeohashPoint = {
  lat: number;
  lng: number;
  /** Distance from the cell centre to its corner, in metres: the most the real position can differ. */
  errorM: number;
};

/** Centre of a geohash cell, or null if the text is not a geohash. */
export function decodeGeohash(hash: string): GeohashPoint | null {
  if (hash.length === 0) return null;

  let lat: [number, number] = [-90, 90];
  let lng: [number, number] = [-180, 180];
  let evenBit = true; // the first bit refines longitude
  for (const char of hash.toLowerCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    for (let bit = 4; bit >= 0; bit--) {
      const range = evenBit ? lng : lat;
      const middle = (range[0] + range[1]) / 2;
      if ((index >> bit) & 1) range[0] = middle;
      else range[1] = middle;
      evenBit = !evenBit;
    }
  }

  const centreLat = (lat[0] + lat[1]) / 2;
  const centreLng = (lng[0] + lng[1]) / 2;
  const toRad = Math.PI / 180;
  const dLatM = ((lat[1] - lat[0]) / 2) * toRad * EARTH_RADIUS_M;
  const dLngM = ((lng[1] - lng[0]) / 2) * toRad * EARTH_RADIUS_M * Math.cos(centreLat * toRad);
  return { lat: centreLat, lng: centreLng, errorM: Math.hypot(dLatM, dLngM) };
}
