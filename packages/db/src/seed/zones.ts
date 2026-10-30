import type { zones } from "../schema";

type Row = typeof zones.$inferInsert;

// Hand-drawn rough perimeters (GeoJSON order is [lng, lat]). DEMO DATA, not official boundaries.
const box = (w: number, s: number, e: number, n: number) => ({
  type: "Polygon" as const,
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
});

export const zoneRows: Row[] = [
  { id: "00000000-0000-4000-8000-000000000501", name: "Alger-Centre", polygon: box(3.03, 36.75, 3.08, 36.79) },
  { id: "00000000-0000-4000-8000-000000000502", name: "Bab Ezzouar", polygon: box(3.165, 36.715, 3.205, 36.74) },
  { id: "00000000-0000-4000-8000-000000000503", name: "Rouiba", polygon: box(3.25, 36.725, 3.31, 36.755) },
];
