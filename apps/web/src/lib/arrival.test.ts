import { describe, expect, it } from "vitest";

import { arrivalCountdown } from "./arrival";

const SENT = "2026-10-30T10:00:00Z";
const at = (time: string) => new Date(`2026-10-30T${time}Z`);

describe("arrivalCountdown (time left before the ambulance reaches the hospital)", () => {
  it("counts down from the minutes announced when the handover was sent", () => {
    expect(arrivalCountdown(SENT, 12, at("10:03:48"))).toEqual({ text: "08:12", late: false });
    expect(arrivalCountdown(SENT, 12, at("10:00:00"))).toEqual({ text: "12:00", late: false });
  });

  it("rounds up to the second still to go, never showing 00:00 before it is time", () => {
    expect(arrivalCountdown(SENT, 1, at("10:00:59.400"))).toEqual({ text: "00:01", late: false });
  });

  it("counts the minutes past the announced time once it has passed", () => {
    expect(arrivalCountdown(SENT, 12, at("10:12:00"))).toEqual({ text: "00:00", late: false });
    expect(arrivalCountdown(SENT, 12, at("10:13:05"))).toEqual({ text: "+01:05", late: true });
  });

  it("goes past the hour without wrapping", () => {
    expect(arrivalCountdown(SENT, 90, at("10:00:00"))).toEqual({ text: "90:00", late: false });
  });

  it("says nothing when no time was announced", () => {
    expect(arrivalCountdown(SENT, null, at("10:05:00"))).toBeNull();
  });
});
