import { deriveDeviceKey, signDevicePayload } from "@solvex-dergana/shared";

export type DeviceClientOptions = {
  deviceId: string;
  masterDeviceSecret: string;
  baseUrl?: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response;
};

export type HeartbeatPayload = {
  batteryPct?: number;
  batteryMv?: number;
  state?: string;
  firmwareVersion?: string;
  gps?: { fix: boolean; sats: number; lat: number | null; lng: number | null };
  [key: string]: unknown;
};

export type CrashEventPayload = {
  data: {
    gForce?: number;
    deltaVKmh?: number;
    rollover?: boolean;
    rolloverDeg?: number;
    fire?: boolean;
    lat?: number;
    lng?: number;
    accuracyM?: number;
    victims?: number;
    conscious?: number;
    trapped?: boolean;
    bleeding?: boolean;
    [key: string]: unknown;
  };
  emulated?: boolean;
  traceInjected?: boolean;
  t?: number;
};

export class DeviceClient {
  readonly deviceId: string;
  private readonly masterDeviceSecret: string;
  private readonly baseUrl: string;
  private readonly customFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response;
  private cachedKey: Uint8Array<ArrayBuffer> | null = null;

  constructor(options: DeviceClientOptions) {
    this.deviceId = options.deviceId;
    this.masterDeviceSecret = options.masterDeviceSecret;
    this.baseUrl = (options.baseUrl ?? "http://localhost:3000").replace(/\/$/, "");
    this.customFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async getKey(): Promise<Uint8Array<ArrayBuffer>> {
    if (!this.cachedKey) {
      this.cachedKey = await deriveDeviceKey(this.masterDeviceSecret, this.deviceId);
    }
    return this.cachedKey;
  }

  private async postSigned(endpoint: string, payload: Record<string, unknown>) {
    const key = await this.getKey();
    const now = Date.now();
    const fullPayload = {
      deviceId: this.deviceId,
      t: now,
      ...payload,
    };
    const body = JSON.stringify(fullPayload);
    const signature = await signDevicePayload(key, body);

    const url = `${this.baseUrl}${endpoint}`;
    const res = await this.customFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SVX-Signature": signature,
        "X-SVX-Timestamp": String(now),
      },
      body,
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      status: res.status,
      ok: res.ok,
      ...json,
    } as {
      status: number;
      ok: boolean;
      incidentId?: string;
      ack?: string;
      error?: string;
      [key: string]: unknown;
    };
  }

  async sendHeartbeat(telemetry: HeartbeatPayload = {}) {
    return this.postSigned(`/devices/${this.deviceId}/heartbeat`, telemetry);
  }

  async sendCrashEvent(event: CrashEventPayload) {
    return this.postSigned(`/devices/${this.deviceId}/events`, {
      type: "impact_detected",
      ...event,
    });
  }
}

export function createDeviceClient(options: DeviceClientOptions): DeviceClient {
  return new DeviceClient(options);
}
