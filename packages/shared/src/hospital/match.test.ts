import { describe, expect, it } from "vitest";

import type { LatLng } from "../routing/polyline";
import { loadRoadGraph } from "../routing/route";
import { assetOf } from "../routing/testing/graphs";
import { hospitalFromRow, matchHospitals, type MatchHospital } from "./match";
import type { Need, NeedResult } from "./needs";

// A straight road of 1000 m hops along one latitude, driven at 35 km/h (tertiary): 102.857 s = 1.714 min a hop.
const LAT = 36.75;
const at = (hop: number): LatLng => [LAT, 3.0 + hop * 0.01];
const HOP_MIN = 1000 / (35 / 3.6) / 60;
const graph = loadRoadGraph(
  assetOf(
    [0, 1, 2, 3].map(at),
    [[0, 1, 1000, "tertiary"], [1, 2, 1000, "tertiary"], [2, 3, 1000, "tertiary"]],
  ),
);
const ORIGIN = at(0);

const ALL: Need[] = ["neurosurgery", "ct_scanner", "burn_unit", "icu", "trauma_surgery", "obstetrics", "blood_bank", "pediatric"];
const hospital = (
  id: string,
  position: LatLng,
  has: Need[] = ALL,
  extra: Partial<MatchHospital> = {},
): MatchHospital => ({
  id, name: `Hôpital ${id}`, shortName: id, tier: "chu", lat: position[0], lng: position[1],
  capabilities: Object.fromEntries(has.map((need) => [need, true])),
  status: {}, stabilizationOnly: false, ...extra,
});
const needs = (required: Need[], preferred: Need[] = []): NeedResult => ({ required, preferred, reasons: [] });
const match = (
  required: Need[],
  hospitals: MatchHospital[],
  options: { preferred?: Need[]; severity?: "red" | "yellow" | "green" | "unknown"; inShock?: boolean; graph?: typeof graph; origin?: LatLng } = {},
) =>
  matchHospitals({
    needs: needs(required, options.preferred),
    hospitals,
    origin: options.origin ?? ORIGIN,
    graph: options.graph ?? graph,
    zones: [],
    severity: options.severity ?? "red",
    inShock: options.inShock ?? false,
  });

const A = hospital("A", at(1));
const B = hospital("B", at(2));
const C = hospital("C", at(3));

