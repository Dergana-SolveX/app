/**
 * One-off script: downloads the main roads of Algiers from OpenStreetMap (Overpass API) and writes the compact
 * road graph the app uses, `packages/shared/assets/algiers-roads.json`. Run it with:
 *
 *   bun run build:roads
 *
 * It needs the internet; the app and the tests never do. Re-run it only to refresh the map data, and commit the result.
 * The area is downloaded in tiles (a big single request is often cut by the public servers) and merged.
 * Data: © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
 */
import { writeFileSync } from "node:fs";

import { buildRoadGraph, type OverpassData, type OverpassWay } from "../src/routing/build";

/** [south, west, north, east]: Algiers and the autoroute east to Boudouaou. */
const BBOX: [number, number, number, number] = [36.6, 2.8, 36.85, 3.55];
const TILES = 3;

const CLASSES = [
  "motorway", "trunk", "primary", "secondary", "tertiary",
  "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
];

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const OUT = new URL("../assets/algiers-roads.json", import.meta.url);

async function downloadTile(bbox: [number, number, number, number], label: string): Promise<OverpassData> {
  const query = `[out:json][timeout:180];way["highway"~"^(${CLASSES.join("|")})$"](${bbox.join(",")});out geom;`;
  for (let attempt = 1; attempt <= 8; attempt++) {
    for (const url of MIRRORS) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            // Overpass refuses anonymous clients.
            "user-agent": "svx-rescue-hackathon/0.1 (road graph build; github.com/Dergana-SolveX/app)",
            accept: "*/*",
          },
          body: new URLSearchParams({ data: query }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const answer = (await response.json()) as OverpassData & { remark?: string };
        // A busy server answers 200 with a remark and whatever it managed to find: that data is incomplete.
        if (answer.remark) throw new Error(`incomplete answer: ${answer.remark}`);
        return answer;
      } catch (error) {
        console.log(`  ${label}: ${new URL(url).host} failed (${(error as Error).message.slice(0, 60)}), attempt ${attempt}`);
      }
    }
    await new Promise((r) => setTimeout(r, 10_000 * attempt));
  }
  throw new Error(`Could not download tile ${label} from any Overpass mirror`);
}

const [south, west, north, east] = BBOX;
const ways = new Map<number, OverpassWay>();
let timestamp: string | undefined;

for (let row = 0; row < TILES; row++) {
  for (let col = 0; col < TILES; col++) {
    const label = `tile ${row * TILES + col + 1}/${TILES * TILES}`;
    const tile: [number, number, number, number] = [
      south + ((north - south) * row) / TILES,
      west + ((east - west) * col) / TILES,
      south + ((north - south) * (row + 1)) / TILES,
      west + ((east - west) * (col + 1)) / TILES,
    ];
    const osm = await downloadTile(tile, label);
    timestamp = osm.osm3s?.timestamp_osm_base ?? timestamp;
    for (const element of osm.elements) if (element.type === "way") ways.set((element as OverpassWay).id, element as OverpassWay);
    console.log(`${label}: ${osm.elements.length} roads (${ways.size} unique so far)`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

console.log(`Downloaded ${ways.size} roads (OpenStreetMap data from ${timestamp}).`);
const asset = buildRoadGraph(
  { osm3s: { timestamp_osm_base: timestamp }, elements: [...ways.values()] },
  { bbox: BBOX },
);
writeFileSync(OUT, JSON.stringify(asset));
console.log(`Wrote ${asset.nodes.length / 2} nodes and ${asset.edges.length} edges to assets/algiers-roads.json`);
