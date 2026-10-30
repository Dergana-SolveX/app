import { describe, expect, it } from "vitest";

import { shockIndex } from "./shock-index";

describe("shockIndex: heart rate / systolic pressure", () => {
  it("is normal up to and including 0.9", () => {
    expect(shockIndex(72, 120)).toEqual({ value: 0.6, flag: "normal", caveats: [] });
    expect(shockIndex(90, 100)).toMatchObject({ value: 0.9, flag: "normal" });
  });

  it("is elevated above 0.9, even when rounding to two decimals would show 0.90", () => {
    expect(shockIndex(91, 100)).toMatchObject({ value: 0.91, flag: "elevated" });
    expect(shockIndex(901, 1000)).toMatchObject({ value: 0.9, flag: "elevated" });
  });

  it("is critical from 1.3 upwards, and elevated just below", () => {
    expect(shockIndex(129, 100)).toMatchObject({ value: 1.29, flag: "elevated" });
    expect(shockIndex(130, 100)).toMatchObject({ value: 1.3, flag: "critical" });
    expect(shockIndex(150, 90)).toMatchObject({ value: 1.67, flag: "critical" });
  });

  it("treats a pressure that cannot be taken (0) as critical with the reason, and no number", () => {
    expect(shockIndex(110, 0)).toEqual({ value: null, flag: "critical", caveats: ["PAS imprenable"] });
  });

  it("gives no answer, never 0, when the heart rate or the pressure is missing", () => {
    expect(shockIndex(null, 120)).toBeNull();
    expect(shockIndex(80, null)).toBeNull();
    expect(shockIndex(undefined, undefined)).toBeNull();
    expect(shockIndex(Number.NaN, 120)).toBeNull();
    expect(shockIndex(null, 0)).toBeNull();
  });

  it("gives no answer for impossible values", () => {
    expect(shockIndex(-5, 120)).toBeNull();
    expect(shockIndex(80, -1)).toBeNull();
  });
});

describe("shockIndex: caveats that make the number less reliable", () => {
  it("warns about a beta-blocker", () => {
    expect(shockIndex(80, 120, { betaBlocker: true })!.caveats).toEqual(["peut sous-estimer le choc"]);
  });

  it("warns that adult thresholds do not apply under 12 years, but not from 12", () => {
    expect(shockIndex(80, 120, { ageYears: 11 })!.caveats).toEqual(["seuils adultes non applicables"]);
    expect(shockIndex(80, 120, { ageYears: 12 })!.caveats).toEqual([]);
  });

  it("warns about pregnancy", () => {
    expect(shockIndex(80, 120, { pregnant: true })!.caveats).toHaveLength(1);
    expect(shockIndex(80, 120, { pregnant: true })!.caveats[0]).toMatch(/grossesse/i);
  });

  it("warns about an antihypertensive only above 65 years", () => {
    expect(shockIndex(80, 120, { ageYears: 66, antihypertensive: true })!.caveats).toEqual(["peut sous-estimer le choc"]);
    expect(shockIndex(80, 120, { ageYears: 65, antihypertensive: true })!.caveats).toEqual([]);
    expect(shockIndex(80, 120, { ageYears: 70, antihypertensive: false })!.caveats).toEqual([]);
    expect(shockIndex(80, 120, { antihypertensive: true })!.caveats).toEqual([]);
  });

  it("does not repeat a warning when two reasons give the same one", () => {
    const result = shockIndex(80, 120, { ageYears: 70, antihypertensive: true, betaBlocker: true });
    expect(result!.caveats).toEqual(["peut sous-estimer le choc"]);
  });

  it("keeps the caveats when the pressure cannot be taken", () => {
    expect(shockIndex(110, 0, { ageYears: 8 })!.caveats).toEqual(["PAS imprenable", "seuils adultes non applicables"]);
  });
});
