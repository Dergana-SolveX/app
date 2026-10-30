import { describe, expect, it } from "vitest";

import {
  createWitnessFlowState,
  flowReducer,
  type WitnessFlowState,
} from "./state";

describe("Witness 3-Tap Flow State Machine (Seam 2)", () => {
  it("initializes with step 1 (victims) and client idempotency key", () => {
    const state = createWitnessFlowState("fixed-idempotency-key");
    expect(state.step).toBe(1);
    expect(state.idempotencyKey).toBe("fixed-idempotency-key");
    expect(state.victims).toBeNull();
    expect(state.conscious).toBeNull();
    expect(state.dangers).toEqual([]);
    expect(state.gpsStatus).toBe("searching");
    expect(state.gpsSecondsElapsed).toBe(0);
  });

  it("Tap 1: selecting victims sets count and auto-advances to step 2 (conscious)", () => {
    const initial = createWitnessFlowState();
    const next = flowReducer(initial, { type: "SELECT_VICTIMS", count: 2 });

    expect(next.victims).toBe(2);
    expect(next.step).toBe(2);
  });

  it("Tap 2: selecting consciousness sets answer and auto-advances to step 3 (danger)", () => {
    const initial: WitnessFlowState = {
      ...createWitnessFlowState(),
      step: 2,
      victims: 1,
    };
    // 0 = Non, 1 = Oui, 2 = Je ne sais pas
    const next = flowReducer(initial, { type: "SELECT_CONSCIOUS", value: 0 });

    expect(next.conscious).toBe(0);
    expect(next.step).toBe(3);
  });

  it("Tap 3: danger multi-selection supports fire, trapped, bleeding, and mutually exclusive 'none'", () => {
    let state: WitnessFlowState = {
      ...createWitnessFlowState(),
      step: 3,
      victims: 1,
      conscious: 1,
    };

    // Select "fire"
    state = flowReducer(state, { type: "TOGGLE_DANGER", danger: "fire" });
    expect(state.dangers).toContain("fire");
    expect(state.dangers).not.toContain("none");

    // Select "trapped"
    state = flowReducer(state, { type: "TOGGLE_DANGER", danger: "trapped" });
    expect(state.dangers).toEqual(expect.arrayContaining(["fire", "trapped"]));

    // Select "none" -> clears "fire" and "trapped"
    state = flowReducer(state, { type: "TOGGLE_DANGER", danger: "none" });
    expect(state.dangers).toEqual(["none"]);

    // Select "bleeding" while "none" is active -> unchecks "none", keeps "bleeding"
    state = flowReducer(state, { type: "TOGGLE_DANGER", danger: "bleeding" });
    expect(state.dangers).toEqual(["bleeding"]);
  });

  it("GPS timer: triggers timeout after 20 seconds without fix", () => {
    let state = createWitnessFlowState();
    expect(state.gpsStatus).toBe("searching");

    for (let i = 1; i < 20; i++) {
      state = flowReducer(state, { type: "TICK_GPS_TIMER" });
      expect(state.gpsSecondsElapsed).toBe(i);
      expect(state.gpsStatus).toBe("searching");
    }

    // 20th second marks timeout
    state = flowReducer(state, { type: "TICK_GPS_TIMER" });
    expect(state.gpsSecondsElapsed).toBe(20);
    expect(state.gpsStatus).toBe("timeout");
  });

  it("GPS fix: acquiring coordinates updates gpsStatus to 'acquired'", () => {
    const initial = createWitnessFlowState();
    const next = flowReducer(initial, {
      type: "GPS_ACQUIRED",
      coords: { lat: 36.7538, lng: 3.0588, accuracyM: 12 },
    });

    expect(next.gpsStatus).toBe("acquired");
    expect(next.coords).toEqual({ lat: 36.7538, lng: 3.0588, accuracyM: 12 });
  });

  it("transitions to location_prompt if GPS timed out and user reaches end without fix", () => {
    let state: WitnessFlowState = {
      ...createWitnessFlowState(),
      step: 3,
      victims: 1,
      conscious: 1,
      dangers: ["fire"],
      gpsStatus: "timeout",
    };

    state = flowReducer(state, { type: "PROCEED_SUBMIT" });
    expect(state.step).toBe("location_prompt");
  });

  it("assembles complete tRPC submission payload when GPS fix is acquired", () => {
    const state: WitnessFlowState = {
      ...createWitnessFlowState("key-1234"),
      step: 3,
      victims: 3,
      conscious: 1,
      dangers: ["fire", "trapped"],
      coords: { lat: 36.725, lng: 3.183, accuracyM: 8 },
      gpsStatus: "acquired",
    };

    const payload = state.toSubmissionPayload();
    expect(payload).toEqual({
      idempotencyKey: "key-1234",
      victims: 3,
      conscious: 1,
      fire: true,
      trapped: true,
      bleeding: false,
      lat: 36.725,
      lng: 3.183,
      accuracyM: 8,
      commune: null,
      pkMarker: null,
    });
  });

  it("assembles complete tRPC submission payload when manual location is used", () => {
    let state: WitnessFlowState = {
      ...createWitnessFlowState("key-5678"),
      step: "location_prompt",
      victims: 1,
      conscious: 0,
      dangers: ["none"],
      gpsStatus: "timeout",
    };

    state = flowReducer(state, {
      type: "SET_MANUAL_LOCATION",
      commune: "Bab Ezzouar",
      pkMarker: "RN5 PK 14+200",
    });

    const payload = state.toSubmissionPayload();
    expect(payload).toEqual({
      idempotencyKey: "key-5678",
      victims: 1,
      conscious: 0,
      fire: false,
      trapped: false,
      bleeding: false,
      lat: null,
      lng: null,
      accuracyM: null,
      commune: "Bab Ezzouar",
      pkMarker: "RN5 PK 14+200",
    });
  });
});
