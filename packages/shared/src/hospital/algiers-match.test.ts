import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { RoadGraphAsset } from "../routing/build";
import type { LatLng } from "../routing/polyline";
import { loadRoadGraph } from "../routing/route";
import { matchHospitals, type MatchHospital } from "./match";
import { NEEDS, type Need } from "./needs";

const asset = JSON.parse(
  readFileSync(new URL("../../assets/algiers-roads.json", import.meta.url), "utf-8"),
) as RoadGraphAsset;
const graph = loadRoadGraph(asset);

// The demo hospitals (packages/db/src/seed), each given every capability so only distance decides.
const SITES: [string, LatLng, MatchHospital["tier"]][] = [
  ["CHU Mustapha", [36.7614, 3.0586], "chu"],
  ["CHU Bab El Oued", [36.7922, 3.0517], "chu"],
  ["CHU Beni Messous", [36.7878, 2.9772], "chu"],
  ["CHU Hussein Dey", [36.744, 3.102], "chu"],
  ["EHS Zemirli", [36.72, 3.137], "ehs"],
  ["EHS Aït Idir", [36.7655, 3.051], "ehs"],
  ["EPH Rouiba", [36.738, 3.28], "eph"],
  ["EPH Aïn Taya", [36.79, 3.29], "eph"],
];
const hospitals: MatchHospital[] = SITES.map(([name, [lat, lng], tier]) => ({
  id: name, name, shortName: name, tier, lat, lng,
  capabilities: Object.fromEntries(NEEDS.map((need) => [need, true])) as Record<Need, boolean>,
  status: {}, stabilizationOnly: false,
}));

describe("matchHospitals on the real Algiers road graph", () => {
  it("puts a hospital near the scene first and the far eastern ones last, all on the road graph", () => {
    const scene: LatLng = [36.7538, 3.0588]; // Alger-Centre
    const { ranking, recommended } = matchHospitals({
      needs: { required: ["trauma_surgery", "icu"], preferred: [], reasons: [] },
      hospitals, origin: scene, graph, zones: [], severity: "red", inShock: true,
    });
    expect(["CHU Mustapha", "EHS Aït Idir"]).toContain(recommended!.hospitalId);
    expect(ranking.every((m) => m.etaSource === "road")).toBe(true);
    expect(["EPH Rouiba", "EPH Aïn Taya"]).toContain(ranking.at(-1)!.hospitalId);
    expect(ranking[0]!.etaMin).toBeLessThan(15);
  });

  it("ranks the same hospitals differently for a scene in the east", () => {
    const rouiba: LatLng = [36.742, 3.275];
    const { recommended } = matchHospitals({
      needs: { required: ["icu"], preferred: [], reasons: [] },
      hospitals, origin: rouiba, graph, zones: [], severity: "red", inShock: false,
    });
    expect(["EPH Rouiba", "EPH Aïn Taya"]).toContain(recommended!.hospitalId);
  });
});
