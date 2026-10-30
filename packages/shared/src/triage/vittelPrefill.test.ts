import { describe, expect, it } from "vitest";

import { vittelPrefill } from "./vittelPrefill";

describe("vittelPrefill (FR-S2-11)", () => {
  it("a high-energy hit ticks 'évaluation globale' and records which source said so", () => {
    expect(vittelPrefill({ gForce: 5, deltaVKmh: 35 }, "iot")).toEqual({
      l2: { "évaluation globale": { value: true, source: "iot" } },
    });
    expect(vittelPrefill({ gForce: 5, deltaVKmh: 35 }, "app")).toEqual({
      l2: { "évaluation globale": { value: true, source: "app" } },
    });
  });

  it("a rollover ticks 'tonneaux' and a trapped victim ticks 'victime incarcérée'", () => {
    const result = vittelPrefill({ rollover: true, trapped: true }, "app");

    expect(result.l2).toEqual({
      tonneaux: { value: true, source: "app" },
      "victime incarcérée": { value: true, source: "app" },
    });
  });

  it("a fire is only a suspected level 3 burn / inhalation", () => {
    expect(vittelPrefill({ fire: true }, "iot")).toEqual({
      l3: { "brûlure / inhalation (suspectée)": { value: true, source: "iot" } },
    });
  });

  it("a mild hit prefills nothing", () => {
    expect(vittelPrefill({ gForce: 2, deltaVKmh: 10 }, "iot")).toEqual({});
  });
});
