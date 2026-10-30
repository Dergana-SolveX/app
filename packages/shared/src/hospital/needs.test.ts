import { describe, expect, it } from "vitest";

import { deriveNeeds, needFacts, type NeedFacts } from "./needs";

const none: NeedFacts = {
  gcs: null, sbp: null, shockIndex: null, headTrauma: false, burn: false, spinal: false,
  pregnant: false, ageYears: null, polytrauma: false,
};
const needs = (facts: Partial<NeedFacts>) => deriveNeeds({ ...none, ...facts });

describe("deriveNeeds (PRD FR-S2-26)", () => {
  it("asks for nothing when nothing is wrong or known", () => {
    expect(needs({})).toEqual({ required: [], preferred: [], reasons: [] });
  });

  it("asks for neurosurgery and a CT scanner at GCS 13 or less, not at 14", () => {
    expect(needs({ gcs: 13 }).required).toEqual(["neurosurgery", "ct_scanner"]);
    expect(needs({ gcs: 3 }).required).toEqual(["neurosurgery", "ct_scanner"]);
    expect(needs({ gcs: 14 }).required).toEqual([]);
  });

  it("asks for neurosurgery and a CT scanner for a head trauma or a spinal injury", () => {
    expect(needs({ headTrauma: true }).required).toEqual(["neurosurgery", "ct_scanner"]);
    expect(needs({ spinal: true }).required).toEqual(["neurosurgery", "ct_scanner"]);
  });

  it("asks for a burn unit for a burn or smoke inhalation", () => {
    expect(needs({ burn: true }).required).toEqual(["burn_unit"]);
  });

  it("asks for trauma surgery, a blood bank and an ICU in shock: Shock Index above 0.9 or pressure under 90", () => {
    const shock = ["trauma_surgery", "icu", "blood_bank"];
    expect(needs({ shockIndex: 0.91 }).required.sort()).toEqual([...shock].sort());
    expect(needs({ sbp: 89 }).required.sort()).toEqual([...shock].sort());
    expect(needs({ sbp: 0 }).required.sort()).toEqual([...shock].sort());
    expect(needs({ shockIndex: 0.9, sbp: 90 }).required).toEqual([]);
  });

  it("asks for obstetrics when the victim is pregnant", () => {
    expect(needs({ pregnant: true }).required).toEqual(["obstetrics"]);
  });

  it("prefers, without requiring, a paediatric unit under 15 years", () => {
    expect(needs({ ageYears: 14 })).toMatchObject({ required: [], preferred: ["pediatric"] });
    expect(needs({ ageYears: 0 }).preferred).toEqual(["pediatric"]);
    expect(needs({ ageYears: 15 }).preferred).toEqual([]);
  });

  it("asks for trauma surgery, an ICU and a CT scanner for a polytrauma", () => {
    expect(needs({ polytrauma: true }).required.sort()).toEqual(["ct_scanner", "icu", "trauma_surgery"]);
  });

  it("lists each need once, in a fixed order, when several rules ask for it", () => {
    const all = needs({ gcs: 8, headTrauma: true, spinal: true, burn: true, sbp: 80, polytrauma: true, pregnant: true });
    expect(all.required).toEqual([
      "neurosurgery", "ct_scanner", "burn_unit", "icu", "trauma_surgery", "obstetrics", "blood_bank",
    ]);
  });

  it("gives a reason in French for every need, naming what triggered it", () => {
    const { reasons } = needs({ gcs: 9, sbp: 85, burn: true });
    const reasonFor = (need: string) => reasons.filter((r) => r.need === need).map((r) => r.why).join(" ");
    expect(reasonFor("neurosurgery")).toMatch(/Glasgow/);
    expect(reasonFor("burn_unit")).toMatch(/brûlure/i);
    expect(reasonFor("blood_bank")).toMatch(/choc|PAS/);
    expect(new Set(reasons.map((r) => r.need))).toEqual(new Set(["neurosurgery", "ct_scanner", "burn_unit", "trauma_surgery", "blood_bank", "icu"]));
  });
});

describe("needFacts (what the bilan tells the rules)", () => {
  const empty = { gcs: null, sbp: null, shockIndex: null, ageYears: null, pregnant: false, injuries: [], vittel: {} };

  it("reads the injuries the medic ticked", () => {
    expect(needFacts({ ...empty, injuries: ["Tête"] }).headTrauma).toBe(true);
    expect(needFacts({ ...empty, injuries: ["Brûlure"] }).burn).toBe(true);
    expect(needFacts({ ...empty, injuries: ["Rachis cervical"] }).spinal).toBe(true);
    expect(needFacts({ ...empty, injuries: ["Hémorragie externe"] })).toMatchObject({ headTrauma: false, burn: false, spinal: false });
  });

  it("reads the Vittel anatomical answers too", () => {
    const yes = { value: true, source: "medic" as const };
    expect(needFacts({ ...empty, vittel: { l3: { penetratingHead: yes } } }).headTrauma).toBe(true);
    expect(needFacts({ ...empty, vittel: { l3: { severeBurnOrSmoke: yes } } }).burn).toBe(true);
    expect(needFacts({ ...empty, vittel: { l3: { spinalInjury: yes } } }).spinal).toBe(true);
    expect(needFacts({ ...empty, vittel: { l3: { flailChest: { value: false, source: "medic" } } } }).polytrauma).toBe(false);
  });

  it("does not take a penetrating neck wound for a head trauma, but counts it as its own body region", () => {
    const yes = { value: true, source: "medic" as const };
    expect(needFacts({ ...empty, vittel: { l3: { penetratingNeck: yes } } })).toMatchObject({ headTrauma: false, polytrauma: false });
    expect(needFacts({ ...empty, vittel: { l3: { penetratingNeck: yes } }, injuries: ["Thorax"] }).polytrauma).toBe(true);
  });

  it("calls it a polytrauma from two different body regions, from either source, but not from one", () => {
    expect(needFacts({ ...empty, injuries: ["Thorax"] }).polytrauma).toBe(false);
    expect(needFacts({ ...empty, injuries: ["Thorax", "Thorax"] }).polytrauma).toBe(false);
    expect(needFacts({ ...empty, injuries: ["Thorax", "Abdomen"] }).polytrauma).toBe(true);
    expect(needFacts({ ...empty, injuries: ["Membre supérieur", "Membre inférieur"] }).polytrauma).toBe(false); // both are limbs
    const yes = { value: true, source: "medic" as const };
    expect(needFacts({ ...empty, injuries: ["Bassin"], vittel: { l3: { penetratingAbdomen: yes } } }).polytrauma).toBe(true);
  });

  it("passes the measures through unchanged", () => {
    expect(needFacts({ ...empty, gcs: 9, sbp: 85, shockIndex: 1.1, ageYears: 7, pregnant: true })).toMatchObject({
      gcs: 9, sbp: 85, shockIndex: 1.1, ageYears: 7, pregnant: true,
    });
  });
});
