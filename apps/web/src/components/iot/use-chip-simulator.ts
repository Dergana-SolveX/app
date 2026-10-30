import {
  createChip,
  createOrientationFilter,
  customTrace,
  generateTrace,
  TRACE_LABEL,
  type ChipRecord,
  type ChipState,
  type Packet,
  type SensorSample,
  type Trace,
  type TraceName,
} from "@solvex-dergana/shared";
import { useEffect, useRef, useState } from "react";

import { trpcClient } from "@/utils/trpc";

/** Where the simulated car is: a road in central Algiers. */
export const SCENE = { lat: 36.7538, lng: 3.0588 };

export type Scenario =
  | { kind: "trace"; name: TraceName; label: string; forceSms?: boolean }
  | { kind: "custom"; label: string; params: { peakG: number; durationMs: number; rollDeg: number; fire: boolean } };

export type Transmission = {
  id: number;
  attempt: number;
  channel: "http" | "sms";
  status: "pending" | "ok" | "failed";
  packet: Packet;
  incidentId: string | null;
  ack: string | null;
  /** The exact SVX message, when it went by SMS. */
  sms: string | null;
  error: string | null;
  sentAtMs?: number;
  ackedAtMs?: number | null;
};

export type Snapshot = {
  state: ChipState;
  /** Milliseconds left to cancel; 0 outside CONFIRM. */
  confirmRemainingMs: number;
  /** The last seconds of |a| in g, for the chart. `nowMs` is the right edge. */
  chart: { t: number; g: number }[];
  nowMs: number;
  playing: { label: string; seed: number; forceSms: boolean } | null;
  records: ChipRecord[];
  transmissions: Transmission[];
  /** Why the last pulse was filtered out (a pothole), until the next impact. */
  rejected: string | null;
  /** A scenario is running or the alert is still going out: the scenario buttons wait. */
  busy: boolean;
  forceSms: boolean;
  orientation: { rollDeg: number; pitchDeg: number };
  lastImpactMs: number | null;
  isImpacting: boolean;
};

const CHART_WINDOW_MS = 6000;
const TICK_MS = 20;
const EMIT_MS = 50;
const HEARTBEAT_MS = 15_000;
const LEAD_IN_MS = 300;

type Button = "arm" | "disarm" | "cancel" | "reset";

