import type { MasterIncident } from "@solvex-dergana/db";
import { randomUUID } from "node:crypto";

type Incident = MasterIncident;

/** Events sent to dispatchers. */
export type DispatcherEvent =
  /** First item of every fresh connection: fetch the incident list now, then apply later events. */
  | { type: "ready" }
  /** The server cannot replay what the client missed: fetch the incident list again. */
  | { type: "resync" }
  | { type: "incident.created"; incident: Incident }
  /** An alert merged into an existing incident, or its automatic recommendation changed (count, confidence, position, triage). */
  | { type: "incident.updated"; incident: Incident }
  | {
      type: "incident.retriaged";
      incidentId: string;
      from: Incident["recSeverity"];
      to: Incident["recSeverity"];
      reasons: { fr: string; ar: string }[];
    }
  | {
      type: "incident.escalation_suggested";
      incidentId: string;
      from: Incident["recSeverity"];
      to: Incident["recSeverity"];
      reasons: { fr: string; ar: string }[];
    };

/** What a hospital board hears: a handover addressed to it (PRD FR-S7-01). */
export type HospitalEvent = { type: "handover.incoming"; handover: HandoverSummary };

/** What an ambulance tablet hears: assignments and the hospital's answer to its handover. */
export type UnitEvent =
  | {
      type: "dispatch.assigned";
      dispatchId: string;
      incidentId: string;
      unitId: string;
      /** Every ambulance sent to the incident. */
      unitIds: string[];
      notes: string | null;
      at: string;
    }
  | {
      type: "handover.updated";
      handoverId: string;
      hospitalId: string;
      status: "pending" | "accepted" | "diverted";
      divertSpecialty: string | null;
      respondedAt: string | null;
    };

/** A handover as the hospital board shows it. */
export type HandoverSummary = {
  id: string;
  hospitalId: string;
  incidentId: string;
  assessmentId: string;
  status: "pending" | "accepted" | "diverted";
  /** The frozen AT-MIST snapshot. */
  atmist: Record<string, unknown>;
  /** The ambulance's estimated minutes to the hospital when it was sent. */
  etaMin: number | null;
  createdAt: string;
};

/** Who is listening: the dispatchers, one ambulance, or one hospital. */
export type Channel = "dispatcher" | `unit:${string}` | `hospital:${string}`;

type Marker = { type: "ready" } | { type: "resync" };
type EventOf<C extends Channel> = C extends "dispatcher"
  ? DispatcherEvent
  : C extends `hospital:${string}`
    ? HospitalEvent | Marker
    : UnitEvent | Marker;
type Published<C extends Channel> = Exclude<EventOf<C>, Marker>;
type Stored = { id: string; seq: number; channel: Channel; event: unknown };

export type EventBus = {
  /** `channel` defaults to the dispatchers. */
  publish<C extends Channel = "dispatcher">(event: Published<C>, channel?: C): void;
  /**
   * Events for one subscriber of a channel (the dispatchers by default). Without `lastEventId`: a `ready` marker,
   * then live events. With it: what the client missed on this channel (or `resync` if that is no longer
   * possible), then live events. Ids are shared by all channels, so an id means the same moment everywhere.
   */
  stream<C extends Channel = "dispatcher">(
    lastEventId?: string,
    signal?: AbortSignal,
    channel?: C,
  ): AsyncGenerator<{ id: string; event: EventOf<C> }>;
  /** Tells one ambulance. Nobody else hears it. */
  publishToUnit(unitId: string, event: Published<`unit:${string}`>): void;
  /** The same replay rules as `stream`, for one ambulance. */
  streamUnit(
    unitId: string,
    lastEventId?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<{ id: string; event: UnitEvent | Marker }>;
};

/**
 * In-process event bus (one server instance). Event ids are `<bootId>:<counter>`: an id from
 * another run of the server, or one older than the last `bufferSize` events, forces a resync.
 */
export function createEventBus({
  bufferSize = 500,
  bootId = randomUUID(),
}: { bufferSize?: number; bootId?: string } = {}): EventBus {
  let seq = 0;
  const buffer: Stored[] = [];
  const listeners = new Set<(item: Stored) => void>();
  const idOf = (n: number) => `${bootId}:${n}`;

  const bus: EventBus = {
    publish(event, channel = "dispatcher" as never) {
      const item: Stored = { id: idOf(++seq), seq, channel, event };
      buffer.push(item);
      if (buffer.length > bufferSize) buffer.shift();
      for (const listener of listeners) listener(item);
    },

    publishToUnit(unitId, event) {
      bus.publish(event, `unit:${unitId}`);
    },

    streamUnit(unitId, lastEventId, signal) {
      return bus.stream(lastEventId, signal, `unit:${unitId}`);
    },

    async *stream(lastEventId, signal, channel = "dispatcher" as never) {
      const queue: Stored[] = [];
      let wake: (() => void) | null = null;
      const listener = (item: Stored) => {
        if (item.channel !== channel) return;
        queue.push(item);
        wake?.();
      };
      listeners.add(listener); // listening before replay, so nothing slips between the two

      try {
        let delivered = seq;
        if (lastEventId === undefined) {
          yield { id: idOf(seq), event: { type: "ready" } } as never;
        } else {
          const [boot, n] = lastEventId.split(":");
          const last = Number(n);
          const oldestKept = buffer[0]?.seq ?? seq + 1;
          if (boot !== bootId || !Number.isInteger(last) || last > seq || last + 1 < oldestKept) {
            yield { id: idOf(seq), event: { type: "resync" } } as never;
          } else {
            delivered = last;
            for (const item of buffer.filter((b) => b.seq > last && b.channel === channel)) {
              delivered = item.seq;
              yield { id: item.id, event: item.event } as never;
            }
          }
        }

        while (!signal?.aborted) {
          const item = queue.shift();
          if (item) {
            if (item.seq > delivered) {
              delivered = item.seq;
              yield { id: item.id, event: item.event } as never;
            }
            continue;
          }
          await new Promise<void>((resolve) => {
            // Whichever comes first (an event or an abort), stop listening for the other.
            const done = () => {
              signal?.removeEventListener("abort", done);
              wake = null;
              resolve();
            };
            wake = done;
            signal?.addEventListener("abort", done, { once: true });
          });
        }
      } finally {
        listeners.delete(listener);
      }
    },
  };

  return bus;
}
