/**
 * The wire to the modem: a serial port in production, a replayed transcript in tests.
 * Data is raw text, exactly as it crosses the wire (chunks may split lines anywhere).
 */
export type SerialLink = {
  write(data: string): void;
  onData(handler: (chunk: string) => void): void;
  /** The USB modem was unplugged or the port failed. */
  onClose(handler: (error?: Error) => void): void;
  close(): void;
};
