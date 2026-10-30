import type { masterIncidents } from "@solvex-dergana/db/schema/index";
import { randomUUID } from "node:crypto";

type Incident = typeof masterIncidents.$inferSelect;

/** First item of every fresh connection: fetch the current state now, then apply later events. */
type Ready = { type: "ready" };
/** The server cannot replay what the client missed: fetch the current state again. */
type Resync = { type: "resync" };

/** Events sent to dispatchers. */
export type DispatcherEvent =
  | Ready
  | Resync
  | { type: "incident.created"; incident: Incident }
  /** An alert merged into an existing incident, or its automatic recommendation changed (count, confidence, position, triage). */
  | { type: "incident.updated"; incident: Incident }
  /** New data raises the severity of an incident already dispatched: a human decides what to do. */
  | {
      type: "incident.escalation_suggested";
      incidentId: string;
      from: Incident["recSeverity"];
      to: Incident["recSeverity"];
      reasons: { fr: string; ar: string }[];
    };

/** Events sent to one ambulance's tablet (`unit:{id}`). */
export type UnitEvent =
  | Ready
  | Resync
  /** A dispatcher assigned this ambulance to an incident. The tablet fetches the mission details. */
  | {
      type: "dispatch.assigned";
      dispatchId: string;
      incidentId: string;
      unitId: string;
      /** Every ambulance sent to the incident. */
      unitIds: string[];
      notes: string | null;
      at: string;
    };

type Published<E> = Exclude<E, Ready | Resync>;
type Stored<E> = { id: string; seq: number; event: Published<E> };

type Channel<E> = {
  publish(event: Published<E>): void;
  stream(lastEventId?: string, signal?: AbortSignal): AsyncGenerator<{ id: string; event: E }>;
};

export type EventBus = {
  publish(event: Published<DispatcherEvent>): void;
  /**
   * Events for one dispatcher subscriber. Without `lastEventId`: a `ready` marker, then live events.
   * With it: what the client missed (or `resync` if that is no longer possible), then live events.
   */
  stream(lastEventId?: string, signal?: AbortSignal): AsyncGenerator<{ id: string; event: DispatcherEvent }>;
  /** Tells one ambulance. Nobody else hears it. */
  publishToUnit(unitId: string, event: Published<UnitEvent>): void;
  /** The same replay rules as `stream`, for one ambulance. */
  streamUnit(
    unitId: string,
    lastEventId?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<{ id: string; event: UnitEvent }>;
};

/**
 * One in-process channel (one server instance). Event ids are `<bootId>:<counter>`: an id from
 * another run of the server, or one older than the last `bufferSize` events, forces a resync.
 */
function createChannel<E extends Ready | Resync | { type: string }>({
  bufferSize,
  bootId,
}: {
  bufferSize: number;
  bootId: string;
}): Channel<E> {
  let seq = 0;
  const buffer: Stored<E>[] = [];
  const listeners = new Set<(item: Stored<E>) => void>();
  const idOf = (n: number) => `${bootId}:${n}`;

  return {
    publish(event) {
      const item: Stored<E> = { id: idOf(++seq), seq, event };
      buffer.push(item);
      if (buffer.length > bufferSize) buffer.shift();
      for (const listener of listeners) listener(item);
    },

    async *stream(lastEventId, signal) {
      const queue: Stored<E>[] = [];
      let wake: (() => void) | null = null;
      const listener = (item: Stored<E>) => {
        queue.push(item);
        wake?.();
      };
      listeners.add(listener); // listening before replay, so nothing slips between the two

      try {
        let delivered = seq;
        if (lastEventId === undefined) {
          yield { id: idOf(seq), event: { type: "ready" } as E };
        } else {
          const [boot, n] = lastEventId.split(":");
          const last = Number(n);
          const oldestKept = buffer[0]?.seq ?? seq + 1;
          if (boot !== bootId || !Number.isInteger(last) || last > seq || last + 1 < oldestKept) {
            yield { id: idOf(seq), event: { type: "resync" } as E };
          } else {
            delivered = last;
            for (const item of buffer.filter((b) => b.seq > last && b.channel === channel)) {
              delivered = item.seq;
              yield { id: item.id, event: item.event as E };
            }
          }
        }

        while (!signal?.aborted) {
          const item = queue.shift();
          if (item) {
            if (item.seq > delivered) {
              delivered = item.seq;
              yield { id: item.id, event: item.event as E };
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
}

/** The dispatchers' channel plus one channel per ambulance. */
export function createEventBus({
  bufferSize = 500,
  bootId = randomUUID(),
}: { bufferSize?: number; bootId?: string } = {}): EventBus {
  const dispatchers = createChannel<DispatcherEvent>({ bufferSize, bootId });
  const units = new Map<string, Channel<UnitEvent>>();
  const unit = (unitId: string) => {
    let channel = units.get(unitId);
    if (!channel) {
      channel = createChannel<UnitEvent>({ bufferSize, bootId });
      units.set(unitId, channel);
    }
    return channel;
  };

  return {
    publish: (event) => dispatchers.publish(event),
    stream: (lastEventId, signal) => dispatchers.stream(lastEventId, signal),
    publishToUnit: (unitId, event) => unit(unitId).publish(event),
    streamUnit: (unitId, lastEventId, signal) => unit(unitId).stream(lastEventId, signal),
  };
}
