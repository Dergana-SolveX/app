import type { masterIncidents } from "@solvex-dergana/db/schema/index";
import { randomUUID } from "node:crypto";

type Incident = typeof masterIncidents.$inferSelect;

/** Events sent to dispatchers. */
export type DispatcherEvent =
  /** First item of every fresh connection: fetch the incident list now, then apply later events. */
  | { type: "ready" }
  /** The server cannot replay what the client missed: fetch the incident list again. */
  | { type: "resync" }
  | { type: "incident.created"; incident: Incident }
  /** An alert merged into an existing incident (count, confidence or position changed). */
  | { type: "incident.updated"; incident: Incident };

type Published = Exclude<DispatcherEvent, { type: "ready" | "resync" }>;
type Stored = { id: string; seq: number; event: Published };

export type EventBus = {
  publish(event: Published): void;
  /**
   * Events for one subscriber. Without `lastEventId`: a `ready` marker, then live events.
   * With it: what the client missed (or `resync` if that is no longer possible), then live events.
   */
  stream(
    lastEventId?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<{ id: string; event: DispatcherEvent }>;
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

  return {
    publish(event) {
      const item: Stored = { id: idOf(++seq), seq, event };
      buffer.push(item);
      if (buffer.length > bufferSize) buffer.shift();
      for (const listener of listeners) listener(item);
    },

    async *stream(lastEventId, signal) {
      const queue: Stored[] = [];
      let wake: (() => void) | null = null;
      const listener = (item: Stored) => {
        queue.push(item);
        wake?.();
      };
      listeners.add(listener); // listening before replay, so nothing slips between the two

      try {
        let delivered = seq;
        if (lastEventId === undefined) {
          yield { id: idOf(seq), event: { type: "ready" } };
        } else {
          const [boot, n] = lastEventId.split(":");
          const last = Number(n);
          const oldestKept = buffer[0]?.seq ?? seq + 1;
          if (boot !== bootId || !Number.isInteger(last) || last > seq || last + 1 < oldestKept) {
            yield { id: idOf(seq), event: { type: "resync" } };
          } else {
            delivered = last;
            for (const item of buffer.filter((b) => b.seq > last)) {
              delivered = item.seq;
              yield { id: item.id, event: item.event };
            }
          }
        }

        while (!signal?.aborted) {
          const item = queue.shift();
          if (item) {
            if (item.seq > delivered) {
              delivered = item.seq;
              yield { id: item.id, event: item.event };
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
