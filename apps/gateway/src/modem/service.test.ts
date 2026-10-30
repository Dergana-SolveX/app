import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { replayLink } from "../testing/replay-link";
import { HEX, initSteps, OK } from "../testing/transcripts";
import { createModemService } from "./service";

const quiet = () => ({ info: () => {}, warn: () => {}, error: () => {} });

const readSteps = (index: number, hexFrom: string, hexBody: string) => [
  {
    host: `AT+CMGR=${index}\r`,
    modem: `\r\n+CMGR: "REC UNREAD","${hexFrom}","","26/10/30,12:00:00+04"\r\n${hexBody}\r\n` + OK,
  },
  { host: `AT+CMGD=${index}\r`, modem: OK },
];

describe("modem service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects, passes incoming messages to the handler and sends texts", async () => {
    const modem = replayLink([
      ...initSteps(),
      { modem: '\r\n+CMTI: "SM",3\r\n' },
      ...readSteps(3, HEX.plus213550000001, HEX.accident),
      { host: `AT+CMGS="${HEX.plus213550000001}"\r`, modem: "\r\n> " },
      { host: `${HEX.ack}\x1a`, modem: "\r\n+CMGS: 12\r\n" + OK },
    ]);
    const service = createModemService({ open: async () => modem.link, log: quiet() });
    const received: string[] = [];
    service.onMessage(async (sms) => void received.push(sms.body));

    service.start();
    await service.whenConnected();
    await vi.advanceTimersByTimeAsync(0);
    const sent = await service.send("+213550000001", "SVXACK#AB12CD34");

    expect(received).toEqual(["ACCIDENT"]);
    expect(sent).toEqual({ ref: 12 });
    expect(service.status()).toBe("connected");
    service.stop();
  });

  it("after an unplug, refuses to send, reconnects on its own, and picks up what arrived meanwhile", async () => {
    const first = replayLink(initSteps());
    const stored =
      `\r\n+CMGL: 1,"REC UNREAD","${HEX.plus213550000001}","","26/10/30,11:00:00+04"\r\n${HEX.accident}\r\n` + OK;
    const second = replayLink([...initSteps(stored), { host: "AT+CMGD=1\r", modem: OK }]);
    const open = vi.fn().mockResolvedValueOnce(first.link).mockResolvedValueOnce(second.link);
    const service = createModemService({ open, retryDelaysMs: [1_000], log: quiet() });
    const received: string[] = [];
    service.onMessage(async (sms) => void received.push(sms.body)); // registered once, kept across reconnects
    service.start();
    await service.whenConnected();

    first.unplug();
    await vi.advanceTimersByTimeAsync(0);

    expect(service.status()).toBe("connecting");
    await expect(service.send("+213550000001", "x")).rejects.toThrow(/unavailable/i);
    expect(open).toHaveBeenCalledTimes(1); // it waits before trying again

    await vi.advanceTimersByTimeAsync(1_000);
    await service.whenConnected();

    expect(open).toHaveBeenCalledTimes(2);
    expect(received).toEqual(["ACCIDENT"]); // the message that reached the SIM while it was unplugged
    expect(second.remaining()).toEqual([]);
    expect(service.status()).toBe("connected");
    service.stop();
  });

  it("keeps trying with growing delays while the port is missing", async () => {
    const modem = replayLink(initSteps());
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error("no such port"))
      .mockRejectedValueOnce(new Error("no such port"))
      .mockResolvedValueOnce(modem.link);
    const service = createModemService({ open, retryDelaysMs: [1_000, 2_000], log: quiet() });

    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(open).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(open).toHaveBeenCalledTimes(2); // after 1 s
    await vi.advanceTimersByTimeAsync(2_000);
    expect(open).toHaveBeenCalledTimes(3); // then 2 s later
    await service.whenConnected();
    expect(service.status()).toBe("connected");
    service.stop();
  });

  it("stops trying to reconnect once stopped", async () => {
    const first = replayLink(initSteps());
    const open = vi.fn().mockResolvedValue(first.link);
    const service = createModemService({ open, retryDelaysMs: [1_000], log: quiet() });
    service.start();
    await service.whenConnected();
    first.unplug();
    await vi.advanceTimersByTimeAsync(0);

    service.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(open).toHaveBeenCalledTimes(1);
    expect(service.status()).toBe("stopped");
  });

  it("sweeps the SIM again from time to time, so a message left behind is handed over once the server is back", async () => {
    const modem = replayLink([...initSteps(), { host: 'AT+CMGL="ALL"\r', modem: OK }]);
    const service = createModemService({ open: async () => modem.link, sweepEveryMs: 60_000, log: quiet() });
    service.start();
    await service.whenConnected();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(modem.remaining()).toEqual([]);
    service.stop();
  });
});