/** The chip, its clock and the network, outside React: React only reads snapshots of it. */
function createEngine() {
  const startedAt = performance.now();
  let forceSms = false;
  let chip = createChip({ forceSms });
  chip.reset(0);

  let orientationFilter = createOrientationFilter();
  let angles = { rollDeg: 0, pitchDeg: 0 };
  let lastSampleClock = -1;
  let lastImpactMs: number | null = null;

  let trace: Trace | null = null;
  let traceStartMs = 0;
  let index = 0;
  let playing: Snapshot["playing"] = null;
  let pending: Scenario | null = null;
  let seedCounter = 0;
  const buttons: Button[] = [];
  /** The network's answers; `attempt` says which send a failure is about. */
  const responses: { ok: boolean; attempt: number }[] = [];

  const records: ChipRecord[] = [];
  const transmissions: Transmission[] = [];
  let transmissionId = 0;
  let rejected: string | null = null;

  const chart: { t: number; g: number }[] = [];
  let bucket = -1;
  let bucketG = 0;
  let last: SensorSample | null = null;
  // The first heartbeat goes out at once, then one every 15 s.
  let lastHeartbeat = -HEARTBEAT_MS;

  const pushChart = (tMs: number, g: number) => {
    const slot = Math.floor(tMs / 10);
    if (slot !== bucket) {
      if (bucket >= 0) chart.push({ t: bucket * 10, g: bucketG });
      bucket = slot;
      bucketG = g;
    } else {
      bucketG = Math.max(bucketG, g);
    }
  };

  const traceFor = (scenario: Scenario, seed: number) =>
    scenario.kind === "trace" ? generateTrace(scenario.name, { seed }) : customTrace(scenario.params, { seed });

  function transmit(record: ChipRecord, clock: number) {
    const packet = record.data.packet as Packet;
    const attempt = record.data.attempt as number;
    const channel = record.type === "sms_sent" ? "sms" : "http";
    const tx: Transmission = {
      id: ++transmissionId,
      attempt,
      channel,
      status: "pending",
      packet,
      incidentId: null,
      ack: null,
      sms: null,
      error: null,
      sentAtMs: clock,
      ackedAtMs: null,
    };
    transmissions.push(tx);
    void trpcClient.chip.transmit
      .mutate({
        channel,
        packet,
        position: SCENE,
        // The crash time on the wall clock, kept through every retry.
        eventAt: Math.round(Date.now() - (clock - packet.eventMs)),
      })
      .then((answer) => {
        const ackClock = performance.now() - startedAt;
        Object.assign(tx, {
          status: "ok",
          incidentId: answer.incidentId,
          ack: answer.ack,
          sms: answer.sms,
          ackedAtMs: ackClock,
        });
        responses.push({ ok: true, attempt });
      })
      .catch((error: Error) => {
        // A server that cannot be reached says so plainly, instead of a raw network message.
        const unreachable = /fetch|network|load failed|ECONNREFUSED/i.test(error.message);
        Object.assign(tx, { status: "failed", error: unreachable ? "serveur injoignable" : error.message });
        responses.push({ ok: false, attempt });
      });
  }

  function absorb(batch: ChipRecord[], clock: number) {
    for (const record of batch) {
      records.push(record);
      if (record.type === "impact_rejected") rejected = String(record.data.reason);
      if (record.type === "impact_detected") {
        lastImpactMs = clock;
        if (!record.data.merged) rejected = null;
      }
      if (record.type === "state_change" && record.data.to === "BOOT") {
        transmissions.length = 0;
        rejected = null;
        lastImpactMs = null;
        orientationFilter = createOrientationFilter();
        angles = { rollDeg: 0, pitchDeg: 0 };
        lastSampleClock = -1;
      }
      if (record.type === "http_sent" || record.type === "sms_sent") transmit(record, clock);
    }
    if (records.length > 60) records.splice(0, records.length - 60);
  }

  /** Gets the chip armed, then starts the waiting scenario. */
  function tryStart(clock: number, out: ChipRecord[]) {
    if (!pending || trace) return;
    const wantSms = pending.kind === "trace" && Boolean(pending.forceSms);
    if (wantSms !== forceSms || chip.state === "DONE") {
      // A different channel setting, or a finished alert: power-cycle the chip (the channel is fixed at power-up).
      if (wantSms !== forceSms) {
        forceSms = wantSms;
        chip = createChip({ forceSms });
      }
      last = null;
      orientationFilter = createOrientationFilter();
      angles = { rollDeg: 0, pitchDeg: 0 };
      lastSampleClock = -1;
      lastImpactMs = null;
      out.push(...chip.reset(clock));
      return;
    }
    if (chip.state === "BOOT") return;
    if (chip.state === "IDLE") out.push(...chip.press("arm", clock));
    if (chip.state === "ARMED") {
      const seed = ++seedCounter;
      trace = traceFor(pending, seed);
      traceStartMs = clock + LEAD_IN_MS;
      index = 0;
      playing = { label: pending.label, seed, forceSms };
      pending = null;
    }
  }

  function tick(): void {
    const clock = performance.now() - startedAt;
    const out: ChipRecord[] = [];

    for (const button of buttons.splice(0)) {
      if (button === "reset") {
        last = null;
        trace = null;
        playing = null;
        pending = null;
        orientationFilter = createOrientationFilter();
        angles = { rollDeg: 0, pitchDeg: 0 };
        lastSampleClock = -1;
        lastImpactMs = null;
        out.push(...chip.reset(clock));
      } else {
        out.push(...chip.press(button, clock));
      }
    }
    while (responses.length) {
      const answer = responses.shift()!;
      out.push(...(answer.ok ? chip.ack(clock) : chip.sendFailed(clock, answer.attempt)));
    }
    tryStart(clock, out);

    if (trace) {
      while (index < trace.samples.length && traceStartMs + trace.samples[index]!.tMs <= clock) {
        const sample = { ...trace.samples[index]!, tMs: traceStartMs + trace.samples[index]!.tMs };
        out.push(...chip.sample(sample));
        pushChart(sample.tMs, Math.hypot(sample.ax, sample.ay, sample.az));

        const dtS = lastSampleClock >= 0 ? Math.max(0.001, (sample.tMs - lastSampleClock) / 1000) : 0.02;
        lastSampleClock = sample.tMs;
        angles = orientationFilter.update(sample, dtS);

        last = sample;
        index += 1;
      }
      if (index >= trace.samples.length) {
        trace = null;
        playing = null;
      }
    } else {
      // Between scenarios the car sits still, as it was left: gravity only.
      const rest: SensorSample = { tMs: clock, ax: 0, ay: last?.ay ?? 0, az: last?.az ?? 1, gx: 0, gy: 0, gz: 0, smoke: 0, flame: false };
      out.push(...chip.sample(rest));
      pushChart(clock, Math.hypot(rest.ax, rest.ay, rest.az));

      const dtS = lastSampleClock >= 0 ? Math.max(0.001, (clock - lastSampleClock) / 1000) : 0.02;
      lastSampleClock = clock;
      angles = orientationFilter.update(rest, dtS);
    }
    out.push(...chip.advance(clock));
    absorb(out, clock);

    while (chart.length > 0 && chart[0]!.t < clock - CHART_WINDOW_MS) chart.shift();

    if (clock - lastHeartbeat > HEARTBEAT_MS) {
      lastHeartbeat = clock;
      void trpcClient.chip.heartbeat.mutate({ state: chip.state, batteryPct: 87 }).catch(() => undefined);
    }
  }

  function snapshot(): Snapshot {
    const clock = performance.now() - startedAt;
    const state = chip.state;
    const isImpacting = state === "IMPACT" || (lastImpactMs !== null && clock - lastImpactMs < 800);
    return {
      state,
      confirmRemainingMs: chip.confirmRemainingMs(clock),
      chart: bucket >= 0 ? [...chart, { t: bucket * 10, g: bucketG }] : [...chart],
      nowMs: clock,
      playing,
      records: [...records],
      transmissions: transmissions.map((t) => ({ ...t })),
      rejected,
      busy: Boolean(trace) || state === "CONFIRM" || state === "SEND" || state === "AWAIT_ACK",
      forceSms,
      orientation: { ...angles },
      lastImpactMs,
      isImpacting,
    };
  }

  return {
    snapshot,
    actions: {
      start: (scenario: Scenario) => {
        pending = scenario;
      },
      press: (button: Button) => {
        buttons.push(button);
      },
    },
    /** Starts the clock; returns what stops it. */
    run(onSnapshot: (s: Snapshot) => void) {
      let lastEmit = 0;
      const id = setInterval(() => {
        tick();
        const now = performance.now();
        if (now - lastEmit >= EMIT_MS) {
          lastEmit = now;
          onSnapshot(snapshot());
        }
      }, TICK_MS);
      return () => clearInterval(id);
    },
  };
}

export { TRACE_LABEL };

/** The simulated chip, running in real time, wired to the real server. */
export function useChipSimulator() {
  const engine = useRef<ReturnType<typeof createEngine> | null>(null);
  engine.current ??= createEngine();
  const [snapshot, setSnapshot] = useState<Snapshot>(() => engine.current!.snapshot());
  useEffect(() => engine.current!.run(setSnapshot), []);
  return { snapshot, actions: engine.current.actions };
}
