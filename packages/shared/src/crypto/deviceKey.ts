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

/** Signs body with HMAC-SHA256(deviceKey, body), returning a 64-char lowercase hex string. */
export async function signDevicePayload(
  key: Uint8Array<ArrayBuffer>,
  body: string,
): Promise<string> {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(body));
  return toHex(sig);
}

/** Verifies that signature matches HMAC-SHA256(deviceKey, body). Timing-safe, case-insensitive. */
export async function verifyDevicePayload(
  key: Uint8Array<ArrayBuffer>,
  body: string,
  signature: string,
): Promise<boolean> {
  if (typeof signature !== "string" || signature.length !== 64) return false;
  try {
    const expected = await signDevicePayload(key, body);
    const given = signature.toLowerCase();
    let diff = 0;
    for (let i = 0; i < 64; i++) {
      diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}
