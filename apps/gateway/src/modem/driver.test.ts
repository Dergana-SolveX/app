import { describe, expect, it, vi } from "vitest";

import { replayLink } from "../testing/replay-link";
import { HEX, initSteps, OK } from "../testing/transcripts";
import { createModemDriver, type DeliveryReport, type IncomingSms } from "./driver";

/** Waits until the driver has done everything the transcript expects of it. */
const untilDone = (modem: ReturnType<typeof replayLink>) =>
  vi.waitFor(() => expect(modem.remaining()).toEqual([]));

describe("modem driver: start-up", () => {
  it("wakes the modem, sets text mode, UCS2 text and new-message notifications, then looks for stored messages", async () => {
    const modem = replayLink(initSteps());
    const driver = createModemDriver(modem.link);

    await driver.init();

    expect(modem.remaining()).toEqual([]);
  });
});

describe("modem driver: incoming messages", () => {
  it("reads a new message when the modem announces it, hands it over decoded, then deletes it", async () => {
    const received: IncomingSms[] = [];
    const modem = replayLink([
      ...initSteps(),
      { modem: '\r\n+CMTI: "SM",3\r\n' },
      {
        host: "AT+CMGR=3\r",
        modem: `\r\n+CMGR: "REC UNREAD","${HEX.plus213550000001}","","26/10/30,12:00:00+04"\r\n${HEX.hadith}\r\n` + OK,
      },
      { host: "AT+CMGD=3\r", modem: OK },
    ]);
    const driver = createModemDriver(modem.link);
    driver.onMessage(async (sms) => void received.push(sms));

    await driver.init();
    await untilDone(modem);

    // "+04" is four quarter-hours ahead of UTC (Algeria, UTC+1): 12:00 there is 11:00 UTC.
    expect(received).toEqual([
      { from: "+213550000001", body: "حادث", receivedAt: new Date("2026-10-30T11:00:00Z") },
    ]);
  });
});

describe("modem driver: never losing a message", () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

  it("leaves a message on the SIM when handing it over fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const modem = replayLink([
      ...initSteps(),
      { modem: '\r\n+CMTI: "SM",3\r\n' },
      {
        host: "AT+CMGR=3\r",
        modem: `\r\n+CMGR: "REC UNREAD","${HEX.plus213550000001}","","26/10/30,12:00:00+04"\r\n${HEX.accident}\r\n` + OK,
      },
    ]);
    const driver = createModemDriver(modem.link);
    driver.onMessage(async () => {
      throw new Error("server down");
    });

    await driver.init();
    await untilDone(modem);
    await tick();

    expect(modem.written).not.toContain("AT+CMGD=3\r"); // not deleted: the start-up sweep will offer it again
    quiet.mockRestore();
  });

  it("hands over what reached the SIM while the gateway was down, skipping our own sent messages", async () => {
    const received: IncomingSms[] = [];
    const stored =
      `\r\n+CMGL: 1,"REC READ","${HEX.plus213550000001}","","26/10/30,11:00:00+04"\r\n${HEX.accident}\r\n` +
      `+CMGL: 2,"STO SENT","${HEX.plus213550000001}","","26/10/30,11:05:00+04"\r\n${HEX.ack}\r\n` +
      `+CMGL: 5,"REC UNREAD","${HEX.plus213550000002}","","26/10/30,11:30:00+04"\r\n${HEX.hadith}\r\n` +
      OK;
    const modem = replayLink([
      ...initSteps(stored),
      { host: "AT+CMGD=1\r", modem: OK },
      { host: "AT+CMGD=5\r", modem: OK },
    ]);
    const driver = createModemDriver(modem.link);
    driver.onMessage(async (sms) => void received.push(sms));

    await driver.init(); // start-up is over only once the sweep is handled

    expect(modem.remaining()).toEqual([]);
    expect(received.map((sms) => [sms.from, sms.body])).toEqual([
      ["+213550000001", "ACCIDENT"],
      ["+213550000002", "حادث"],
    ]);
  });
});

