import type { DeliveryReport, IncomingSms } from "../modem/driver";
import { ModemUnavailableError } from "../modem/service";

type Log = Pick<Console, "info" | "warn" | "error">;

export type AndroidRelayOptions = {
  log?: Log;
};

export type SentRelaySms = {
  to: string;
  body: string;
  ref: number;
};

export type AndroidRelayService = {
  start(): void;
  stop(): void;
  whenConnected(): Promise<void>;
  status(): "connecting" | "connected" | "stopped";
  onMessage(handler: (sms: IncomingSms) => Promise<void>): void;
  onDeliveryReport(handler: (report: DeliveryReport) => void): void;
  send(to: string, body: string): Promise<{ ref: number }>;
  receiveFromDevice(sms: { from: string; body: string; receivedAt?: Date }): Promise<void>;
  reportDeliveryFromDevice(report: { ref: number; status: "delivered" | "failed" }): void;
  sentSms: SentRelaySms[];
};

/**
 * An Android phone acting as an SMS relay gateway (FR-S3-08, FR-S3-10).
 * Can be tested with fixtures and used with an Android phone running svx-sms.
 */
export function createAndroidRelayService({ log = console }: AndroidRelayOptions = {}): AndroidRelayService {
  let isConnected = false;
  let nextRef = 1;
  const sentSms: SentRelaySms[] = [];
  const messageHandlers: ((sms: IncomingSms) => Promise<void>)[] = [];
  const deliveryHandlers: ((report: DeliveryReport) => void)[] = [];

  return {
    sentSms,

    start() {
      isConnected = true;
      log.info?.("[android-relay] started and connected");
    },

    stop() {
      isConnected = false;
      log.info?.("[android-relay] stopped");
    },

    async whenConnected() {
      return;
    },

    status() {
      return isConnected ? "connected" : "stopped";
    },

    onMessage(handler) {
      messageHandlers.push(handler);
    },

    onDeliveryReport(handler) {
      deliveryHandlers.push(handler);
    },

    async send(to: string, body: string) {
      if (!isConnected) throw new ModemUnavailableError("Android relay is stopped");
      const ref = nextRef++;
      sentSms.push({ to, body, ref });
      return { ref };
    },

    async receiveFromDevice(sms) {
      const incoming: IncomingSms = {
        from: sms.from,
        body: sms.body,
        receivedAt: sms.receivedAt ?? new Date(),
      };
      for (const handler of messageHandlers) {
        await handler(incoming);
      }
    },

    reportDeliveryFromDevice(report) {
      for (const handler of deliveryHandlers) {
        handler(report);
      }
    },
  };
}
