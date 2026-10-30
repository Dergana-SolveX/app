import type { SerialLink } from "./link";
import { fromUcs2Hex, GSM_EXTENDED, isGsm7, parseModemTimestamp, toUcs2Hex } from "./text";

export type IncomingSms = { from: string; body: string; receivedAt: Date };

/** What the network finally did with a sent text. `ref` is the reference `send` returned. */
export type DeliveryReport = { ref: number; status: "delivered" | "failed" };

export type ModemDriver = {
  /** Wakes the modem and sets the modes the gateway relies on. Call once per connection. */
  init(): Promise<void>;
  /** Called for every message that reaches the SIM. The message is deleted from the SIM once the handler returns. */
  onMessage(handler: (sms: IncomingSms) => Promise<void>): void;
  /** Hands over whatever is stored on the SIM again (messages whose hand-over failed earlier). */
  sweep(): Promise<void>;
  /** Called when the network reports the final fate of a sent text. */
  onDeliveryReport(handler: (report: DeliveryReport) => void): void;
  /** Sends a text. Resolves with the reference the network gave it, once the modem accepted it. */
  send(to: string, body: string): Promise<{ ref: number }>;
  /**
   * The connection can no longer be trusted: the modem stopped answering, or the USB link closed.
   * Everything queued has failed; the driver is dead. Reconnect with a new link and a new driver.
   */
  onFatal(handler: (error: Error) => void): void;
};

export type DriverOptions = {
  /** How long an ordinary command may take to answer. */
  commandTimeoutMs?: number;
  /** How long `AT+CMGS` may take: the network has to accept the text first. Shorter than the server's wait for the gateway. */
  sendTimeoutMs?: number;
};

type Job = {
  command: string;
  /** How long the modem may take to answer this one. */
  timeoutMs: number;
  timer?: ReturnType<typeof setTimeout>;
  /** Written after the modem's `>` prompt (used by `AT+CMGS`). */
  payload?: string;
  payloadSent?: boolean;
  /** Lines of the response, without the echo and the final result code. */
  lines: string[];
  resolve: (lines: string[]) => void;
  reject: (error: Error) => void;
};

/** A modem refusing a command: `ERROR`, `+CME ERROR: …` or `+CMS ERROR: …`. */
export class ModemError extends Error {}

/** A text that does not fit in one SMS. Concatenated messages are not supported: the caller must shorten it. */
export class SmsTooLongError extends Error {}

const MAX_GSM_SEPTETS = 160;
const MAX_UCS2_UNITS = 70;

