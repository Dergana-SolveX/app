import { describe, expect, it } from "vitest";
import {
  createWitnessFlowState,
  flowReducer,
} from "./state";

describe("Witness 3-Tap Flow State Machine (Seam 2)", () => {
  it("initializes with step 1 (victims) and client idempotency key", () => {
    const state = createWitnessFlowState("test-key-1");
    expect(state.step).toBe(1);
    expect(state.idempotencyKey).toBe("test-key-1");
    expect(state.lang).toBe("fr");
    expect(state.victims).toBeNull();
    expect(state.conscious).toBeNull();
    expect(state.dangers).toEqual([]);
    expect(state.gpsStatus).toBe("searching");
    expect(state.gpsSecondsElapsed).toBe(0);
  });

  it("Tap 1: selecting victims sets count and auto-advances to step 2 (conscious)", () => {
    let state = createWitnessFlowState();
    state = flowReducer(state, { type: "SELECT_VICTIMS", count: 2 });
    expect(state.victims).toBe(2);
    expect(state.step).toBe(2);
  });

  it("Tap 2: selecting consciousness sets answer and auto-advances to step 3 (danger)", () => {
    let state = createWitnessFlowState();
    state = flowReducer(state, { type: "SELECT_VICTIMS", count: 1 });
    state = flowReducer(state, { type: "SELECT_CONSCIOUS", value: 0 }); // Inconscient
    expect(state.conscious).toBe(0);
    expect(state.step).toBe(3);
  });

  it("Tap 3: danger multi-selection supports fire, trapped, bleeding, and mutually exclusive 'none'", () => {
    let state = createWitnessFlowState();
    state = flowReducer(state, { type: "SELECT_VICTIMS", count: 1 });
    state = flowReducer(state, { type: "SELECT_CONSCIOUS", value: 1 });

    // Toggle fire and bleeding
    state = flowReducer(state, { type: "TOGGLE_DANGER", danger: "fire" });
    state = flowReducer(state, { type: "TOGGLE_DANGER", danger: "bleeding" });
    expect(state.dangers).toEqual(["fire", "bleeding"]);

    // Toggling 'none' clears other dangers
    state = flowReducer(state, { type: "TOGGLE_DANGER", danger: "none" });
    expect(state.dangers).toEqual(["none"]);

    // Toggling 'trapped' removes 'none'
    state = flowReducer(state, { type: "TOGGLE_DANGER", danger: "trapped" });
    expect(state.dangers).toEqual(["trapped"]);
  });

  it("GPS timer: triggers timeout after 20 seconds without fix", () => {
    let state = createWitnessFlowState();
    for (let i = 0; i < 19; i++) {
      state = flowReducer(state, { type: "TICK_GPS_TIMER" });
      expect(state.gpsStatus).toBe("searching");
    }
    // 20th tick
    state = flowReducer(state, { type: "TICK_GPS_TIMER" });
    expect(state.gpsStatus).toBe("timeout");
    expect(state.gpsSecondsElapsed).toBe(20);
  });

  it("GPS fix: acquiring coordinates updates gpsStatus to 'acquired'", () => {
    let state = createWitnessFlowState();
    state = flowReducer(state, {
      type: "GPS_ACQUIRED",
      coords: { lat: 36.725, lng: 3.183, accuracyM: 12 },
    });
    expect(state.gpsStatus).toBe("acquired");
    expect(state.coords).toEqual({ lat: 36.725, lng: 3.183, accuracyM: 12 });
  });

  it("transitions to location_prompt if GPS timed out and user reaches end without fix", () => {
    let state = createWitnessFlowState();
    state = flowReducer(state, { type: "SELECT_VICTIMS", count: 1 });
    state = flowReducer(state, { type: "SELECT_CONSCIOUS", value: 1 });
    state = flowReducer(state, { type: "TOGGLE_DANGER", danger: "none" });
    // GPS timed out
    state = flowReducer(state, { type: "GPS_FAILED", status: "timeout" });

    state = flowReducer(state, { type: "PROCEED_SUBMIT" });
    expect(state.step).toBe("location_prompt");
  });

  it("assembles complete tRPC submission payload when GPS fix is acquired", () => {
    let state = createWitnessFlowState("idempotent-abc-123");
    state = flowReducer(state, { type: "SELECT_VICTIMS", count: 3 });
    state = flowReducer(state, { type: "SELECT_CONSCIOUS", value: 2 });
    state = flowReducer(state, { type: "TOGGLE_DANGER", danger: "fire" });
    state = flowReducer(state, { type: "TOGGLE_DANGER", danger: "trapped" });
    state = flowReducer(state, {
      type: "GPS_ACQUIRED",
      coords: { lat: 36.7538, lng: 3.0588, accuracyM: 8 },
    });

    const payload = state.toSubmissionPayload();
    expect(payload).toEqual({
      idempotencyKey: "idempotent-abc-123",
      profileCode: null,
      victims: 3,
      conscious: 2,
      fire: true,
      trapped: true,
      bleeding: false,
      lat: 36.7538,
      lng: 3.0588,
      accuracyM: 8,
      commune: null,
      pkMarker: null,
    });
  });

  it("assembles complete tRPC submission payload when manual location is used", () => {
    let state = createWitnessFlowState("manual-loc-key");
    state = flowReducer(state, { type: "SELECT_VICTIMS", count: 1 });
    state = flowReducer(state, { type: "SELECT_CONSCIOUS", value: 1 });
    state = flowReducer(state, { type: "TOGGLE_DANGER", danger: "none" });
    state = flowReducer(state, { type: "GPS_FAILED", status: "timeout" });
    state = flowReducer(state, {
      type: "SET_MANUAL_LOCATION",
      commune: "Bab Ezzouar",
      pkMarker: "RN5 PK 14+200",
    });

    const payload = state.toSubmissionPayload();
    expect(payload).toEqual({
      idempotencyKey: "manual-loc-key",
      profileCode: null,
      victims: 1,
      conscious: 1,
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

  it("includes profileCode in submission payload when set in state (Issue 24 - Seam 3)", () => {
    let state = createWitnessFlowState("key-with-profile");
    state = flowReducer(state, { type: "SET_PROFILE_CODE", profileCode: "TESTCODE" });
    state = flowReducer(state, { type: "SELECT_VICTIMS", count: 1 });
    state = flowReducer(state, { type: "SELECT_CONSCIOUS", value: 1 });
    state = flowReducer(state, { type: "TOGGLE_DANGER", danger: "none" });

    const payload = state.toSubmissionPayload();
    expect(payload.profileCode).toBe("TESTCODE");
  });

  it("RESET preserves active profileCode so subsequent alerts remain linked", () => {
    let state = createWitnessFlowState("key-1", "SAVED001");
    state = flowReducer(state, { type: "RESET", idempotencyKey: "key-2" });
    expect(state.profileCode).toBe("SAVED001");
    expect(state.toSubmissionPayload().profileCode).toBe("SAVED001");
  });
});
