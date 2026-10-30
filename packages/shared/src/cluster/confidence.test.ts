import { describe, expect, it } from "vitest";

import { confidence, type ConfidenceAlert } from "./confidence";

const alert = (source: ConfidenceAlert["source"], extra: Partial<ConfidenceAlert> = {}): ConfidenceAlert => ({
  source,
  crcValid: true,
  authenticated: null,
  ...extra,
});

// Expected values are worked out by hand from FR-S2-09: 1 - product(1 - weight), then the agreed
// +0.1 when the alerts come from two or more different layers (capped at 0.99), and half weight for
// an alert with a bad checksum or a failed signature.
describe("confidence", () => {
  it("is 0 with no alerts", () => {
    expect(confidence([])).toBe(0);
  });

  it("is the source weight for a single alert", () => {
    expect(confidence([alert("iot")])).toBeCloseTo(0.6, 6);
    expect(confidence([alert("app_auto")])).toBeCloseTo(0.45, 6);
    expect(confidence([alert("app_witness")])).toBeCloseTo(0.4, 6);
    expect(confidence([alert("ussd")])).toBeCloseTo(0.3, 6);
  });

  it("grows as alerts add up, without a bonus when they come from the same layer", () => {
    // Two witnesses: 1 - 0.6 * 0.6
    expect(confidence([alert("app_witness"), alert("app_witness")])).toBeCloseTo(0.64, 6);
    // A phone's own detection and a phone witness are both layer 2: still no bonus.
    expect(confidence([alert("app_auto"), alert("app_witness")])).toBeCloseTo(0.67, 6);
  });

  it("adds a bonus when different layers confirm each other", () => {
    // Chip + witness: 1 - 0.4 * 0.6 = 0.76, plus 0.1
    expect(confidence([alert("iot"), alert("app_witness")])).toBeCloseTo(0.86, 6);
    // Chip + phone + USSD: 1 - 0.4 * 0.55 * 0.7 = 0.846, plus 0.1
    expect(confidence([alert("iot"), alert("app_auto"), alert("ussd")])).toBeCloseTo(0.946, 6);
  });

  it("never reaches certainty: capped at 0.99", () => {
    const all = [alert("iot"), alert("app_auto"), alert("app_witness"), alert("ussd")];
    expect(confidence(all)).toBeCloseTo(0.99, 6);
  });

  it("counts an alert with a bad checksum at half its weight", () => {
    expect(confidence([alert("app_witness", { crcValid: false })])).toBeCloseTo(0.2, 6);
    // Chip (bad checksum, weight 0.3) + witness: 1 - 0.7 * 0.6 = 0.58, plus 0.1
    expect(confidence([alert("iot", { crcValid: false }), alert("app_witness")])).toBeCloseTo(0.68, 6);
  });

  it("counts an alert whose signature failed at half its weight, but not one that is simply unsigned", () => {
    expect(confidence([alert("iot", { authenticated: false })])).toBeCloseTo(0.3, 6);
    expect(confidence([alert("iot", { authenticated: true })])).toBeCloseTo(0.6, 6);
    expect(confidence([alert("iot", { authenticated: null })])).toBeCloseTo(0.6, 6);
  });
});
