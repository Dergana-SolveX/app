import { describe, expect, it } from "vitest";

import {
  countdownReducer,
  createCrashCountdownState,
  type CrashCountdownAction,
} from "./countdown";

describe("Crash Countdown State Machine (FR-S4-01)", () => {
  it("starts in idle state with 15 seconds countdown configured", () => {
    const state = createCrashCountdownState();
    expect(state.status).toBe("idle");
    expect(state.secondsRemaining).toBe(15);
    expect(state.localLogs).toEqual([]);
  });

  it("transitions to countdown upon crash detection trigger", () => {
    const initial = createCrashCountdownState();
    const action: CrashCountdownAction = {
      type: "TRIGGER_CRASH",
      payload: {
        peakG: 5.4,
        speedBeforeKmh: 62,
        simulated: false,
        timestamp: 1000,
      },
    };

    const next = countdownReducer(initial, action);
    expect(next.status).toBe("countdown");
    expect(next.secondsRemaining).toBe(15);
    expect(next.peakG).toBe(5.4);
    expect(next.speedBeforeKmh).toBe(62);
    expect(next.simulated).toBe(false);
  });

  it("decrements secondsRemaining on TICK", () => {
    let state = createCrashCountdownState();
    state = countdownReducer(state, {
      type: "TRIGGER_CRASH",
      payload: { peakG: 4.5, speedBeforeKmh: 40, simulated: true, timestamp: 1000 },
    });

    state = countdownReducer(state, { type: "TICK" });
    expect(state.secondsRemaining).toBe(14);
    expect(state.status).toBe("countdown");

    for (let i = 0; i < 13; i++) {
      state = countdownReducer(state, { type: "TICK" });
    }
    expect(state.secondsRemaining).toBe(1);

    // Final tick to 0 transitions to expired / sending
    state = countdownReducer(state, { type: "TICK" });
    expect(state.secondsRemaining).toBe(0);
    expect(state.status).toBe("expired");
  });

  it("transitions to cancelled and creates local log when cancelled with 'JE VAIS BIEN'", () => {
    let state = createCrashCountdownState();
    state = countdownReducer(state, {
      type: "TRIGGER_CRASH",
      payload: { peakG: 6.0, speedBeforeKmh: 50, simulated: false, timestamp: 2000 },
    });

    // 5 seconds tick
    state = countdownReducer(state, { type: "TICK" });
    state = countdownReducer(state, { type: "TICK" });
    state = countdownReducer(state, { type: "TICK" });
    state = countdownReducer(state, { type: "TICK" });
    state = countdownReducer(state, { type: "TICK" });
    expect(state.secondsRemaining).toBe(10);

    // Victim taps "JE VAIS BIEN — ANNULER"
    state = countdownReducer(state, {
      type: "CANCEL",
      payload: { timestamp: 7000 },
    });

    expect(state.status).toBe("cancelled");
    expect(state.secondsRemaining).toBe(10);
    expect(state.localLogs.length).toBe(1);
    expect(state.localLogs[0]).toMatchObject({
      action: "cancelled",
      reason: "user_cancelled",
      peakG: 6.0,
      speedBeforeKmh: 50,
      timestamp: 7000,
    });
  });

  it("ignores TICK when already cancelled or idle", () => {
    let state = createCrashCountdownState();
    const tickResult = countdownReducer(state, { type: "TICK" });
    expect(tickResult.secondsRemaining).toBe(15);
    expect(tickResult.status).toBe("idle");
  });

  it("handles alert submission lifecycle (sending -> sent)", () => {
    let state = createCrashCountdownState();
    state = countdownReducer(state, {
      type: "TRIGGER_CRASH",
      payload: { peakG: 7.2, speedBeforeKmh: 75, simulated: false, timestamp: 1000 },
    });

    // Run countdown to expiration
    for (let i = 0; i < 15; i++) {
      state = countdownReducer(state, { type: "TICK" });
    }
    expect(state.status).toBe("expired");

    state = countdownReducer(state, { type: "SENDING_ALERT" });
    expect(state.status).toBe("sending");

    state = countdownReducer(state, {
      type: "ALERT_SENT",
      payload: {
        alertId: "alert-123",
        incidentId: "incident-456",
        timestamp: 16000,
      },
    });
    expect(state.status).toBe("sent");
    expect(state.submissionResult?.alertId).toBe("alert-123");
    expect(state.localLogs.length).toBe(1);
    expect(state.localLogs[0]?.action).toBe("sent");
  });

  it("allows reset back to idle", () => {
    let state = createCrashCountdownState();
    state = countdownReducer(state, {
      type: "TRIGGER_CRASH",
      payload: { peakG: 5.0, speedBeforeKmh: 50, simulated: true, timestamp: 1000 },
    });
    state = countdownReducer(state, { type: "CANCEL", payload: { timestamp: 2000 } });
    state = countdownReducer(state, { type: "RESET" });

    expect(state.status).toBe("idle");
    expect(state.secondsRemaining).toBe(15);
    // Preserves local logs across reset
    expect(state.localLogs.length).toBe(1);
  });
});
