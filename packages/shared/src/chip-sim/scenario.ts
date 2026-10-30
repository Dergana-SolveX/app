import { createChip, type ChipRecord, type Packet } from "./machine";
import { createRng } from "./rng";
import type { Trace } from "./traces";

export type ScenarioResult = {
  records: ChipRecord[];
  state: ReturnType<typeof createChip>["state"];
  /** The packet that was sent, or null when the chip never decided to send one (a pothole). */
  packet: Packet | null;
};

/** The chip boots at 0, is armed at 1200 ms, and the trace starts at 2000 ms. */
const ARM_AT_MS = 1200;
const TRACE_STARTS_MS = 2000;
/** Stops a scenario that never gets an answer. */
const GIVE_UP_MS = 10 * 60_000;
const STEP_MS = 100;

/**
 * Plays a synthetic trace through the chip, with a pretend network that answers after a delay drawn from `seed`
 * (PRD FR-S2-30: deterministic with a seed). `httpFailures` is how many web attempts fail before one gets through;
 * `forceSms` is the zone blanche. Used by the tests and for previews: the page plays the same chip in real time.
 */
export function runScenario(
  trace: Trace,
  { seed, forceSms = false, httpFailures = 0 }: { seed: number; forceSms?: boolean; httpFailures?: number },
): ScenarioResult {
  const rng = createRng(seed);
  const chip = createChip({ forceSms, sampleRateHz: trace.sampleRateHz });
  const records: ChipRecord[] = [];
  const responses: { atMs: number; ok: boolean }[] = [];
  let webAttempts = 0;

  /** Keeps what the chip recorded and schedules the network's answer to every send. */
  const take = (batch: ChipRecord[]) => {
    for (const record of batch) {
      records.push(record);
      if (record.type !== "http_sent" && record.type !== "sms_sent") continue;
      if (record.type === "http_sent") {
        webAttempts += 1;
        const fails = webAttempts <= httpFailures;
        responses.push({ atMs: record.tMs + (fails ? rng.between(500, 1500) : rng.between(300, 900)), ok: !fails });
      } else {
        responses.push({ atMs: record.tMs + rng.between(2000, 6000), ok: true });
      }
    }
  };

  /** Lets the network answer everything due by `tMs`, in order. */
  const deliver = (tMs: number) => {
    for (;;) {
      responses.sort((a, b) => a.atMs - b.atMs);
      const next = responses[0];
      if (!next || next.atMs > tMs) return;
      responses.shift();
      take(next.ok ? chip.ack(next.atMs) : chip.sendFailed(next.atMs));
    }
  };

  take(chip.press("arm", ARM_AT_MS));
  for (const sample of trace.samples) {
    const tMs = TRACE_STARTS_MS + sample.tMs;
    deliver(tMs);
    take(chip.sample({ ...sample, tMs }));
  }

  let t = TRACE_STARTS_MS + (trace.samples.at(-1)?.tMs ?? 0);
  while (t < GIVE_UP_MS && (chip.state === "CONFIRM" || chip.state === "AWAIT_ACK")) {
    t += STEP_MS;
    take(chip.advance(t));
    deliver(t);
  }
  return { records, state: chip.state, packet: chip.packet };
}
