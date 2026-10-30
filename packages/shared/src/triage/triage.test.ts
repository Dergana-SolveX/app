import { describe, expect, it } from "vitest";

import { triage, type TriageFacts } from "./triage";

describe("triage severity and units (FR-S2-15, FR-S2-16)", () => {
  it("a fire is RED and asks for a medicalised ambulance, with the reason in French", () => {
    const result = triage({ fire: true });

    expect(result.severity).toBe("red");
    expect(result.units).toContainEqual(expect.objectContaining({ type: "ambulance_medicalisee", count: 1 }));
    expect(result.reasons.map((r) => r.fr)).toContain("Incendie signalé");
  });

  it("trapped victims are RED and add a désincarcération unit next to the ambulance", () => {
    const result = triage({ trapped: true });

    expect(result.severity).toBe("red");
    expect(result.units.map((u) => u.type).sort()).toEqual(["ambulance_medicalisee", "desincarceration"]);
  });

  it("a rollover asks for désincarcération; a high-energy hit with nobody conscious is RED", () => {
    const result = triage({ rollover: true, gForce: 5, deltaVKmh: 40, victims: 1, conscious: 0 });

    expect(result.severity).toBe("red");
    expect(result.units.map((u) => u.type)).toContain("desincarceration");
  });

  it("a high-energy hit alone (people conscious) is only YELLOW and gets a VSAV", () => {
    const result = triage({ gForce: 4, deltaVKmh: 30, victims: 1, conscious: 1 });

    expect(result.severity).toBe("yellow");
    expect(result.units).toEqual([expect.objectContaining({ type: "vsav_standard", count: 1 })]);
  });

  it("g of 8 or more from the chip is RED even without other signs", () => {
    const result = triage({ gForce: 8, victims: 1, conscious: 1 });

    expect(result.severity).toBe("red");
  });

  it("3 victims make it RED but add only a VSAV, not a medicalised ambulance", () => {
    const result = triage({ gForce: 2, victims: 3, conscious: 1 });

    expect(result.severity).toBe("red");
    expect(result.units).toEqual([expect.objectContaining({ type: "vsav_standard", count: 1 })]);
  });

  it("3 victims plus another RED rule gives the ambulance and one extra VSAV", () => {
    const result = triage({ fire: true, victims: 3 });

    expect(result.units.map((u) => u.type).sort()).toEqual(["ambulance_medicalisee", "vsav_standard"]);
  });

  it("a high-risk medical profile is YELLOW, and RED when the hit is at least 4 g", () => {
    expect(triage({ gForce: 3, victims: 1, conscious: 1, profileRisk: "high" }).severity).toBe("yellow");
    expect(triage({ gForce: 4, victims: 1, conscious: 1, profileRisk: "high" }).severity).toBe("red");
  });

  it("bleeding alone is YELLOW", () => {
    expect(triage({ bleeding: true, victims: 1, conscious: 1 }).severity).toBe("yellow");
  });

  it("a mild hit with everybody conscious and no flag is GREEN with a low-priority VSAV", () => {
    const result = triage({ gForce: 1.5, victims: 2, conscious: 1 });

    expect(result.severity).toBe("green");
    expect(result.units).toEqual([expect.objectContaining({ type: "vsav_standard", count: 1 })]);
  });

  it("with too little data the answer is UNKNOWN, never green, and says why", () => {
    // conscious uses the SVX codes: 0 = no, 1 = yes, 2 = "don't know".
    const cases: TriageFacts[] = [{},{ gForce: 1.5 }, { victims: 2, conscious: 1 }, { gForce: 1.5, victims: 2, conscious: 2 }];
    for (const facts of cases) {
      const result = triage(facts);
      expect(result.severity).toBe("unknown");
      expect(result.units).toEqual([]);
      expect(result.reasons.map((r) => r.fr)).toContain("Données insuffisantes");
    }
  });

  it("each unit says which rule asked for it, and a GREEN VSAV is marked low priority", () => {
    const fire = triage({ fire: true, trapped: true, victims: 3 });
    const reasonOf = (type: string) => fire.units.find((u) => u.type === type)?.reason;
    expect(reasonOf("ambulance_medicalisee")).toBe("Incendie signalé");
    expect(reasonOf("desincarceration")).toBe("Victime incarcérée");
    expect(reasonOf("vsav_standard")).toBe("3 victimes ou plus");

    const green = triage({ gForce: 1.5, victims: 1, conscious: 1 });
    expect(green.units).toEqual([expect.objectContaining({ type: "vsav_standard", reason: "Priorité basse" })]);
  });

  it("every reason carries an Arabic label", () => {
    const result = triage({ fire: true, trapped: true, gForce: 9, victims: 3, conscious: 0 });

    expect(result.reasons.length).toBeGreaterThan(0);
    for (const reason of result.reasons) expect(reason.ar).toBeTruthy();
  });
});
