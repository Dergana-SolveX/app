const encoder = new TextEncoder();
const SALT = "svx-device-v1";

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Per-device HMAC key = HKDF-SHA256(master, salt "svx-device-v1", info deviceId), 32 bytes. Never stored. */
export async function deriveDeviceKey(
  masterSecret: string,
  deviceId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const ikm = await crypto.subtle.importKey("raw", encoder.encode(masterSecret), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(SALT), info: encoder.encode(deviceId) },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

/** Provisioning check stored in `vehicles.device_secret_hash`: SHA-256 hex of the derived key. */
export async function deviceKeyCheck(key: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", key));
}
