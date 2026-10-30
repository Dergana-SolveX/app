import type { ChipCommand } from "../schemas/chip";

const encoder = new TextEncoder();
async function importKey(key: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signDevicePayload(key: Uint8Array<ArrayBuffer>, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await importKey(key), encoder.encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function verifyDevicePayload(key: Uint8Array<ArrayBuffer>, payload: string, signature: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const bytes = Uint8Array.from(signature.match(/../g)!, (byte) => parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", await importKey(key), bytes, encoder.encode(payload));
}
/** JSON tuple prevents ambiguity in arguments; device ID binds the command to its recipient. */
export function commandPayload(deviceId: string, command: Pick<ChipCommand, "seq" | "cmd" | "args">): string {
  return JSON.stringify([deviceId, command.seq, command.cmd, command.args]);
}
