import { haversineM } from "./distance";

/** A cell tower: where it is and how far its signal is thought to reach (OpenCelliD `range`). */
export type Tower = { mcc: number; mnc: number; lac: number; cid: number; lat: number; lng: number; rangeM: number };

/** The tower closest to a point, with the distance, or null if none is within `maxM`. */
export function nearestTower(
  towers: readonly Tower[],
  lat: number,
  lng: number,
  maxM = Infinity,
): { tower: Tower; distanceM: number } | null {
  let best: { tower: Tower; distanceM: number } | null = null;
  for (const tower of towers) {
    const distanceM = haversineM(lat, lng, tower.lat, tower.lng);
    if (distanceM <= maxM && (best === null || distanceM < best.distanceM)) best = { tower, distanceM };
  }
  return best;
}
