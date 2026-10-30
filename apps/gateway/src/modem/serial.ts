import { SerialPort } from "serialport";

import type { SerialLink } from "./link";

/**
 * Opens the USB modem's AT-command port. This is the one piece of the gateway that needs real hardware:
 * everything above it is tested on replayed transcripts, this adapter is not (yet).
 */
export function openSerialLink(path: string, baudRate: number): Promise<SerialLink> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path, baudRate, autoOpen: false });
    let onData: (chunk: string) => void = () => {};
    let onClose: (error?: Error) => void = () => {};

    // AT traffic is plain ASCII: text, hex digits and a few control characters.
    port.on("data", (chunk: Buffer) => onData(chunk.toString("latin1")));
    // Unplugging the dongle shows up as an error and/or a close: either way the link is gone.
    port.on("error", (error) => onClose(error));
    port.on("close", () => onClose());

    port.open((error) => {
      if (error) return reject(error);
      resolve({
        // A failed write (the dongle was unplugged mid-command) ends the link at once, instead of waiting for a timeout.
        write: (data) => void port.write(data, "latin1", (error) => error && onClose(error)),
        onData: (handler) => (onData = handler),
        onClose: (handler) => (onClose = handler),
        close: () => {
          if (port.isOpen) port.close();
        },
      });
    });
  });
}
