import type { ChipState } from "../schemas/chip";
import { THRESHOLDS } from "../thresholds";
import { createPulseTracker, summarizeImpacts, type Pulse, type SensorSample } from "./detect";
import { createFireDebouncer } from "./fire";
import { createOrientationFilter, createRolloverDetector } from "./orientation";

export type ChipChannel = "http" | "sms";

/** What the chip tells the server about the crash, whichever channel carries it. */
export type Packet = {
  /** What started it. A rollover or a fire can start it with no g-spike at all. */
  cause: "impact" | "rollover" | "fire";
  /** Separate pulses folded into this event; 0 for a rollover or a fire alone. */
  impacts: number;
  peakG: number;
  deltaVKmh: number;
  saturated: boolean;
  rollover: boolean;
  rolloverDeg: number | null;
  fire: boolean;
  /** When it happened on the chip's own clock, kept through every retry. */
  eventMs: number;
};

export type ChipRecordType =
  | "state_change"
  | "selftest"
  | "impact_detected"
  | "impact_rejected"
  | "cancel_pressed"
  | "http_sent"
  | "sms_sent"
  | "ack_received";

/** One thing the chip did or noticed, in the order it happened. The same shape feeds the screens and the server. */
export type ChipRecord = { tMs: number; type: ChipRecordType; data: Record<string, unknown> };

type Pending = {
  cause: Packet["cause"];
  pulses: Pulse[];
  rollover: boolean;
  rolloverDeg: number;
  fire: boolean;
  eventMs: number;
};

/**
 * The crash chip as a state machine on a virtual clock (PRD FR-S8-02):
 * BOOT -> IDLE <-> ARMED -> IMPACT -> CONFIRM (10 s to cancel) -> SEND -> AWAIT_ACK (backoff, then SMS) -> DONE.
 * Nothing here reads the real time, so the same inputs always give the same records.
 * `forceSms` is the "zone blanche": no web coverage, so every attempt goes by SMS.
 */
