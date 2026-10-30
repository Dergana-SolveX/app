import { describe, expect, it } from "vitest";

import { ageYears, assembleVittel, vittelFromProfile, vittelFromVitals } from "./assemble";
import { evaluateVittel } from "./vittel";

describe("ageYears", () => {
  it("counts whole years, turning a year older on the birthday", () => {
    expect(ageYears("1960-06-15", new Date("2026-06-14T12:00:00Z"))).toBe(65);
    expect(ageYears("1960-06-15", new Date("2026-06-15T00:00:00Z"))).toBe(66);
    expect(ageYears("2020-02-29", new Date("2026-02-28T00:00:00Z"))).toBe(5);
  });

  it("gives nothing for a date it cannot read", () => {
    expect(ageYears("not a date", new Date())).toBeNull();
    expect(ageYears(null, new Date())).toBeNull();
  });
});

describe("vittelFromVitals (level 1, computed from the measures)", () => {
  it("marks each measure beyond its limit, by the medic", () => {
    expect(vittelFromVitals({ gcs: 12, sbp: 89, spo2: 89 }).l1).toEqual({
      gcsLow: { value: true, source: "medic" },
      sbpLow: { value: true, source: "medic" },
      spo2Low: { value: true, source: "medic" },
    });
  });

  it("does not mark measures at the limit", () => {
    const l1 = vittelFromVitals({ gcs: 13, sbp: 90, spo2: 90 }).l1!;
    expect(Object.values(l1).map((item) => item.value)).toEqual([false, false, false]);
  });

  it("says nothing about a measure that was not taken (unknown is not 'no')", () => {
    expect(vittelFromVitals({ gcs: 15 }).l1).toEqual({ gcsLow: { value: false, source: "medic" } });
    expect(vittelFromVitals({}).l1).toEqual({});
    expect(vittelFromVitals({ gcs: null, sbp: Number.NaN }).l1).toEqual({});
  });

  it("reads a pressure of 0 as unmeasurable, which is below the limit", () => {
    expect(vittelFromVitals({ sbp: 0 }).l1!.sbpLow).toEqual({ value: true, source: "medic" });
  });
});

describe("vittelFromProfile (level 5, from the registered profile)", () => {
  const base = { ageYears: 40, pregnancy: "none" as const, medications: [] as { name: string; class: string }[] };

  it("flags age over 65 only above 65", () => {
    expect(vittelFromProfile({ ...base, ageYears: 66 }).l5!.ageOver65).toEqual({ value: true, source: "app" });
    expect(vittelFromProfile({ ...base, ageYears: 65 }).l5!.ageOver65).toEqual({ value: false, source: "app" });
  });

  it("flags pregnancy in the 2nd and 3rd trimester only", () => {
    const flagged = (pregnancy: "none" | "t1" | "t2" | "t3") => vittelFromProfile({ ...base, pregnancy }).l5!.pregnancyT2T3!.value;
    expect([flagged("none"), flagged("t1"), flagged("t2"), flagged("t3")]).toEqual([false, false, true, true]);
  });

  it("turns an anticoagulant into a coagulation disorder", () => {
    const withDrug = vittelFromProfile({ ...base, medications: [{ name: "Sintrom", class: "anticoagulant" }] });
    expect(withDrug.l5!.coagulationDisorder).toEqual({ value: true, source: "app" });
    const other = vittelFromProfile({ ...base, medications: [{ name: "Aspegic", class: "other" }] });
    expect(other.l5!.coagulationDisorder).toEqual({ value: false, source: "app" });
  });

  it("leaves cardiac and respiratory insufficiency to the medic", () => {
    expect(Object.keys(vittelFromProfile(base).l5!).sort()).toEqual(["ageOver65", "coagulationDisorder", "pregnancyT2T3"]);
  });

  it("leaves age out when it is not known", () => {
    expect(vittelFromProfile({ ...base, ageYears: null }).l5!.ageOver65).toBeUndefined();
  });
});

describe("assembleVittel (sensors, profile, vitals, then the medic's own answers)", () => {
  it("puts every source together on the five levels", () => {
    const state = assembleVittel({
      sensors: { l2: { rollover: { value: true, source: "iot" } } },
      profile: { l5: { ageOver65: { value: false, source: "app" } } },
      vitals: { l1: { gcsLow: { value: false, source: "medic" } } },
    });
    expect(state).toEqual({
      l1: { gcsLow: { value: false, source: "medic" } },
      l2: { rollover: { value: true, source: "iot" } },
      l3: {},
      l4: {},
      l5: { ageOver65: { value: false, source: "app" } },
    });
  });

  it("lets the medic's answer win over a sensor, in both directions", () => {
    const state = assembleVittel({
      sensors: { l2: { rollover: { value: true, source: "iot" }, ejection: { value: false, source: "app" } } },
      medic: { l2: { rollover: { value: false, source: "medic" }, ejection: { value: true, source: "medic" } } },
    });
    expect(state.l2.rollover).toEqual({ value: false, source: "medic" });
    expect(state.l2.ejection).toEqual({ value: true, source: "medic" });
    expect(evaluateVittel(state).positives.map((p) => p.id)).toEqual(["ejection"]);
  });

  it("lets the measured vitals win over a sensor guess on the same item", () => {
    const state = assembleVittel({
      sensors: { l1: { gcsLow: { value: true, source: "app" } } },
      vitals: { l1: { gcsLow: { value: false, source: "medic" } } },
    });
    expect(state.l1.gcsLow).toEqual({ value: false, source: "medic" });
  });

  it("makes the victim severe from an anticoagulant in the profile alone", () => {
    const state = assembleVittel({
      profile: vittelFromProfile({ ageYears: 50, pregnancy: "none", medications: [{ name: "Sintrom", class: "anticoagulant" }] }),
    });
    expect(evaluateVittel(state)).toMatchObject({
      severe: true,
      positives: [{ level: "l5", id: "coagulationDisorder", source: "app" }],
    });
  });

  it("does not change what it was given", () => {
    const sensors = { l2: { rollover: { value: true, source: "iot" as const } } };
    const copy = structuredClone(sensors);
    assembleVittel({ sensors, medic: { l2: { rollover: { value: false, source: "medic" } } } });
    expect(sensors).toEqual(copy);
  });
});
