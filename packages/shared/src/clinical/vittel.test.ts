import { describe, expect, it } from "vitest";

import { evaluateVittel, VITTEL_ITEMS, type VittelState } from "./vittel";

// The frozen list, typed out from PRD FR-S2-13 (not read back from the code).
const BOOLEAN_ITEMS: [level: "l1" | "l2" | "l3" | "l4" | "l5", id: string][] = [
  ["l1", "gcsLow"], ["l1", "sbpLow"], ["l1", "spo2Low"],
  ["l2", "ejection"], ["l2", "deathInVehicle"], ["l2", "thrownOrCrushed"], ["l2", "globalAssessment"], ["l2", "blast"],
  ["l2", "rollover"], ["l2", "trapped"],
  ["l3", "penetratingHead"], ["l3", "penetratingNeck"], ["l3", "penetratingThorax"], ["l3", "penetratingAbdomen"],
  ["l3", "penetratingArm"], ["l3", "penetratingThigh"], ["l3", "flailChest"], ["l3", "severeBurnOrSmoke"],
  ["l3", "pelvicFracture"], ["l3", "spinalInjury"], ["l3", "proximalAmputation"], ["l3", "limbIschaemia"],
  ["l4", "assistedVentilation"], ["l4", "catecholamines"], ["l4", "antiShockGarment"],
  ["l5", "ageOver65"], ["l5", "cardiacInsufficiency"], ["l5", "respiratoryInsufficiency"], ["l5", "pregnancyT2T3"],
  ["l5", "coagulationDisorder"],
];

const only = (level: "l1" | "l2" | "l3" | "l4" | "l5", id: string, value: boolean | number | string, source: "iot" | "app" | "medic" = "medic"): Partial<VittelState> =>
  ({ [level]: { [id]: { value, source } } });

describe("evaluateVittel: one positive item means severe", () => {
  it("is not severe with nothing recorded", () => {
    expect(evaluateVittel({})).toEqual({ severe: false, positives: [] });
  });

  it.each(BOOLEAN_ITEMS)("%s %s on its own makes the victim severe", (level, id) => {
    const result = evaluateVittel(only(level, id, true));
    expect(result.severe).toBe(true);
    expect(result.positives).toHaveLength(1);
    expect(result.positives[0]).toMatchObject({ level, id, source: "medic" });
    expect(result.positives[0]!.label.length).toBeGreaterThan(3);
  });

  it.each(BOOLEAN_ITEMS)("%s %s answered 'no' does not", (level, id) => {
    expect(evaluateVittel(only(level, id, false))).toEqual({ severe: false, positives: [] });
  });

  it("knows exactly the frozen items and no other", () => {
    const known = VITTEL_ITEMS.map((i) => `${i.level}.${i.id}`).sort();
    const expected = [...BOOLEAN_ITEMS.map(([l, i]) => `${l}.${i}`), "l2.fallHeightM", "l4.fluidsMl"].sort();
    expect(known).toEqual(expected);
  });

  it("counts a fall only above 6 m", () => {
    expect(evaluateVittel(only("l2", "fallHeightM", 6)).severe).toBe(false);
    expect(evaluateVittel(only("l2", "fallHeightM", 6.1)).severe).toBe(true);
  });

  it("counts fluids only above 1000 ml", () => {
    expect(evaluateVittel(only("l4", "fluidsMl", 1000)).severe).toBe(false);
    expect(evaluateVittel(only("l4", "fluidsMl", 1001)).severe).toBe(true);
  });

  it("ignores items it does not know, and answers of the wrong kind", () => {
    expect(evaluateVittel(only("l3", "somethingElse", true)).severe).toBe(false);
    expect(evaluateVittel(only("l3", "flailChest", "oui")).severe).toBe(false);
    expect(evaluateVittel(only("l2", "fallHeightM", true)).severe).toBe(false);
    expect(evaluateVittel(only("l2", "ejection", true) as Partial<VittelState>)).toMatchObject({ severe: true });
  });

  it("does not take an item from the wrong level", () => {
    expect(evaluateVittel(only("l5", "ejection", true)).severe).toBe(false);
  });

  it("lists every positive item, lowest level first, with where it came from", () => {
    const result = evaluateVittel({
      l5: { coagulationDisorder: { value: true, source: "app" } },
      l2: { rollover: { value: true, source: "iot" } },
      l1: { gcsLow: { value: true, source: "medic" } },
    });
    expect(result.positives.map((p) => [p.level, p.id, p.source])).toEqual([
      ["l1", "gcsLow", "medic"],
      ["l2", "rollover", "iot"],
      ["l5", "coagulationDisorder", "app"],
    ]);
  });
});