export function createChip({ forceSms = false, sampleRateHz = 1000 }: { forceSms?: boolean; sampleRateHz?: number } = {}) {
  const config = THRESHOLDS.chipSim;
  let state: ChipState = "BOOT";
  let out: ChipRecord[] = [];
  let clock = 0;

  const timers: { boot: number | null; confirm: number | null; retry: number | null; ackTimeout: number | null } = {
    boot: config.bootMs,
    confirm: null,
    retry: null,
    ackTimeout: null,
  };

  let pending: Pending | null = null;
  let packet: Packet | null = null;
  let attempt = 0;
  let httpFailures = 0;
  let lastChannel: ChipChannel = "http";
  /** True from the moment an attempt goes out until it is answered or counted as failed. */
  let inFlight = false;
  let lastSampleMs: number | null = null;

  // Detectors are fresh each time the chip is armed or a false alarm is cancelled.
  let tracker = createPulseTracker({ sampleRateHz });
  let orientation = createOrientationFilter();
  let rolloverDetector = createRolloverDetector();
  let fireDebouncer = createFireDebouncer();
  const freshDetectors = () => {
    tracker = createPulseTracker({ sampleRateHz });
    orientation = createOrientationFilter();
    rolloverDetector = createRolloverDetector();
    fireDebouncer = createFireDebouncer();
    lastSampleMs = null;
  };

  const emit = (tMs: number, type: ChipRecordType, data: Record<string, unknown> = {}) => out.push({ tMs, type, data });
  const moveTo = (to: ChipState, tMs: number, data: Record<string, unknown> = {}) => {
    emit(tMs, "state_change", { from: state, to, ...data });
    state = to;
  };

  function startAttempt(tMs: number) {
    attempt += 1;
    lastChannel = forceSms || httpFailures >= config.smsAfterFailures ? "sms" : "http";
    emit(tMs, `${lastChannel}_sent`, { attempt, channel: lastChannel, packet });
    timers.retry = null;
    timers.ackTimeout = tMs + config.ackTimeoutS * 1000;
    inFlight = true;
  }

  /** An attempt that got no answer: wait, then try again (and by SMS once the web has failed twice). */
  function attemptFailed(tMs: number) {
    if (state !== "AWAIT_ACK" || !inFlight) return;
    inFlight = false;
    if (lastChannel === "http") httpFailures += 1;
    timers.ackTimeout = null;
    timers.retry = tMs + (config.backoffS[attempt - 1] ?? config.maxBackoffS) * 1000;
  }

  function summaryData(p: Pending) {
    const summary = summarizeImpacts(p.pulses);
    return {
      cause: p.cause,
      impacts: summary?.impacts ?? 0,
      peakG: summary?.peakG ?? 0,
      deltaVKmh: summary?.deltaVKmh ?? 0,
      saturated: summary?.saturated ?? false,
      rollover: p.rollover,
      fire: p.fire,
    };
  }

  function trigger(cause: Packet["cause"], tMs: number, found: { pulse?: Pulse; eventMs?: number }) {
    if (state === "ARMED") {
      pending = {
        cause,
        pulses: found.pulse ? [found.pulse] : [],
        rollover: cause === "rollover",
        rolloverDeg: 0,
        fire: cause === "fire",
        eventMs: found.pulse?.startMs ?? found.eventMs ?? tMs,
      };
      emit(tMs, "impact_detected", summaryData(pending));
      moveTo("IMPACT", tMs);
      moveTo("CONFIRM", tMs);
      timers.confirm = tMs + config.confirmS * 1000;
      return;
    }
    if (state === "CONFIRM" && pending) {
      // Something else in the same crash (a second impact, the car turning over, a fire): one event, more detail.
      if (found.pulse) pending.pulses.push(found.pulse);
      if (cause === "rollover") pending.rollover = true;
      if (cause === "fire") pending.fire = true;
      pending.eventMs = Math.min(pending.eventMs, found.pulse?.startMs ?? found.eventMs ?? tMs);
      emit(tMs, "impact_detected", { ...summaryData(pending), merged: true });
    }
  }

  function runTimers(to: number) {
    for (;;) {
      const due = (Object.entries(timers) as [keyof typeof timers, number | null][])
        .filter((entry): entry is [keyof typeof timers, number] => entry[1] !== null && entry[1] <= to)
        .sort((a, b) => a[1] - b[1])[0];
      if (!due) break;
      const [name, at] = due;
      clock = Math.max(clock, at);
      timers[name] = null;
      if (name === "boot") {
        emit(at, "selftest", { ok: true });
        moveTo("IDLE", at);
      } else if (name === "confirm" && pending) {
        packet = {
          cause: pending.cause,
          ...(({ impacts, peakG, deltaVKmh, saturated }) => ({ impacts, peakG, deltaVKmh, saturated }))(summaryData(pending)),
          rollover: pending.rollover,
          rolloverDeg: pending.rollover ? Math.round(pending.rolloverDeg) : null,
          fire: pending.fire,
          eventMs: pending.eventMs,
        };
        pending = null;
        moveTo("SEND", at);
        moveTo("AWAIT_ACK", at);
        startAttempt(at);
      } else if (name === "retry") {
        startAttempt(at);
      } else if (name === "ackTimeout") {
        attemptFailed(at);
      }
    }
    clock = Math.max(clock, to);
  }

  /** Runs `work` and returns everything the chip recorded, timers included. */
  const record = (work: () => void) => {
    out = [];
    work();
    return out;
  };

  return {
    get state() {
      return state;
    },

    /** Moves the clock on, letting the boot, the countdown, the retries and the timeouts happen. */
    advance: (tMs: number) => record(() => runTimers(tMs)),

    /** One reading of the sensors. Only an armed chip reacts to a crash, a rollover or a fire. */
    sample: (s: SensorSample) =>
      record(() => {
        runTimers(s.tMs);
        if (state !== "ARMED" && state !== "CONFIRM") return;
        const dtS = lastSampleMs === null ? 1 / sampleRateHz : (s.tMs - lastSampleMs) / 1000;
        lastSampleMs = s.tMs;
        const angles = orientation.update(s, dtS);
        const { pulse, rejected } = tracker.push(s);
        if (rejected) emit(s.tMs, "impact_rejected", { ...rejected });
        if (pulse) trigger("impact", s.tMs, { pulse });

        const turned = rolloverDetector.update(angles, s.tMs);
        if (turned.rollover && !(pending?.rollover && state === "CONFIRM")) {
          trigger("rollover", s.tMs, { eventMs: turned.sinceMs ?? s.tMs });
        }
        if (pending?.rollover) pending.rolloverDeg = Math.max(pending.rolloverDeg, Math.abs(angles.rollDeg), Math.abs(angles.pitchDeg));

        if (fireDebouncer.update(s) && !(pending?.fire && state === "CONFIRM")) {
          trigger("fire", s.tMs, { eventMs: s.tMs - config.fireDebounceS * 1000 });
        }
      }),

    press: (button: "arm" | "disarm" | "cancel", tMs: number) =>
      record(() => {
        runTimers(tMs);
        if (button === "arm" && state === "IDLE") {
          freshDetectors();
          moveTo("ARMED", tMs);
        } else if (button === "disarm" && state === "ARMED") {
          moveTo("IDLE", tMs);
        } else if (button === "cancel" && state === "CONFIRM") {
          emit(tMs, "cancel_pressed");
          pending = null;
          timers.confirm = null;
          freshDetectors();
          moveTo("ARMED", tMs);
        }
      }),

    /** The server answered the last attempt. */
    ack: (tMs: number) =>
      record(() => {
        runTimers(tMs);
        if (state !== "AWAIT_ACK") return;
        emit(tMs, "ack_received", { attempt, channel: lastChannel });
        inFlight = false;
        timers.ackTimeout = null;
        timers.retry = null;
        moveTo("DONE", tMs);
      }),

    /** The last attempt could not be delivered (no coverage, an error): back off, then try again. */
    sendFailed: (tMs: number) => record(() => (runTimers(tMs), attemptFailed(tMs))),

    /** Power-cycles the chip: back to BOOT, everything forgotten. */
    reset: (tMs: number) =>
      record(() => {
        runTimers(tMs);
        if (state !== "BOOT") moveTo("BOOT", tMs);
        pending = null;
        packet = null;
        attempt = 0;
        httpFailures = 0;
        inFlight = false;
        timers.confirm = timers.retry = timers.ackTimeout = null;
        timers.boot = tMs + config.bootMs;
        freshDetectors();
      }),

    /** Milliseconds left to cancel, for the countdown ring. */
    confirmRemainingMs: (tMs: number) => (state === "CONFIRM" && timers.confirm !== null ? Math.max(0, timers.confirm - tMs) : 0),

    /** The packet being sent (or last sent). */
    get packet() {
      return packet;
    },
  };
}
