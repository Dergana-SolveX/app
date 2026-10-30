import { describe, expect, it } from "vitest";

import { createEventBus, type EventBus } from "./events";

const incident = { type: "incident.created", incident: {} } as never;
const handover = (id: string) => ({ type: "handover.incoming", handover: { id } }) as never;
const updated = (id: string) => ({ type: "handover.updated", handoverId: id, status: "accepted" }) as never;

/** Up to `count` items from a stream, or fewer if nothing more arrives within a moment. */
async function take(stream: AsyncGenerator<{ id: string; event: { type: string } }>, count: number) {
  const items: { id: string; event: { type: string } }[] = [];
  while (items.length < count) {
    const next = await Promise.race([stream.next(), new Promise<"quiet">((r) => setTimeout(() => r("quiet"), 60))]);
    if (next === "quiet" || next.done) break;
    items.push(next.value);
  }
  return items;
}

const open = (bus: EventBus, channel?: Parameters<EventBus["stream"]>[2], lastEventId?: string) => {
  const controller = new AbortController();
  return { stream: bus.stream(lastEventId, controller.signal, channel), stop: () => controller.abort() };
};

describe("event bus channels (PRD FR-S3-21): dispatcher, unit:{id}, hospital:{id}", () => {
  it("delivers an event only to the channel it was published on", async () => {
    const bus = createEventBus();
    const a = open(bus, "hospital:A");
    const b = open(bus, "hospital:B");
    const dispatcher = open(bus);
    for (const s of [a, b, dispatcher]) await take(s.stream, 1); // the ready markers

    bus.publish(handover("h1"), "hospital:A");

    expect((await take(a.stream, 1)).map((i) => i.event.type)).toEqual(["handover.incoming"]);
    expect(await take(b.stream, 1)).toEqual([]);
    expect(await take(dispatcher.stream, 1)).toEqual([]);
    [a, b, dispatcher].forEach((s) => s.stop());
  });

  it("keeps publishing to the dispatchers by default, exactly as before", async () => {
    const bus = createEventBus();
    const dispatcher = open(bus);
    const hospital = open(bus, "hospital:A");
    await take(dispatcher.stream, 1);
    await take(hospital.stream, 1);

    bus.publish(incident);

    expect((await take(dispatcher.stream, 1)).map((i) => i.event.type)).toEqual(["incident.created"]);
    expect(await take(hospital.stream, 1)).toEqual([]);
    dispatcher.stop();
    hospital.stop();
  });

  it("separates the ambulances: unit:1 does not hear unit:2", async () => {
    const bus = createEventBus();
    const one = open(bus, "unit:1");
    const two = open(bus, "unit:2");
    await take(one.stream, 1);
    await take(two.stream, 1);

    bus.publish(updated("h1"), "unit:1");

    expect((await take(one.stream, 1)).map((i) => i.event.type)).toEqual(["handover.updated"]);
    expect(await take(two.stream, 1)).toEqual([]);
    one.stop();
    two.stop();
  });

  it("on reconnect, replays only what that channel missed, in order", async () => {
    const bus = createEventBus();
    const first = open(bus, "hospital:A");
    const [ready] = await take(first.stream, 1);
    first.stop();

    bus.publish(handover("h1"), "hospital:A");
    bus.publish(handover("other"), "hospital:B"); // not this channel's business
    bus.publish(incident); // nor this
    bus.publish(handover("h2"), "hospital:A");

    const again = open(bus, "hospital:A", ready!.id);
    const replayed = await take(again.stream, 5);
    expect(replayed.map((i) => (i.event as unknown as { handover: { id: string } }).handover.id)).toEqual(["h1", "h2"]);
    again.stop();
  });

  it("asks a client that missed more than the buffer holds to fetch its list again", async () => {
    const bus = createEventBus({ bufferSize: 2 });
    const first = open(bus, "hospital:A");
    const [ready] = await take(first.stream, 1);
    first.stop();
    for (let i = 0; i < 5; i++) bus.publish(handover(`h${i}`), "hospital:A");

    const again = open(bus, "hospital:A", ready!.id);
    expect((await take(again.stream, 1)).map((i) => i.event.type)).toEqual(["resync"]);
    again.stop();
  });

  it("asks for a fresh start when the id is from another run of the server", async () => {
    const bus = createEventBus();
    const again = open(bus, "hospital:A", "another-boot:3");
    expect((await take(again.stream, 1)).map((i) => i.event.type)).toEqual(["resync"]);
    again.stop();
  });
});