const FINAL_ERROR = /^(ERROR|\+CM[ES] ERROR:.*)$/;
/** `+CDS: <fo>,<ref>,"<recipient>",<type>,"<sent>","<delivered>",<status>`: a delivery report (status report). */
const DELIVERY_REPORT = /^\+CDS: \d+,(\d+),"[^"]*",\d+,"[^"]*","[^"]*",(\d+)$/;
/** `+CMTI: "SM",3`: a new message is stored at index 3. */
const NEW_MESSAGE = /^\+CMTI: "[A-Z]+",(\d+)$/;
/** `+CMGL: 1,"REC READ","<sender>","","<timestamp>"` (one per stored message in a listing) */
const LISTED_HEADER = /^\+CMGL: (\d+),"([^"]*)","([^"]*)","[^"]*","([^"]*)"/;
/** `+CMGR: "REC UNREAD","<sender>","","<timestamp>"` */
const MESSAGE_HEADER = /^\+CMGR: "[^"]*","([^"]*)","[^"]*","([^"]*)"/;

/**
 * Our own AT-command driver for a GSM modem in SMS text mode (PLAN.md S3.4-A).
 * It talks over a `SerialLink`, so the same code runs on a real port and on a replayed transcript.
 */
export function createModemDriver(
  link: SerialLink,
  { commandTimeoutMs = 5_000, sendTimeoutMs = 30_000 }: DriverOptions = {},
): ModemDriver {
  const queue: Job[] = [];
  let current: Job | null = null;
  let dead: Error | null = null;
  let fatalHandler: (error: Error) => void = () => {};
  let buffer = "";
  let messageHandler: (sms: IncomingSms) => Promise<void> = async () => {};
  /** Data coding of outgoing texts as the modem currently has it: 0 = GSM alphabet, 8 = UCS2 (set at start-up). */
  let encoding: 0 | 8 = 0;
  /** The send in progress (or the last one): the next send waits for it. */
  let sending: Promise<void> = Promise.resolve();
  let reportHandler: (report: DeliveryReport) => void = () => {};
  /** SIM indexes being handed over right now: a second path (a sweep, a repeated notice) must not do it twice. */
  const handling = new Set<number>();

  /**
   * After a timeout or an unplug we cannot know which answer belongs to which command any more.
   * So everything fails, and the owner reconnects and starts over from `AT`.
   */
  const fatal = (error: Error) => {
    if (dead) return;
    dead = error;
    if (current) clearTimeout(current.timer);
    for (const job of [current, ...queue]) job?.reject(error);
    current = null;
    queue.length = 0;
    try {
      link.close();
    } catch {
      // already gone
    }
    fatalHandler(error);
  };

  const startNext = () => {
    if (current || queue.length === 0) return;
    const job = (current = queue.shift()!);
    job.timer = setTimeout(
      () => fatal(new ModemError(`The modem did not answer ${job.command.split("=")[0]} within ${job.timeoutMs} ms`)),
      job.timeoutMs,
    );
    link.write(`${job.command}\r`);
  };

  const finish = (error?: Error) => {
    const job = current!;
    clearTimeout(job.timer);
    current = null;
    if (error) job.reject(error);
    else job.resolve(job.lines);
    startNext();
  };

  const onLine = (line: string) => {
    const announced = NEW_MESSAGE.exec(line);
    if (announced) {
      void collect(Number(announced[1])).catch((error) => console.error("[modem] could not read message", error));
      return;
    }
    const delivery = DELIVERY_REPORT.exec(line);
    if (delivery) {
      // 3GPP TS 23.040: 0-31 delivered, 32-63 the network is still trying, 64 and above failed for good.
      const status = Number(delivery[2]);
      if (status < 32) reportHandler({ ref: Number(delivery[1]), status: "delivered" });
      else if (status >= 64) reportHandler({ ref: Number(delivery[1]), status: "failed" });
      return;
    }
    if (!current || line === "" || line === current.command) return; // blank, or the modem echoing our command
    if (line === "OK") return finish();
    if (FINAL_ERROR.test(line)) return finish(new ModemError(line));
    current.lines.push(line);
  };

  link.onData((chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r\n|\r|\n/);
    buffer = lines.pop() ?? ""; // an unfinished line waits for the rest
    lines.forEach(onLine);
    // The `> ` prompt that invites the text of an SMS has no line ending.
    if (current?.payload !== undefined && !current.payloadSent && buffer.endsWith("> ")) {
      current.payloadSent = true;
      buffer = "";
      link.write(current.payload);
    }
  });

  /** One command at a time, in order: a serial line has no way to tell two answers apart. */
  const exec = (command: string, payload?: string) =>
    new Promise<string[]>((resolve, reject) => {
      if (dead) return reject(new ModemError(`The modem connection is down (${dead.message})`));
      const timeoutMs = command.startsWith("AT+CMGS") ? sendTimeoutMs : commandTimeoutMs;
      queue.push({ command, payload, timeoutMs, lines: [], resolve, reject });
      startNext();
    });

  link.onClose((error) => fatal(error ?? new ModemError("The modem link closed")));

  /** Reads the message at `index`, hands it over, and only then deletes it: a failed hand-over leaves it on the SIM. */
  async function collect(index: number) {
    const lines = await exec(`AT+CMGR=${index}`);
    const header = MESSAGE_HEADER.exec(lines[0] ?? "");
    if (!header) throw new Error(`Unreadable message at index ${index}: ${lines[0] ?? "(empty)"}`);
    await deliver(index, header[1]!, lines.slice(1), header[2]!);
  }

  /** Hands a stored message over, and only then deletes it. */
  async function deliver(index: number, senderHex: string, bodyLines: string[], stamp: string) {
    if (handling.has(index)) return; // this very message is already being handled
    handling.add(index);
    try {
      await messageHandler({
        from: fromUcs2Hex(senderHex),
        body: fromUcs2Hex(bodyLines.join("")),
        receivedAt: parseModemTimestamp(stamp) ?? new Date(),
      });
      await exec(`AT+CMGD=${index}`);
    } finally {
      handling.delete(index);
    }
  }

  /**
   * Everything still on the SIM was never confirmed as handed over (we delete after each hand-over), so it is
   * offered again. "ALL" rather than "REC UNREAD": listing marks messages as read, and one whose hand-over failed
   * must come back next time.
   */
  async function sweep() {
    const stored: { index: number; status: string; sender: string; stamp: string; body: string[] }[] = [];
    for (const line of await exec('AT+CMGL="ALL"')) {
      const header = LISTED_HEADER.exec(line);
      if (header) stored.push({ index: Number(header[1]), status: header[2]!, sender: header[3]!, stamp: header[4]!, body: [] });
      else stored.at(-1)?.body.push(line);
    }
    for (const message of stored) {
      if (!message.status.startsWith("REC")) continue;
      // One message the server would not take must not hold back the others: it simply stays on the SIM.
      await deliver(message.index, message.sender, message.body, message.stamp).catch((error) => {
        if (dead) throw error; // a dead connection is not "one bad message"
        console.error(`[modem] message ${message.index} not handed over, left on the SIM`, error);
      });
    }
  }

  return {
    onMessage(handler) {
      messageHandler = handler;
    },
    onDeliveryReport(handler) {
      reportHandler = handler;
    },
    sweep,
    onFatal(handler) {
      fatalHandler = handler;
    },
    send(to, body) {
      const wanted = isGsm7(body) ? 0 : 8;
      const size = wanted === 0 ? [...body].reduce((n, char) => n + (GSM_EXTENDED.includes(char) ? 2 : 1), 0) : body.length;
      if (size > (wanted === 0 ? MAX_GSM_SEPTETS : MAX_UCS2_UNITS)) {
        return Promise.reject(
          new SmsTooLongError(`Text too long for one SMS: ${size} > ${wanted === 0 ? MAX_GSM_SEPTETS : MAX_UCS2_UNITS}`),
        );
      }
      // Setting the encoding and sending are two commands that must stay together: one send at a time.
      const turn = sending.then(async () => {
        if (wanted !== encoding) {
          await exec(`AT+CSMP=49,167,0,${wanted}`);
          encoding = wanted;
        }
        const lines = await exec(`AT+CMGS="${toUcs2Hex(to)}"`, `${toUcs2Hex(body)}\x1a`); // Ctrl-Z ends the text
        const ref = /^\+CMGS: (\d+)$/.exec(lines.find((line) => line.startsWith("+CMGS:")) ?? "");
        if (!ref) throw new ModemError("The modem accepted the text but gave no reference");
        return { ref: Number(ref[1]) };
      });
      sending = turn.then(
        () => undefined,
        () => undefined,
      );
      return turn;
    },
    async init() {
      await exec("AT");
      await exec("ATE0");
      await exec("AT+CMGF=1");
      await exec('AT+CSCS="UCS2"');
      await exec("AT+CNMI=2,1,0,1,0");
      await exec('AT+CPMS="SM","SM","SM"');
      await exec("AT+CSMP=49,167,0,0");
      await sweep();
    },
  };
}
