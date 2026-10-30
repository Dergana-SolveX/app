import type { SerialLink } from "../modem/link";

/**
 * One exchange of a modem transcript.
 * - `{ host, modem }`: the driver must write exactly `host`; the modem then answers `modem`.
 * - `{ modem }` on its own: the modem speaks unprompted (e.g. `+CMTI`), as soon as the exchange before it is done.
 */
export type Step = { host: string; modem: string } | { modem: string };

/**
 * A fake serial link that replays a transcript and fails on the first command that is not the next one in it.
 * Not a stand-in for the modem's logic: it can only say what the transcript says.
 */
export function replayLink(steps: readonly Step[], { chunkSize = Infinity }: { chunkSize?: number } = {}) {
  let next = 0;
  let onData: (chunk: string) => void = () => {};
  let onClose: (error?: Error) => void = () => {};
  let closed = false;
  const written: string[] = [];

  const emit = (text: string) => {
    for (let at = 0; at < text.length; at += chunkSize) onData(text.slice(at, at + chunkSize));
  };
  /** Unprompted modem output sits in the transcript until the exchange before it is finished. */
  const speakUnprompted = () => {
    while (next < steps.length && !("host" in steps[next]!)) emit(steps[next++]!.modem);
  };

  const link: SerialLink = {
    write(data) {
      written.push(data);
      const step = steps[next];
      if (closed) throw new Error("write on a closed link");
      if (!step || !("host" in step) || step.host !== data) {
        throw new Error(
          `Unexpected write ${JSON.stringify(data)}; the transcript expects ${step && "host" in step ? JSON.stringify(step.host) : "nothing from the host here"}`,
        );
      }
      next++;
      // Answered after the write returns, like a real modem.
      queueMicrotask(() => {
        emit(step.modem);
        speakUnprompted();
      });
    },
    onData: (handler) => (onData = handler),
    onClose: (handler) => (onClose = handler),
    close() {
      closed = true;
    },
  };

  // A transcript may start with unprompted output (e.g. a message that arrived while the gateway was down).
  queueMicrotask(speakUnprompted);

  return {
    link,
    /** Everything the driver tried to write, in order (including what the transcript did not expect). */
    written,
    /** What the transcript still expects. Empty when the driver did everything it was supposed to. */
    remaining: () => steps.slice(next),
    /** Whether the code under test closed the link (the serial port is released). */
    isClosed: () => closed,
    /** Simulates unplugging the USB modem. */
    unplug: (error = new Error("USB modem unplugged")) => {
      closed = true;
      onClose(error);
    },
  };
}
