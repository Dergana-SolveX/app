import { describe, expect, it, vi } from "vitest";

import {
  createMemoryStorage,
  OutboxManager,
  type OutboxItem,
} from "./manager";

describe("OutboxManager (FR-S4-04)", () => {
  it("enqueues an alert and persists it in storage", async () => {
    const storage = createMemoryStorage();
    const manager = new OutboxManager({ storage });

    const item = await manager.enqueue({
      idempotencyKey: "test-alert-1",
      source: "app_witness",
      payload: {
        victims: 2,
        conscious: 1,
        fire: false,
        trapped: true,
        bleeding: false,
        lat: 36.7,
        lng: 3.1,
        accuracyM: 10,
        commune: null,
        pkMarker: null,
      },
      forcedSms: false,
    });

    expect(item.id).toBeDefined();
    expect(item.channel).toBe("online");
    expect(item.status).toBe("pending");
    expect(item.failedOnlineAttempts).toBe(0);
    expect(item.svxString).toMatch(/^SVX1#.*#CK:[0-9A-F]{2}$/);

    // Verify storage persistence
    const loaded = await manager.getItems();
    expect(loaded.length).toBe(1);
    expect(loaded[0]?.id).toBe(item.id);
  });

  it("switches channel to 'sms' after two failed online attempts (FR-S4-04: two failed online attempts -> SMS path)", async () => {
    const storage = createMemoryStorage();
    const manager = new OutboxManager({ storage });

    const item = await manager.enqueue({
      idempotencyKey: "test-alert-2",
      source: "app_witness",
      payload: {
        victims: 1,
        conscious: 0,
        fire: true,
        trapped: false,
        bleeding: false,
        lat: null,
        lng: null,
        accuracyM: null,
        commune: "Bab Ezzouar",
        pkMarker: "PK 12",
      },
      forcedSms: false,
    });

    // First failed online attempt
    const afterFirstFail = await manager.recordFailure(item.id, "Network timeout 1");
    expect(afterFirstFail?.failedOnlineAttempts).toBe(1);
    expect(afterFirstFirstChannel(afterFirstFail)).toBe("online");

    function afterFirstFirstChannel(it: OutboxItem | null) {
      return it?.channel;
    }

    // Second failed online attempt -> automatic fallback to SMS channel!
    const afterSecondFail = await manager.recordFailure(item.id, "Network timeout 2");
    expect(afterSecondFail?.failedOnlineAttempts).toBe(2);
    expect(afterSecondFail?.channel).toBe("sms");
  });

  it("starts directly in 'sms' channel if forcedSms is true (FR-S4-06: Forcer canal SMS)", async () => {
    const storage = createMemoryStorage();
    const manager = new OutboxManager({ storage });

    const item = await manager.enqueue({
      idempotencyKey: "test-forced-sms",
      source: "app_witness",
      payload: {
        victims: 3,
        conscious: 2,
        fire: false,
        trapped: false,
        bleeding: true,
        lat: 36.75,
        lng: 3.05,
        accuracyM: 5,
        commune: null,
        pkMarker: null,
      },
      forcedSms: true,
    });

    expect(item.channel).toBe("sms");
    expect(item.status).toBe("pending");
  });

  it("stops retries when ack is received (FR-S4-04: outbox until ack)", async () => {
    const storage = createMemoryStorage();
    const manager = new OutboxManager({ storage });

    const item = await manager.enqueue({
      idempotencyKey: "test-ack",
      source: "app_witness",
      payload: {
        victims: 1,
        conscious: 1,
        fire: false,
        trapped: false,
        bleeding: false,
        lat: 36.75,
        lng: 3.05,
        accuracyM: 5,
        commune: null,
        pkMarker: null,
      },
    });

    await manager.recordAck(item.id, "SVXACK#INC-456");

    const pending = await manager.getPendingItems();
    expect(pending.length).toBe(0);

    const all = await manager.getItems();
    expect(all[0]?.status).toBe("acked");
    expect(all[0]?.ackMessage).toBe("SVXACK#INC-456");
  });

  it("retries pending items on connectivity change when online becomes available", async () => {
    const storage = createMemoryStorage();
    const manager = new OutboxManager({ storage });

    await manager.enqueue({
      idempotencyKey: "test-retry",
      source: "app_witness",
      payload: {
        victims: 1,
        conscious: 1,
        fire: false,
        trapped: false,
        bleeding: false,
        lat: 36.75,
        lng: 3.05,
        accuracyM: 5,
        commune: null,
        pkMarker: null,
      },
    });

    const sendOnlineMock = vi.fn().mockResolvedValue({ alertId: "a-1", incidentId: "i-1" });
    const sendSmsMock = vi.fn();

    // When offline, nothing is sent for online items
    await manager.processQueue({
      onlineAvailable: false,
      sendOnline: sendOnlineMock,
      sendSms: sendSmsMock,
    });
    expect(sendOnlineMock).not.toHaveBeenCalled();

    // When connectivity changes to online: retries and acks!
    await manager.processQueue({
      onlineAvailable: true,
      sendOnline: sendOnlineMock,
      sendSms: sendSmsMock,
    });
    expect(sendOnlineMock).toHaveBeenCalledTimes(1);

    const pendingAfter = await manager.getPendingItems();
    expect(pendingAfter.length).toBe(0);
  });
});