describe("modem driver: sending", () => {
  it("sends a text and returns the reference the network assigned", async () => {
    const modem = replayLink([
      ...initSteps(),
      { host: `AT+CMGS="${HEX.plus213550000001}"\r`, modem: "\r\n> " }, // the prompt has no line ending
      { host: `${HEX.ack}\x1a`, modem: "\r\n+CMGS: 12\r\n" + OK }, // Ctrl-Z ends the text
    ]);
    const driver = createModemDriver(modem.link);
    await driver.init();

    const sent = await driver.send("+213550000001", "SVXACK#AB12CD34");

    expect(sent).toEqual({ ref: 12 });
    expect(modem.remaining()).toEqual([]);
  });
});

describe("modem driver: Arabic and accents", () => {
  const sendSteps = (hexBody: string, ref: number, to = HEX.plus213550000001) => [
    { host: `AT+CMGS="${to}"\r`, modem: "\r\n> " },
    { host: `${hexBody}\x1a`, modem: `\r\n+CMGS: ${ref}\r\n` + OK },
  ];

  it("switches to UCS2 for a text GSM cannot carry, and back for the next plain one; an accent stays plain GSM", async () => {
    const modem = replayLink([
      ...initSteps(),
      { host: "AT+CSMP=49,167,0,8\r", modem: OK }, // Arabic: UCS2
      ...sendSteps(HEX.hadith, 13),
      { host: "AT+CSMP=49,167,0,0\r", modem: OK }, // plain again
      ...sendSteps(HEX.ack, 14),
      ...sendSteps("00E9", 15), // "é" is in the GSM alphabet: no switch
    ]);
    const driver = createModemDriver(modem.link);
    await driver.init();

    const refs = [
      (await driver.send("+213550000001", "حادث")).ref,
      (await driver.send("+213550000001", "SVXACK#AB12CD34")).ref,
      (await driver.send("+213550000001", "é")).ref,
    ];

    expect(refs).toEqual([13, 14, 15]);
    expect(modem.remaining()).toEqual([]);
  });

  it("never interleaves two sends issued at the same time (each keeps its own encoding)", async () => {
    const modem = replayLink([
      ...initSteps(),
      { host: "AT+CSMP=49,167,0,8\r", modem: OK },
      ...sendSteps(HEX.hadith, 20),
      { host: "AT+CSMP=49,167,0,0\r", modem: OK },
      ...sendSteps(HEX.ack, 21, HEX.plus213550000002),
    ]);
    const driver = createModemDriver(modem.link);
    await driver.init();

    const [arabic, plain] = await Promise.all([
      driver.send("+213550000001", "حادث"),
      driver.send("+213550000002", "SVXACK#AB12CD34"),
    ]);

    expect([arabic.ref, plain.ref]).toEqual([20, 21]);
    expect(modem.remaining()).toEqual([]);
  });
});

describe("modem driver: delivery reports", () => {
  const report = (ref: number, status: number) =>
    `\r\n+CDS: 6,${ref},"${HEX.plus213550000001}",145,"26/10/30,12:00:00+04","26/10/30,12:00:05+04",${status}\r\n`;

  it("tells whether a sent text was delivered or failed for good, and ignores 'still trying'", async () => {
    const reports: DeliveryReport[] = [];
    const modem = replayLink([
      ...initSteps(),
      { modem: report(40, 0) }, // received by the phone
      { modem: report(41, 32) }, // network is still trying: not final
      { modem: report(42, 70) }, // permanent failure
    ]);
    const driver = createModemDriver(modem.link);
    driver.onDeliveryReport((r) => reports.push(r));

    await driver.init();
    await untilDone(modem);

    expect(reports).toEqual([
      { ref: 40, status: "delivered" },
      { ref: 42, status: "failed" },
    ]);
  });
});

