import { describe, expect, it } from "vitest";

import { pickNearest, shouldMerge, trustedEventTime } from "./merge";

const at = (hhmmss: string) => new Date(`2026-10-30T${hhmmss}Z`);

// An incident at (36.75, 3.06), last alert at 09:00:00. Offsets of 0.001 degrees of latitude are
// 111.2 m (distances checked independently in Python).
const incident = { lat: 36.75, lng: 3.06, uncertaintyM: 19, lastAlertAt: at("09:00:00") };
const alertAt = (latOffset: number, time: string, accuracyM: number | null = 19) => ({
  lat: 36.75 + latOffset,
  lng: 3.06,
  accuracyM,
  eventAt: at(time),
});

describe("shouldMerge: distance (200 m plus the location uncertainty, capped at 3000 m)", () => {
  it("merges an alert at the same spot", () => {
    expect(shouldMerge(alertAt(0, "09:05:00"), incident)).toEqual({
      merge: true,
      distanceM: 0,
      tentative: false,
    });
  });

  it("merges within 200 m with no tentative flag (189 m)", () => {
    const d = shouldMerge(alertAt(0.0017, "09:05:00"), incident);
    expect(d).toMatchObject({ merge: true, tentative: false });
    expect(d.merge && d.distanceM).toBeCloseTo(189.03, 1);
  });

  it("merges between 200 m and the allowance, but marks it tentative (211 m, allowance 19 m)", () => {
    expect(shouldMerge(alertAt(0.0019, "09:05:00"), incident)).toMatchObject({ merge: true, tentative: true });
  });

  it("does not merge beyond the allowance (234 m, allowance 19 m)", () => {
    expect(shouldMerge(alertAt(0.0021, "09:05:00"), incident)).toEqual({ merge: false });
  });

  it("uses the smaller of the two accuracies: a coarse alert on a coarse incident can reach further", () => {
    const coarse = { ...incident, uncertaintyM: 400 };
    // 234 m away, alert accuracy 300 m, incident 400 m: allowance 300 m, limit 500 m.
    expect(shouldMerge(alertAt(0.0021, "09:05:00", 300), coarse)).toMatchObject({ merge: true, tentative: true });
    // Same distance, but one side is precise (19 m): the smaller accuracy wins, so no match.
    expect(shouldMerge(alertAt(0.0021, "09:05:00", 300), incident)).toEqual({ merge: false });
  });

  it("caps the allowance at 3000 m", () => {
    const vague = { ...incident, uncertaintyM: 5000 };
    expect(shouldMerge(alertAt(0.026, "09:05:00", 5000), vague)).toMatchObject({ merge: true, tentative: true }); // 2891 m
    expect(shouldMerge(alertAt(0.03, "09:05:00", 5000), vague)).toEqual({ merge: false }); // 3336 m > 3200 m
  });

  it("falls back to the plain 200 m when no accuracy is known", () => {
    const unknown = { ...incident, uncertaintyM: null };
    expect(shouldMerge(alertAt(0.0017, "09:05:00", null), unknown)).toMatchObject({ merge: true });
    expect(shouldMerge(alertAt(0.0019, "09:05:00", null), unknown)).toEqual({ merge: false });
  });
});

describe("shouldMerge: time (10 minute sliding window around the incident's last alert)", () => {
  it("includes exactly 10 minutes and excludes 10 minutes 1 second", () => {
    expect(shouldMerge(alertAt(0, "09:10:00"), incident)).toMatchObject({ merge: true });
    expect(shouldMerge(alertAt(0, "09:10:01"), incident)).toEqual({ merge: false });
  });

  it("works both ways, so a late SMS about an earlier moment still matches", () => {
    expect(shouldMerge(alertAt(0, "08:55:00"), incident)).toMatchObject({ merge: true });
    expect(shouldMerge(alertAt(0, "08:49:59"), incident)).toEqual({ merge: false });
  });
});

describe("shouldMerge: unknown positions", () => {
  it("never merges an alert without a position, or into an incident without one", () => {
    expect(shouldMerge({ lat: null, lng: null, accuracyM: null, eventAt: at("09:01:00") }, incident)).toEqual({
      merge: false,
    });
    expect(
      shouldMerge(alertAt(0, "09:01:00"), { lat: null, lng: null, uncertaintyM: null, lastAlertAt: at("09:00:00") }),
    ).toEqual({ merge: false });
  });
});

describe("pickNearest", () => {
  it("picks the closest candidate, and nothing from an empty list", () => {
    const candidates = [
      { id: "far", distanceM: 150 },
      { id: "near", distanceM: 40 },
      { id: "mid", distanceM: 90 },
    ];
    expect(pickNearest(candidates)?.id).toBe("near");
    expect(pickNearest([])).toBeNull();
  });
});

describe("trustedEventTime (±24 h skew check)", () => {
  const received = at("09:00:00");

  it("uses the device's event time when it is close to the time of receipt", () => {
    expect(trustedEventTime(at("08:30:00"), received)).toEqual(at("08:30:00"));
  });

  it("falls back to the received time when the event time is more than 24 h away, or missing or invalid", () => {
    expect(trustedEventTime(new Date("2026-10-28T09:00:00Z"), received)).toEqual(received); // 2 days old
    expect(trustedEventTime(new Date("2026-10-31T09:00:01Z"), received)).toEqual(received); // 24 h + 1 s ahead
    expect(trustedEventTime(null, received)).toEqual(received);
    expect(trustedEventTime(new Date("nonsense"), received)).toEqual(received);
  });

  it("accepts exactly 24 h", () => {
    expect(trustedEventTime(new Date("2026-10-29T09:00:00Z"), received)).toEqual(new Date("2026-10-29T09:00:00Z"));
  });
});
