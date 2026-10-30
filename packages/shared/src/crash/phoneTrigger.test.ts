import { describe, expect, it } from "vitest";

import { THRESHOLDS } from "../thresholds";
import {
  createPhoneTriggerFilter,
} from "./phoneTrigger";

describe("phoneTrigger crash detection filter (FR-S4-01, FR-S2-12)", () => {
  it("detects a valid car crash (speed >= 25 km/h in last 10s, peak >= 4g, then stopped < 5 km/h)", () => {
    const filter = createPhoneTriggerFilter();
    const t0 = 100000;

    // Driving at 60 km/h for the last 5 seconds
    filter.pushSpeed(t0 - 5000, 60);
    filter.pushSpeed(t0 - 2000, 58);
    filter.pushSpeed(t0 - 500, 55);

    // Impact: 5.8g peak at t0
    filter.pushAccel(t0, 5.8);

    // Car stops immediately after impact (< 5 km/h)
    filter.pushSpeed(t0 + 500, 2);
    filter.pushSpeed(t0 + 1000, 0);

    const result = filter.evaluate(t0 + 1000);
    expect(result.triggered).toBe(true);
    expect(result.peakG).toBe(5.8);
    expect(result.speedBeforeKmh).toBeGreaterThanOrEqual(25);
    expect(result.speedAfterKmh).toBeLessThan(5);
  });

  it("rejects a dropped phone (peak >= 4g, but stationary/walking speed < 25 km/h)", () => {
    const filter = createPhoneTriggerFilter();
    const t0 = 200000;

    // Person was stationary or walking at 3 km/h
    filter.pushSpeed(t0 - 6000, 3.2);
    filter.pushSpeed(t0 - 2000, 2.8);

    // Hard drop onto tile floor: 8.5g impact
    filter.pushAccel(t0, 8.5);

    // Stopped on floor (0 km/h)
    filter.pushSpeed(t0 + 500, 0);

    const result = filter.evaluate(t0 + 500);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("speed_before_too_low");
  });

  it("rejects a pothole or bump while driving (speed >= 25 km/h, but peak < 4g)", () => {
    const filter = createPhoneTriggerFilter();
    const t0 = 300000;

    // Driving at 70 km/h
    filter.pushSpeed(t0 - 4000, 70);
    filter.pushSpeed(t0 - 1000, 68);

    // Pothole shock: 2.3g (< 4g threshold)
    filter.pushAccel(t0, 2.3);

    // Continues driving at 65 km/h
    filter.pushSpeed(t0 + 500, 65);

    const result = filter.evaluate(t0 + 500);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("no_impact_detected");
  });

  it("rejects hard braking to a stop without high-g collision (speed >= 25 km/h to 0 km/h, but peak < 4g)", () => {
    const filter = createPhoneTriggerFilter();
    const t0 = 400000;

    // Driving at 80 km/h
    filter.pushSpeed(t0 - 5000, 80);

    // Hard emergency braking deceleration: max 1.2g
    filter.pushAccel(t0 - 2000, 1.2);
    filter.pushAccel(t0, 0.9);

    // Stopped safely
    filter.pushSpeed(t0 + 500, 0);

    const result = filter.evaluate(t0 + 500);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("no_impact_detected");
  });

  it("rejects an impact where vehicle does not stop (e.g. glancing hit or speed remains >= 5 km/h)", () => {
    const filter = createPhoneTriggerFilter();
    const t0 = 500000;

    // Driving at 90 km/h
    filter.pushSpeed(t0 - 3000, 90);

    // Heavy jar: 4.5g
    filter.pushAccel(t0, 4.5);

    // Keeps driving at 85 km/h
    filter.pushSpeed(t0 + 1000, 85);
    filter.pushSpeed(t0 + 2000, 80);

    const result = filter.evaluate(t0 + 2000);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("speed_after_too_high");
  });

  it("ignores high speeds older than the 10-second window", () => {
    const filter = createPhoneTriggerFilter();
    const t0 = 600000;

    // Drove fast 25 seconds ago, but stopped for the last 15 seconds
    filter.pushSpeed(t0 - 25000, 80);
    filter.pushSpeed(t0 - 15000, 0);
    filter.pushSpeed(t0 - 5000, 0);

    // Dropped phone while stopped
    filter.pushAccel(t0, 6.2);
    filter.pushSpeed(t0 + 500, 0);

    const result = filter.evaluate(t0 + 500);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("speed_before_too_low");
  });

  it("supports simulated crash trigger for demo", () => {
    const filter = createPhoneTriggerFilter();
    const simulated = filter.triggerSimulated(700000);
    expect(simulated.triggered).toBe(true);
    expect(simulated.simulated).toBe(true);
    expect(simulated.peakG).toBeGreaterThanOrEqual(THRESHOLDS.phoneTrigger.peakG);
  });
});
