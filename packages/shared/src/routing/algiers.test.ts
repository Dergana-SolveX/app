import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import type { RoadGraphAsset } from "./build";
import type { LatLng } from "./polyline";
import { estimateEtasToMany } from "./fallback";
import { loadRoadGraph, route, snapToGraph, travelTimesToMany } from "./route";

const file = new URL("../../assets/algiers-roads.json", import.meta.url);
const raw = readFileSync(file);
const asset = JSON.parse(raw.toString("utf-8")) as RoadGraphAsset;
const graph = loadRoadGraph(asset);

// Positions of the seeded demo hospitals and ambulance bases (packages/db/src/seed).
const HOSPITALS: [string, LatLng][] = [
  ["CHU Mustapha", [36.7614, 3.0586]],
  ["CHU Bab El Oued", [36.7922, 3.0517]],
  ["CHU Beni Messous", [36.7878, 2.9772]],
  ["CHU Hussein Dey", [36.744, 3.102]],
  ["EHS Zemirli", [36.72, 3.137]],
  ["EHS Aït Idir", [36.7655, 3.051]],
  ["EPH Rouiba", [36.738, 3.28]],
  ["EPH Bologhine", [36.804, 3.042]],
  ["EPH Aïn Taya", [36.79, 3.29]],
  ["Poly Bab Ezzouar", [36.725, 3.183]],
  ["Poly El Madania", [36.743, 3.062]],
  ["Poly Baraki", [36.667, 3.093]],
];
const UNITS: [string, LatLng][] = [
  ["PC-ALG-01 Alger-Centre", [36.7733, 3.0588]],
  ["PC-BEO-01 Bab El Oued", [36.7895, 3.0475]],
  ["PC-HDY-01 Hussein Dey", [36.7405, 3.0985]],
  ["PC-HRH-01 El Harrach", [36.7155, 3.1335]],
  ["PC-BEZ-01 Bab Ezzouar", [36.7225, 3.1865]],
  ["PC-ROU-01 Rouiba", [36.7385, 3.2815]],
  ["PC-DEB-01 Dar El Beïda", [36.7145, 3.2125]],
  ["PC-BMR-01 Bir Mourad Raïs", [36.7355, 3.0455]],
];
const ALGER_CENTRE: LatLng = [36.7538, 3.0588];

describe("the committed Algiers road graph", () => {
  it("credits OpenStreetMap, states its licence and date, and covers the area we asked for", () => {
    expect(asset.meta).toMatchObject({
      source: "OpenStreetMap",
      license: "ODbL 1.0",
      attribution: "© OpenStreetMap contributors",
      bbox: [36.6, 2.8, 36.85, 3.55],
    });
    expect(asset.meta.osmTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("stays under 1 MB once compressed (PRD FR-S2-20)", () => {
    const compressed = gzipSync(raw).length;
    console.log(`algiers-roads.json: ${(raw.length / 1e6).toFixed(2)} MB raw, ${(compressed / 1e6).toFixed(2)} MB gzipped`);
    expect(compressed).toBeLessThan(1_000_000);
  });

  it("is a real road network, not a handful of roads", () => {
    expect(asset.nodes.length / 2).toBeGreaterThan(3000);
    expect(asset.edges.length).toBeGreaterThan(4000);
    expect(asset.names.length).toBeGreaterThan(100);
  });

  it("reaches every demo hospital and ambulance base, so none needs the straight-line fallback", () => {
    const distances: [string, number][] = [];
    for (const [name, position] of [...HOSPITALS, ...UNITS]) {
      const snapped = snapToGraph(graph, position);
      expect(snapped, name).not.toBeNull(); // within THRESHOLDS.routing.maxSnapM
      distances.push([name, Math.round(snapped!.distanceM)]);
    }
    distances.sort((a, b) => b[1] - a[1]);
    console.log("furthest from a main-road junction:", distances.slice(0, 3).map(([n, d]) => `${n} ${d} m`).join(", "));
  });

  it("connects every demo hospital to Alger-Centre by road, in both directions", () => {
    for (const [name, position] of HOSPITALS) {
      expect(route(graph, ALGER_CENTRE, position), `Alger-Centre -> ${name}`).not.toBeNull();
      expect(route(graph, position, ALGER_CENTRE), `${name} -> Alger-Centre`).not.toBeNull();
    }
  });

  it("gives every ambulance base a road route to every hospital", () => {
    for (const [unit, from] of UNITS) {
      const times = travelTimesToMany(graph, from, HOSPITALS.map(([, p]) => p));
      times.forEach((eta, i) => expect(eta, `${unit} -> ${HOSPITALS[i]![0]}`).not.toBeNull());
    }
  });
});

// Reference trips from the OSRM public demo server (fetched 2026-10-30, car profile), as an independent
// check that our times and distances are plausible. We only use main roads and cautious ambulance speeds,
// so we allow the distance to differ by 25 % and the time by 40 %.
const OSRM: [string, LatLng, LatLng, number, number][] = [
  ["Alger-Centre -> Bab Ezzouar", [36.7538, 3.0588], [36.725, 3.183], 12570.9, 869.5],
  ["CHU Mustapha -> CHU Beni Messous", [36.7614, 3.0586], [36.7878, 2.9772], 13788.7, 907.4],
  ["EHS Zemirli -> CHU Bab El Oued", [36.72, 3.137], [36.7922, 3.0517], 13620.3, 1132.4],
  ["EPH Rouiba -> CHU Hussein Dey", [36.738, 3.28], [36.744, 3.102], 17030.4, 1320.8],
  ["Boudouaou (autoroute) -> Alger-Centre", [36.733, 3.405], [36.7538, 3.0588], 35863.7, 2271.8],
];

describe("plausible times on real Algiers trips (against OSRM)", () => {
  it.each(OSRM)("%s", (_name, from, to, referenceM, referenceS) => {
    const result = route(graph, from, to);
    expect(result).not.toBeNull();
    expect(result!.etaSource).toBe("road");
    expect(result!.distanceM / referenceM).toBeGreaterThan(0.75);
    expect(result!.distanceM / referenceM).toBeLessThan(1.25);
    expect(result!.durationS / referenceS).toBeGreaterThan(0.6);
    expect(result!.durationS / referenceS).toBeLessThan(1.4);
    expect(result!.steps.length).toBeGreaterThan(0);
    expect(result!.polyline.length).toBeGreaterThan(10);
  });

  it("answers all the hospitals from one ambulance base in well under a second", () => {
    const started = performance.now();
    const etas = estimateEtasToMany(graph, UNITS[0]![1], HOSPITALS.map(([, p]) => p), []);
    const elapsedMs = performance.now() - started;
    expect(etas.every((e) => e.etaSource === "road")).toBe(true);
    expect(elapsedMs).toBeLessThan(1000);
  });
});
