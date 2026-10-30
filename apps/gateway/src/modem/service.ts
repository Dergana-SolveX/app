import { createModemDriver, type DeliveryReport, type DriverOptions, type IncomingSms, type ModemDriver } from "./driver";
import type { SerialLink } from "./link";

/** Sending while the modem is not connected (unplugged, or still starting). The caller may retry later. */
export class ModemUnavailableError extends Error {}

type Log = Pick<Console, "info" | "warn" | "error">;

export type ModemServiceOptions = {
  /** Opens the serial port. Called again after every failure or unplug. */
  open: () => Promise<SerialLink>;
  driverOptions?: DriverOptions;
  /** Waits between reconnection attempts; the last value repeats. */
  retryDelaysMs?: number[];
  /** While connected, hand over what is still on the SIM this often (a failed hand-over is retried). */
  sweepEveryMs?: number;
  log?: Log;
};

export type ModemService = {
  start(): void;
  stop(): void;
  /** Resolves once the modem is connected and initialised (immediately if it already is). */
  whenConnected(): Promise<void>;
  status(): "connecting" | "connected" | "stopped";
  onMessage(handler: (sms: IncomingSms) => Promise<void>): void;
  onDeliveryReport(handler: (report: DeliveryReport) => void): void;
  /** Sends a text through the modem; rejects with `ModemUnavailableError` while it is not connected. */
  send(to: string, body: string): Promise<{ ref: number }>;
};

/**
 * Keeps one modem connected: opens the port, initialises the driver (which sweeps the SIM), and when the
 * USB modem is unplugged or stops answering, starts over after a growing delay. Handlers stay registered
 * across reconnections.
 */
export function createModemService({
  open,
  driverOptions,
  retryDelaysMs = [1_000, 2_000, 5_000, 10_000, 30_000],
  sweepEveryMs = 60_000,
  log = console,
}: ModemServiceOptions): ModemService {
  let driver: ModemDriver | null = null;
  let status: "connecting" | "connected" | "stopped" = "connecting";
  let started = false;
  let failures = 0;
  /** Identifies the connection attempt in progress, so that one failure schedules exactly one retry. */
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let sweepTimer: ReturnType<typeof setInterval> | undefined;
  let currentLink: SerialLink | null = null;
  let waiting: (() => void)[] = [];
  let messageHandler: (sms: IncomingSms) => Promise<void> = async () => {};
  let reportHandler: (report: DeliveryReport) => void = () => {};

  /** `status` changes while we await, which TypeScript's narrowing cannot see: ask through a function. */
  const isStopped = () => status === "stopped";

  const retryLater = (mine: number) => {
    if (mine !== attempt || isStopped()) return;
    attempt++; // this attempt is over: nothing else may schedule a retry for it
    clearInterval(sweepTimer);
    driver = null;
    status = "connecting";
    const delay = retryDelaysMs[Math.min(failures++, retryDelaysMs.length - 1)] ?? 1_000;
    log.warn(`[modem] not connected, trying again in ${delay} ms`);
    retryTimer = setTimeout(() => void connect(), delay);
  };

  async function connect() {
    if (isStopped()) return;
    const mine = ++attempt;
    try {
      const link = await open();
      currentLink = link;
      const next = createModemDriver(link, driverOptions);
      next.onMessage((sms) => messageHandler(sms));
      next.onDeliveryReport((report) => reportHandler(report));
      next.onFatal((error) => {
        log.warn("[modem] connection lost:", error.message);
        retryLater(mine);
      });
      await next.init();
      if (mine !== attempt || isStopped()) return; // lost or stopped while starting
      driver = next;
      status = "connected";
      failures = 0;
      sweepTimer = setInterval(() => void next.sweep().catch((error) => log.error("[modem] sweep failed", error)), sweepEveryMs);
      log.info("[modem] connected");
      waiting.forEach((resolve) => resolve());
      waiting = [];
    } catch (error) {
      log.error("[modem] could not connect:", error instanceof Error ? error.message : error);
      try {
        currentLink?.close();
      } catch {
        // already gone
      }
      retryLater(mine);
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      void connect();
    },
    stop() {
      status = "stopped";
      clearTimeout(retryTimer);
      clearInterval(sweepTimer);
      driver = null;
      try {
        currentLink?.close();
      } catch {
        // already gone
      }
    },
    whenConnected: () => (status === "connected" ? Promise.resolve() : new Promise<void>((resolve) => waiting.push(resolve))),
    status: () => status,
    onMessage(handler) {
      messageHandler = handler;
    },
    onDeliveryReport(handler) {
      reportHandler = handler;
    },
    async send(to, body) {
      if (!driver) throw new ModemUnavailableError("The modem is unavailable (not connected)");
      return driver.send(to, body);
    },
  };
}