describe("matchHospitals: the score is the time plus a penalty for each gap (PRD FR-S2-27)", () => {
  it("ranks hospitals that have everything by road time, nearest first", () => {
    const result = match(["neurosurgery", "ct_scanner"], [C, A, B]);
    expect(result.ranking.map((m) => m.hospitalId)).toEqual(["A", "B", "C"]);
    expect(result.recommended!.hospitalId).toBe("A");
    expect(result.ranking[0]!.etaMin).toBeCloseTo(HOP_MIN, 1);
    expect(result.ranking[2]!.etaMin).toBeCloseTo(3 * HOP_MIN, 1);
    expect(result.ranking[0]).toMatchObject({ etaSource: "road", matched: ["neurosurgery", "ct_scanner"], missing: [], diverting: [] });
  });

  it("adds 30 minutes for each needed capability a hospital lacks, and ranks it below those that have all", () => {
    const noCt = hospital("A", at(1), ALL.filter((n) => n !== "ct_scanner"));
    const result = match(["neurosurgery", "ct_scanner"], [noCt, B, C]);
    const first = result.ranking.map((m) => m.hospitalId);
    expect(first).toEqual(["B", "C", "A"]);
    const a = result.ranking[2]!;
    expect(a.missing).toEqual(["ct_scanner"]);
    expect(a.matched).toEqual(["neurosurgery"]);
    expect(a.score).toBeCloseTo(HOP_MIN + 30, 1);
    expect(a.scoreBreakdown).toEqual({ etaMin: a.etaMin, missingPenaltyMin: 30, divertPenaltyMin: 0 });
  });

  it("adds 60 minutes for each needed capability the hospital has but is diverting", () => {
    const diverting = hospital("A", at(1), ALL, { status: { neurosurgery: "divert" } });
    const result = match(["neurosurgery", "ct_scanner"], [diverting, B]);
    const a = result.ranking.find((m) => m.hospitalId === "A")!;
    expect(a.diverting).toEqual(["neurosurgery"]);
    expect(a.matched).toEqual(["neurosurgery", "ct_scanner"]);
    expect(a.scoreBreakdown.divertPenaltyMin).toBe(60);
    expect(a.score).toBeCloseTo(HOP_MIN + 60, 1);
    expect(result.recommended!.hospitalId).toBe("B");
  });

  it("ignores a divert on something this victim does not need", () => {
    const diverting = hospital("A", at(1), ALL, { status: { burn_unit: "divert" } });
    const result = match(["neurosurgery"], [diverting, B]);
    expect(result.recommended!.hospitalId).toBe("A");
    expect(result.recommended!.diverting).toEqual([]);
  });

  it("counts a missing capability once, even when the hospital also says it diverts it", () => {
    const lacksAndDiverts = hospital("A", at(1), ALL.filter((n) => n !== "icu"), { status: { icu: "divert" } });
    const a = match(["icu"], [lacksAndDiverts]).ranking[0]!;
    expect(a.missing).toEqual(["icu"]);
    expect(a.diverting).toEqual([]);
    expect(a.scoreBreakdown).toMatchObject({ missingPenaltyMin: 30, divertPenaltyMin: 0 });
  });

  it("always has a breakdown that adds up to the score", () => {
    const mixed = hospital("A", at(1), ["neurosurgery"], { status: { neurosurgery: "divert" } });
    for (const m of match(["neurosurgery", "ct_scanner", "icu"], [mixed, B, C]).ranking) {
      const { etaMin, missingPenaltyMin, divertPenaltyMin } = m.scoreBreakdown;
      expect(etaMin + missingPenaltyMin + divertPenaltyMin).toBeCloseTo(m.score, 9);
    }
  });

  it("shows a preferred capability as present or absent but never lets it change the score", () => {
    const noPeds = hospital("A", at(1), ALL.filter((n) => n !== "pediatric"));
    const result = match([], [noPeds, B], { preferred: ["pediatric"] });
    const a = result.ranking.find((m) => m.hospitalId === "A")!;
    expect(a.preferredMissing).toEqual(["pediatric"]);
    expect(a.score).toBeCloseTo(a.etaMin, 9);
    expect(result.recommended!.hospitalId).toBe("A");
    expect(result.ranking.find((m) => m.hospitalId === "B")!.preferredMatched).toEqual(["pediatric"]);
  });

  it("keeps the given order between hospitals with the same score", () => {
    const twinA = hospital("A", at(2));
    const twinB = hospital("B", at(2));
    expect(match([], [twinB, twinA]).ranking.map((m) => m.hospitalId)).toEqual(["B", "A"]);
  });

  it("recommends nothing when there is no hospital", () => {
    expect(match(["icu"], [])).toMatchObject({ ranking: [], recommended: null, stabilisation: null, stabiliseFirst: false });
  });
});

describe("matchHospitals: when no hospital has everything (PRD FR-S2-28)", () => {
  const noIcu = ALL.filter((n) => n !== "icu");
  const poly = hospital("P", at(1), [], { tier: "epsp_polyclinic", stabilizationOnly: true });

  it("recommends the best partial match, flags the risk of a second transfer, and names the nearest stabilisation facility", () => {
    const result = match(["icu"], [hospital("A", at(2), noIcu), hospital("B", at(3), noIcu), poly]);
    expect(result.recommended!.hospitalId).toBe("A");
    expect(result.recommended!.flags).toContain("secondary_transfer_risk");
    expect(result.stabilisation!.hospitalId).toBe("P");
  });

  it("does not flag a hospital that has everything", () => {
    const result = match(["icu"], [A, poly]);
    expect(result.recommended!.flags).not.toContain("secondary_transfer_risk");
    expect(result.stabilisation).toBeNull();
  });
});