describe("modem driver: when things go wrong", () => {
  const sendSteps = (hexBody: string, ref: number) => [
    { host: `AT+CMGS="${HEX.plus213550000001}"\r`, modem: "\r\n> " },
    { host: `${hexBody}\x1a`, modem: `\r\n+CMGS: ${ref}\r\n` + OK },
  ];

  it("rejects a send the modem refuses, and carries on with the next one", async () => {
    const modem = replayLink([
      ...initSteps(),
      { host: `AT+CMGS="${HEX.plus213550000001}"\r`, modem: "\r\n+CMS ERROR: 330\r\n" }, // SMSC number unknown
      ...sendSteps(HEX.ack, 7),
    ]);
    const driver = createModemDriver(modem.link);
    await driver.init();

    await expect(driver.send("+213550000001", "SVXACK#AB12CD34")).rejects.toThrow("+CMS ERROR: 330");
    expect(await driver.send("+213550000001", "SVXACK#AB12CD34")).toEqual({ ref: 7 });
  });

  it("refuses a text too long for one SMS instead of cutting it, and writes nothing", async () => {
    const modem = replayLink(initSteps());
    const driver = createModemDriver(modem.link);
    await driver.init();

    await expect(driver.send("+213550000001", "a".repeat(161))).rejects.toThrow(/too long/i); // 160 GSM characters
    await expect(driver.send("+213550000001", "€".repeat(81))).rejects.toThrow(/too long/i); // "€" counts double
    await expect(driver.send("+213550000001", "ا".repeat(71))).rejects.toThrow(/too long/i); // 70 UCS2 characters
    expect(modem.written).toHaveLength(initSteps().length); // only the start-up commands
  });

  it("gives up on a modem that stops answering: that send and everything queued fails, and the owner is told to reconnect", async () => {
    vi.useFakeTimers();
    try {
      const modem = replayLink([...initSteps(), { host: `AT+CMGS="${HEX.plus213550000001}"\r`, modem: "" }]);
      const driver = createModemDriver(modem.link, { sendTimeoutMs: 1_000 });
      const fatal = vi.fn();
      driver.onFatal(fatal);
      await driver.init();

      const first = driver.send("+213550000001", "SVXACK#AB12CD34");
      const second = driver.send("+213550000001", "SVXACK#AB12CD34");
      const outcomes = Promise.allSettled([first, second]);
      await vi.advanceTimersByTimeAsync(1_500);

      expect((await outcomes).map((o) => o.status)).toEqual(["rejected", "rejected"]);
      expect(fatal).toHaveBeenCalledTimes(1);
      expect(fatal.mock.calls[0]![0].message).toMatch(/did not answer/i);
      await expect(driver.send("+213550000001", "x")).rejects.toThrow(/connection is down/i); // dead until reconnected
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("modem driver: a noisy line", () => {
  const readSteps = (index: number, hexFrom: string, hexBody: string) => [
    {
      host: `AT+CMGR=${index}\r`,
      modem: `\r\n+CMGR: "REC UNREAD","${hexFrom}","","26/10/30,12:00:00+04"\r\n${hexBody}\r\n` + OK,
    },
    { host: `AT+CMGD=${index}\r`, modem: OK },
  ];

  it("keeps a send intact when a new-message notice lands in the middle of it, and reads that message afterwards", async () => {
    const received: IncomingSms[] = [];
    const modem = replayLink([
      ...initSteps(),
      { host: `AT+CMGS="${HEX.plus213550000001}"\r`, modem: "\r\n> " },
      { host: `${HEX.ack}\x1a`, modem: '\r\n+CMTI: "SM",4\r\n\r\n+CMGS: 12\r\n' + OK }, // the notice interrupts the answer
      ...readSteps(4, HEX.plus213550000002, HEX.hadith),
    ]);
    const driver = createModemDriver(modem.link);
    driver.onMessage(async (sms) => void received.push(sms));
    await driver.init();

    const sent = await driver.send("+213550000001", "SVXACK#AB12CD34");
    await untilDone(modem);

    expect(sent).toEqual({ ref: 12 });
    expect(received.map((sms) => sms.body)).toEqual(["حادث"]);
  });

  it("copes with the modem's answers arriving in tiny fragments", async () => {
    const received: IncomingSms[] = [];
    const modem = replayLink(
      [...initSteps(), { modem: '\r\n+CMTI: "SM",3\r\n' }, ...readSteps(3, HEX.plus213550000001, HEX.accident)],
      { chunkSize: 3 },
    );
    const driver = createModemDriver(modem.link);
    driver.onMessage(async (sms) => void received.push(sms));

    await driver.init();
    await untilDone(modem);

    expect(received.map((sms) => sms.body)).toEqual(["ACCIDENT"]);
  });
});

describe("modem driver: a failing hand-over during the sweep", () => {
  it("skips the message it could not hand over (it stays on the SIM) and still handles the others", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const stored =
      `\r\n+CMGL: 1,"REC READ","${HEX.plus213550000001}","","26/10/30,11:00:00+04"\r\n${HEX.accident}\r\n` +
      `+CMGL: 2,"REC READ","${HEX.plus213550000002}","","26/10/30,11:30:00+04"\r\n${HEX.hadith}\r\n` +
      OK;
    const modem = replayLink([...initSteps(stored), { host: "AT+CMGD=2\r", modem: OK }]);
    const driver = createModemDriver(modem.link);
    driver.onMessage(async (sms) => {
      if (sms.body === "ACCIDENT") throw new Error("server down");
    });

    await driver.init();

    expect(modem.remaining()).toEqual([]);
    expect(modem.written).not.toContain("AT+CMGD=1\r"); // message 1 is still on the SIM
    quiet.mockRestore();
  });

  it("can sweep again on demand, so a message left behind is offered once the server is back", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const listing =
      `\r\n+CMGL: 1,"REC READ","${HEX.plus213550000001}","","26/10/30,11:00:00+04"\r\n${HEX.accident}\r\n` + OK;
    const modem = replayLink([
      ...initSteps(listing),
      { host: 'AT+CMGL="ALL"\r', modem: listing }, // the second sweep sees it again
      { host: "AT+CMGD=1\r", modem: OK },
    ]);
    const driver = createModemDriver(modem.link);
    let serverUp = false;
    const received: string[] = [];
    driver.onMessage(async (sms) => {
      if (!serverUp) throw new Error("server down");
      received.push(sms.body);
    });
    await driver.init();
    expect(received).toEqual([]);

    serverUp = true;
    await driver.sweep();

    expect(received).toEqual(["ACCIDENT"]);
    expect(modem.remaining()).toEqual([]);
    quiet.mockRestore();
  });
});

describe("modem driver: characters", () => {
  it("keeps a backslash in the GSM alphabet (two places each, so 80 fit in one SMS and 81 do not)", async () => {
    const hex = "005C".repeat(80); // "\" is U+005C
    const modem = replayLink([
      ...initSteps(),
      { host: `AT+CMGS="${HEX.plus213550000001}"\r`, modem: "\r\n> " },
      { host: `${hex}\x1a`, modem: "\r\n+CMGS: 3\r\n" + OK }, // no switch to UCS2: it is GSM text
    ]);
    const driver = createModemDriver(modem.link);
    await driver.init();

    expect(await driver.send("+213550000001", "\\".repeat(80))).toEqual({ ref: 3 });
    await expect(driver.send("+213550000001", "\\".repeat(81))).rejects.toThrow(/too long/i);
  });
});

describe("modem driver: one message, one hand-over", () => {
  it("does not hand over a message again while it is still being handled (a sweep must skip it)", async () => {
    const listing = `\r\n+CMGL: 3,"REC READ","${HEX.plus213550000001}","","26/10/30,12:00:00+04"\r\n${HEX.accident}\r\n` + OK;
    const modem = replayLink([
      ...initSteps(),
      { modem: '\r\n+CMTI: "SM",3\r\n' },
      {
        host: "AT+CMGR=3\r",
        modem: `\r\n+CMGR: "REC UNREAD","${HEX.plus213550000001}","","26/10/30,12:00:00+04"\r\n${HEX.accident}\r\n` + OK,
      },
      { host: 'AT+CMGL="ALL"\r', modem: listing }, // the sweep still sees it: it has not been deleted yet
      { host: "AT+CMGD=3\r", modem: OK },
    ]);
    const driver = createModemDriver(modem.link);
    let release: () => void = () => {};
    const slow = new Promise<void>((resolve) => (release = resolve));
    const handled: string[] = [];
    driver.onMessage(async (sms) => {
      handled.push(sms.body);
      await slow; // the server is taking its time
    });
    await driver.init();
    await vi.waitFor(() => expect(handled).toEqual(["ACCIDENT"]));

    await driver.sweep(); // runs while the first hand-over is still in progress
    release();
    await untilDone(modem);

    expect(handled).toEqual(["ACCIDENT"]); // once, not twice
  });
});
