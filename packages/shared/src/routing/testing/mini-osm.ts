import type { OverpassData } from "../build";

const at = (lat: number, lon: number) => ({ lat, lon });

/**
 * A tiny hand-made piece of OpenStreetMap near Algiers (0.001 degree of latitude is 111 m):
 *
 *   1 ---- 2 ---- 3 ---- 7 ---- 8        way 10 primary "Rue A" 1-2-3, way 15 motorway 3->7, way 14 tertiary 8->7
 *          |      |
 *          6      4 (bend)
 *                 |
 *                 5 ---- (residential, to be ignored)
 *
 *   way 10  primary     "Rue A", two-way, nodes 1-2-3
 *   way 11  secondary   "Rue B" ref R12, one-way, nodes 3-4-5 (node 4 is only a bend)
 *   way 12  residential (not a wanted class: must be ignored), nodes 5-9
 *   way 13  motorway_link, no oneway tag (one-way is implied), nodes 2-6
 *   way 15  motorway, no oneway tag (implied), nodes 3-7
 *   way 14  tertiary    "Rue C", oneway=-1 (traffic runs 8 -> 7), nodes 7-8
 */
export const MINI_OSM: OverpassData = {
  osm3s: { timestamp_osm_base: "2026-10-30T12:57:25Z" },
  elements: [
    {
      type: "way",
      id: 10,
      nodes: [1, 2, 3],
      geometry: [at(36.75, 3.06), at(36.75, 3.062), at(36.75, 3.064)],
      tags: { highway: "primary", name: "Rue A" },
    },
    {
      type: "way",
      id: 11,
      nodes: [3, 4, 5],
      geometry: [at(36.75, 3.064), at(36.751, 3.064), at(36.752, 3.064)],
      tags: { highway: "secondary", name: "Rue B", ref: "R12", oneway: "yes" },
    },
    {
      type: "way",
      id: 12,
      nodes: [5, 9],
      geometry: [at(36.752, 3.064), at(36.753, 3.064)],
      tags: { highway: "residential", name: "Impasse" },
    },
    {
      type: "way",
      id: 13,
      nodes: [2, 6],
      geometry: [at(36.75, 3.062), at(36.749, 3.062)],
      tags: { highway: "motorway_link" },
    },
    {
      type: "way",
      id: 15,
      nodes: [3, 7],
      geometry: [at(36.75, 3.064), at(36.75, 3.066)],
      tags: { highway: "motorway" },
    },
    {
      type: "way",
      id: 14,
      nodes: [7, 8],
      geometry: [at(36.75, 3.066), at(36.75, 3.068)],
      tags: { highway: "tertiary", name: "Rue C", oneway: "-1" },
    },
  ],
};