describe("matchHospitals: polyclinics (PRD FR-S2-28)", () => {
  const poly = hospital("P", at(1), [], { tier: "epsp_polyclinic", stabilizationOnly: true });

  it("never recommends a polyclinic for a serious victim, even when it is the nearest", () => {
    const result = match([], [poly, B], { severity: "red" });
    expect(result.recommended!.hospitalId).toBe("B");
    expect(result.ranking.map((m) => m.hospitalId)).toEqual(["B", "P"]);
    expect(result.ranking[1]!.flags).toContain("stabilisation_only");
  });

  it("does not recommend one when the severity is unknown either", () => {
    expect(match([], [poly, B], { severity: "unknown" }).recommended!.hospitalId).toBe("B");
  });

  it("may recommend the nearest one for a green victim", () => {
    expect(match([], [poly, B], { severity: "green" }).recommended!.hospitalId).toBe("P");
  });

  it("says to stabilise first when the best hospital is over 45 minutes away and the victim is in shock", () => {
    // 35 km of road at 35 km/h = 60 minutes to the hospital; the polyclinic is 1 km away.
    const far = loadRoadGraph(
      assetOf([at(0), at(1), [LAT, 3.2]], [[0, 1, 1000, "tertiary"], [0, 2, 35000, "tertiary"]]),
    );
    const faraway = hospital("F", [LAT, 3.2]);
    const shock = match(["icu"], [faraway, poly], { graph: far, inShock: true });
    expect(shock.recommended!.hospitalId).toBe("F");
    expect(shock.recommended!.etaMin).toBeCloseTo(60, 0);
    expect(shock.stabiliseFirst).toBe(true);
    expect(shock.stabilisation!.hospitalId).toBe("P");

    const calm = match(["icu"], [faraway, poly], { graph: far, inShock: false });
    expect(calm.stabiliseFirst).toBe(false);
    expect(calm.stabilisation).toBeNull();
  });

  it("does not say to stabilise first when the hospital is within 45 minutes", () => {
    const result = match(["icu"], [A, poly], { inShock: true });
    expect(result.stabiliseFirst).toBe(false);
  });
});

describe("matchHospitals: positions the road graph cannot serve", () => {
  it("falls back on the flagged straight-line estimate and still ranks the hospital", () => {
    const offMap = hospital("X", [35.0, 1.0]);
    const result = match([], [A, offMap]);
    const x = result.ranking.find((m) => m.hospitalId === "X")!;
    expect(x.etaSource).toBe("straight_line");
    expect(x.etaMin).toBeGreaterThan(60);
    expect(result.ranking.find((m) => m.hospitalId === "A")!.etaSource).toBe("road");
    expect(result.ranking.map((m) => m.hospitalId)).toEqual(["A", "X"]);
  });
});

describe("hospitalFromRow (a hospitals_matrix row, as the matcher reads it)", () => {
  const row = {
    id: "h1", name: "CHU Test", shortName: "Test", tier: "chu" as const, lat: 36.7, lng: 3.0,
    capNeurosurgery: true, capCtScanner: true, capBurnUnit: false, capIcu: true, capTraumaSurgery: false,
    capPediatric: false, capObstetrics: true, capBloodBank: false, capStabilizationOnly: false,
    status: { icu: "divert" as const },
  };

  it("turns each capability column into the need of the same name", () => {
    expect(hospitalFromRow(row)).toMatchObject({
      id: "h1", name: "CHU Test", shortName: "Test", tier: "chu", lat: 36.7, lng: 3.0,
      status: { icu: "divert" },
      stabilizationOnly: false,
      capabilities: {
        neurosurgery: true, ct_scanner: true, burn_unit: false, icu: true,
        trauma_surgery: false, pediatric: false, obstetrics: true, blood_bank: false,
      },
    });
  });

  it("treats a polyclinic, or a hospital marked stabilisation-only, as a stabilisation facility", () => {
    expect(hospitalFromRow({ ...row, tier: "epsp_polyclinic" }).stabilizationOnly).toBe(true);
    expect(hospitalFromRow({ ...row, capStabilizationOnly: true }).stabilizationOnly).toBe(true);
  });
});
