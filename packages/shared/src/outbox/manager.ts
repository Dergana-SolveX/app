import { buildWitnessSvxString } from "../sms/builder";

export type OutboxChannel = "online" | "sms";
export type OutboxStatus = "pending" | "sending" | "acked" | "failed";

export interface OutboxItemPayload {
  victims: number;
  conscious: 0 | 1 | 2 | null;
  fire: boolean;
  trapped: boolean;
  bleeding: boolean;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  commune: string | null;
  pkMarker: string | null;
}

export interface OutboxItem {
  id: string;
  idempotencyKey: string;
  source: "app_witness" | "app_auto";
  channel: OutboxChannel;
  status: OutboxStatus;
  failedOnlineAttempts: number;
  payload: OutboxItemPayload;
  svxString: string;
  createdAt: number;
  lastAttemptAt: number | null;
  ackMessage?: string | null;
  error?: string | null;
}

export interface OutboxStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export function createMemoryStorage(): OutboxStorage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
}

export interface EnqueueOptions {
  idempotencyKey: string;
  source?: "app_witness" | "app_auto";
  payload: OutboxItemPayload;
  forcedSms?: boolean;
}

export interface ProcessQueueHandlers {
  onlineAvailable: boolean;
  sendOnline: (item: OutboxItem) => Promise<{ alertId?: string; incidentId?: string }>;
  sendSms: (item: OutboxItem) => Promise<{ ack?: string; alertId?: string; incidentId?: string }>;
}

export class OutboxManager {
  private storage: OutboxStorage;
  private storageKey: string;
  private cache: OutboxItem[] | null = null;

  constructor(options?: { storage?: OutboxStorage; storageKey?: string }) {
    this.storage = options?.storage ?? createMemoryStorage();
    this.storageKey = options?.storageKey ?? "solvex_outbox_items";
  }

  private async load(): Promise<OutboxItem[]> {
    if (this.cache !== null) return this.cache;
    const raw = await this.storage.getItem(this.storageKey);
    if (!raw) {
      this.cache = [];
      return this.cache;
    }
    try {
      this.cache = JSON.parse(raw);
      return this.cache!;
    } catch {
      this.cache = [];
      return this.cache;
    }
  }

  private async persist(): Promise<void> {
    if (this.cache !== null) {
      await this.storage.setItem(this.storageKey, JSON.stringify(this.cache));
    }
  }

  async getItems(): Promise<OutboxItem[]> {
    return this.load();
  }

  async getPendingItems(): Promise<OutboxItem[]> {
    const items = await this.load();
    return items.filter((it) => it.status !== "acked");
  }

  async enqueue(options: EnqueueOptions): Promise<OutboxItem> {
    const items = await this.load();
    const now = Date.now();
    const id = `outbox-${now}-${Math.random().toString(36).substring(2, 7)}`;

    const { svx } = buildWitnessSvxString({
      victims: options.payload.victims,
      conscious: options.payload.conscious,
      fire: options.payload.fire,
      trapped: options.payload.trapped,
      bleeding: options.payload.bleeding,
      lat: options.payload.lat,
      lng: options.payload.lng,
      timestamp: now,
    });

    const item: OutboxItem = {
      id,
      idempotencyKey: options.idempotencyKey,
      source: options.source ?? "app_witness",
      channel: options.forcedSms ? "sms" : "online",
      status: "pending",
      failedOnlineAttempts: 0,
      payload: options.payload,
      svxString: svx,
      createdAt: now,
      lastAttemptAt: null,
    };

    items.push(item);
    await this.persist();
    return item;
  }

  /**
   * Records a failed transmission attempt.
   * If in 'online' channel and failedOnlineAttempts reaches 2,
   * automatically falls back to 'sms' channel (FR-S4-04).
   */
  async recordFailure(id: string, error: string): Promise<OutboxItem | null> {
    const items = await this.load();
    const item = items.find((it) => it.id === id);
    if (!item) return null;

    item.lastAttemptAt = Date.now();
    item.error = error;

    if (item.channel === "online") {
      item.failedOnlineAttempts += 1;
      if (item.failedOnlineAttempts >= 2) {
        item.channel = "sms";
      }
    }

    item.status = "failed";
    await this.persist();
    return item;
  }

  /**
   * Records successful acknowledgement (stopping all retries).
   */
  async recordAck(id: string, ackMessage?: string): Promise<OutboxItem | null> {
    const items = await this.load();
    const item = items.find((it) => it.id === id);
    if (!item) return null;

    item.status = "acked";
    item.ackMessage = ackMessage ?? "ACK";
    item.error = null;
    await this.persist();
    return item;
  }

  /**
   * Processes all pending items according to channel availability.
   */
  async processQueue(handlers: ProcessQueueHandlers): Promise<void> {
    const pending = await this.getPendingItems();

    for (const item of pending) {
      if (item.channel === "online") {
        if (!handlers.onlineAvailable) {
          continue; // wait for connectivity
        }
        item.status = "sending";
        try {
          const res = await handlers.sendOnline(item);
          await this.recordAck(item.id, `ONLINE:${res.incidentId ?? res.alertId ?? "OK"}`);
        } catch (err: any) {
          await this.recordFailure(item.id, err.message || "Online error");
        }
      } else if (item.channel === "sms") {
        item.status = "sending";
        try {
          const res = await handlers.sendSms(item);
          await this.recordAck(item.id, res.ack ?? "SMS_SENT");
        } catch (err: any) {
          await this.recordFailure(item.id, err.message || "SMS error");
        }
      }
    }
  }

  async clear(): Promise<void> {
    this.cache = [];
    await this.storage.removeItem(this.storageKey);
  }
}
