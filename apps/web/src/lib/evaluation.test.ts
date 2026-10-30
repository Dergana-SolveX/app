import { describe, expect, it } from "vitest";

import { evaluationView, type EvaluationInput } from "./evaluation";

const base: EvaluationInput = {
  recSeverity: "red",
  recUnits: [
    { type: "ambulance_medicalisee", count: 1, reason: "Incendie signalé" },
    { type: "desincarceration", count: 1 },
    { type: "vsav_standard", count: 2, reason: "Priorité basse" },
  ],
  recAuthority: "gendarmerie_nationale",
  reasons: [{ fr: "Incendie signalé", ar: "تم الإبلاغ عن حريق" }],
  vittelPrefill: {
    l2: { tonneaux: { value: true, source: "iot" } },
    l3: { "brûlure / inhalation (suspectée)": { value: true, source: "app" } },
  },
};

describe("evaluationView (what the dispatcher reads on the card)", () => {
  it("names the units in French with their count and the rule that asked for each", () => {
    expect(evaluationView(base).units).toEqual([
      { name: "Ambulance médicalisée", reason: "Incendie signalé" },
      { name: "Désincarcération", reason: null },
      { name: "VSAV × 2", reason: "Priorité basse" },
    ]);
  });

  it("names the authority with the numbers to call", () => {
    expect(evaluationView(base).authority).toMatchObject({ name: "Gendarmerie Nationale", phones: "1055", primaryPhone: "1055" });
    expect(evaluationView({ ...base, recAuthority: "surete_nationale" }).authority).toMatchObject({
      name: "Sûreté Nationale",
      phones: "17 / 1548",
      primaryPhone: "17",
    });
  });

  it("includes the routing reason and notification status on the authority", () => {
    const view = evaluationView({
      ...base,
      authorityReason: "Hors périmètre urbain (A1)",
      authorityNotification: {
        notifiedAt: "2026-10-30T19:00:00.000Z",
        phone: "1055",
        authority: "gendarmerie_nationale",
      },
    });
    expect(view.authority).toEqual({
      name: "Gendarmerie Nationale",
      phones: "1055",
      primaryPhone: "1055",
      reason: "Hors périmètre urbain (A1)",
      notification: {
        notifiedAt: "2026-10-30T19:00:00.000Z",
        phone: "1055",
        authority: "gendarmerie_nationale",
      },
    });
  });

  it("says when the position is unknown instead of hiding the authority", () => {
    expect(evaluationView({ ...base, recAuthority: null }).authority).toBeNull();
  });

  it("flattens the Vittel prefill and says which source ticked each item", () => {
    expect(evaluationView(base).vittel).toEqual([
      { level: "Niveau 2", label: "tonneaux", source: "Capteur du véhicule" },
      { level: "Niveau 3", label: "brûlure / inhalation (suspectée)", source: "Application" },
    ]);
  });

  it("an UNKNOWN incident asks for qualification and has no units to show", () => {
    const view = evaluationView({ ...base, recSeverity: "unknown", recUnits: null, vittelPrefill: null });

    expect(view.severity).toBe("unknown");
    expect(view.headline).toBe("À qualifier : données insuffisantes");
    expect(view.units).toEqual([]);
    expect(view.vittel).toEqual([]);
  });

  it("each severity has its own headline, so the card never relies on colour", () => {
    const headlines = (["red", "yellow", "green", "unknown"] as const).map(
      (recSeverity) => evaluationView({ ...base, recSeverity }).headline,
    );
    expect(new Set(headlines).size).toBe(4);
    expect(headlines[2]).toBe("Priorité basse");
  });
});
