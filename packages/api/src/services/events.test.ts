import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";

import { createEventBus } from "./events";

const created = { type: "incident.created", incident: {} } as never;

describe("createEventBus: a long-lived connection", () => {
  it("does not pile up abort listeners as events keep arriving", async () => {
    const bus = createEventBus();
    const controller = new AbortController();
    const stream = bus.stream(undefined, controller.signal);
    await stream.next(); // the ready marker

    for (let i = 0; i < 50; i++) {
      const next = stream.next();
      bus.publish(created);
      await next;
    }

    expect(getEventListeners(controller.signal, "abort").length).toBeLessThanOrEqual(1);
    controller.abort();
    await stream.return(undefined);
  });

  it("stops and releases its listener when the connection is aborted", async () => {
    const bus = createEventBus();
    const controller = new AbortController();
    const stream = bus.stream(undefined, controller.signal);
    await stream.next();

    const pending = stream.next();
    controller.abort();
    expect((await pending).done).toBe(true);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});
