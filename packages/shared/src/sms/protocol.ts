import { crc8Hex } from "./crc8";

export type SvxCell = { mcc: number; mnc: number; lac: number; cid: number };

/** An alert as carried by an SVX v1 SMS. `null` means "not reported" (key omitted on the wire). */
export type SvxAlert = {
  /** 1 = IoT chip, 2 = phone app, 3 = USSD-originated relay. */
  layer: 1 | 2 | 3;
  /** Geohash precision 8, or null when the position is unknown. */
  geohash: string | null;
  /** Event time as minutes since the Unix epoch. */
  eventMinutes: number;
  peakG: number | null;
  rollover: boolean | null;
  fire: boolean | null;
  /** 0 to 9, where 9 means 9 or more. */
  victims: number | null;
  /** 0 = no, 1 = yes, 2 = unknown. */
  conscious: 0 | 1 | 2 | null;
  trapped: boolean | null;
  bleeding: boolean | null;
  /** Profile short code (8 characters). */
  profileCode: string | null;
  deltaVKmh: number | null;
  cell: SvxCell | null;
};

const flag = (b: boolean) => (b ? "1" : "0");
const hex = (n: number) => n.toString(16).toUpperCase();

/** One SMS segment of GSM-7 text. */
export const MAX_SMS_LENGTH = 160;

/** When a message is too long, optional fields are dropped in this order (least important first). */
const DROP_ORDER = ["CI", "DV", "G", "UID", "B", "TR", "R"] as const;

/** Precision-8 geohash alphabet (no a, i, l, o). */
const GEOHASH = /^[0-9b-hjkmnp-z]{8}$/;
/** Profile short code: 8 uppercase letters or digits. */
const PROFILE_CODE = /^[0-9A-Z]{8}$/;

const CK_LENGTH = "#CK:".length + 2;
const SIGNATURE_CHARS = 6;
const H_LENGTH = "#H:".length + SIGNATURE_CHARS;

export type EncodeOptions = {
  /** Default 160. Optional fields are dropped until the message fits. */
  maxLength?: number;
};

export type SignedEncodeOptions = EncodeOptions & {
  /** The derived per-device key (see `deriveDeviceKey`). Adds the `H` field. */
  deviceKey: Uint8Array<ArrayBuffer>;
};

/** The body (everything before `#H:` and `#CK:`), with optional fields dropped until it fits. */
function fitBody(alert: SvxAlert, maxLength: number, reserved: number): string {
  if (alert.geohash !== null && !GEOHASH.test(alert.geohash)) {
    throw new TypeError(`geohash must be 8 geohash characters, got "${alert.geohash}"`);
  }
  if (alert.profileCode !== null && !PROFILE_CODE.test(alert.profileCode)) {
    throw new TypeError(`profile code must be 8 uppercase letters or digits, got "${alert.profileCode}"`);
  }
  for (const [name, value] of [
    ["peakG", alert.peakG],
    ["victims", alert.victims],
    ["deltaVKmh", alert.deltaVKmh],
  ] as const) {
    if (value !== null && !Number.isFinite(value)) throw new RangeError(`${name} must be a finite number`);
  }
  if (!Number.isInteger(alert.eventMinutes) || alert.eventMinutes < 0) {
    throw new RangeError(`event time must be a non-negative whole number of minutes`);
  }

  // Insertion order is the wire order.
  const fields = new Map<string, string>();
  fields.set("L", `${alert.layer}`);
  fields.set("GH", alert.geohash ?? "");
  fields.set("T", alert.eventMinutes.toString(36));
  if (alert.peakG !== null) fields.set("G", Math.max(0, alert.peakG).toFixed(1));
  if (alert.rollover !== null) fields.set("R", flag(alert.rollover));
  if (alert.fire !== null) fields.set("FIRE", flag(alert.fire));
  if (alert.victims !== null) fields.set("V", `${Math.min(9, Math.max(0, Math.round(alert.victims)))}`);
  if (alert.conscious !== null) fields.set("C", `${alert.conscious}`);
  if (alert.trapped !== null) fields.set("TR", flag(alert.trapped));
  if (alert.bleeding !== null) fields.set("B", flag(alert.bleeding));
  if (alert.profileCode !== null) fields.set("UID", alert.profileCode);
  if (alert.deltaVKmh !== null) fields.set("DV", `${Math.max(0, Math.round(alert.deltaVKmh))}`);
  if (alert.cell !== null) {
    const { mcc, mnc, lac, cid } = alert.cell;
    fields.set("CI", `${hex(mcc)}-${hex(mnc)}-${hex(lac)}-${hex(cid)}`);
  }

  const body = () => ["SVX1", ...[...fields].map(([k, v]) => `${k}:${v}`)].join("#");
  const total = () => body().length + reserved + CK_LENGTH;

  for (const key of DROP_ORDER) {
    if (total() <= maxLength) break;
    fields.delete(key);
  }
  if (total() > maxLength) {
    throw new RangeError(`SVX message is ${total()} characters, over the limit of ${maxLength}`);
  }
  return body();
}

/**
 * Encodes an alert as `SVX1#…#CK:xx`. With a `deviceKey` it also adds the `H` signature
 * and returns a Promise (Web Crypto is async).
 * Throws a RangeError if even the essential fields (L, GH, T, FIRE, V, C) do not fit.
 */
export function encodeSvx(alert: SvxAlert, options?: EncodeOptions): string;
export function encodeSvx(alert: SvxAlert, options: SignedEncodeOptions): Promise<string>;
export function encodeSvx(
  alert: SvxAlert,
  options: EncodeOptions | SignedEncodeOptions = {},
): string | Promise<string> {
  const maxLength = options.maxLength ?? MAX_SMS_LENGTH;
  const deviceKey = (options as SignedEncodeOptions).deviceKey;
  if (deviceKey !== undefined) {
    const body = fitBody(alert, maxLength, H_LENGTH);
    return signature(deviceKey, body).then((h) => {
      const signed = `${body}#H:${h}`;
      return `${signed}#CK:${crc8Hex(signed)}`;
    });
  }
  const body = fitBody(alert, maxLength, 0);
  return `${body}#CK:${crc8Hex(body)}`;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** First `SIGNATURE_CHARS` characters of the RFC 4648 base32 of HMAC-SHA256(key, message). */
async function signature(key: Uint8Array<ArrayBuffer>, message: string): Promise<string> {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(message)),
  );
  let bits = "";
  for (const byte of mac.slice(0, 4)) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < SIGNATURE_CHARS; i++) out += BASE32[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return out;
}

/** True when the message carries an `H` field that matches the device key. Never throws. */
export async function verifySvx(sms: string, deviceKey: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const at = sms.indexOf("#H:");
  if (at < 0) return false;
  const given = sms.slice(at + 3, at + 3 + SIGNATURE_CHARS);
  try {
    const expected = await signature(deviceKey, sms.slice(0, at));
    if (given.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  } catch {
    return false; // e.g. an empty or unusable key
  }
}

export type DecodedSvxAlert = { [K in keyof SvxAlert]: SvxAlert[K] | null };

export type DecodedSvx = {
  /** True when the text starts with the `SVX1` magic. */
  recognized: boolean;
  /** True when `CK` matches the CRC-8 of everything before `#CK:`. */
  crcValid: boolean;
  alert: DecodedSvxAlert;
  parseErrors: string[];
};

const emptyAlert = (): DecodedSvxAlert => ({
  layer: null,
  geohash: null,
  eventMinutes: null,
  peakG: null,
  rollover: null,
  fire: null,
  victims: null,
  conscious: null,
  trapped: null,
  bleeding: null,
  profileCode: null,
  deltaVKmh: null,
  cell: null,
});


/** One validated parser per key. Returns false (and leaves the field null) on an invalid value. */
const FIELD_PARSERS: Record<string, (raw: string, alert: DecodedSvxAlert) => boolean> = {
  L: (raw, a) => /^[123]$/.test(raw) && ((a.layer = Number(raw) as 1 | 2 | 3), true),
  GH: (raw, a) => raw === "" || (GEOHASH.test(raw) && ((a.geohash = raw), true)),
  T: (raw, a) => /^[0-9a-z]{1,10}$/.test(raw) && ((a.eventMinutes = parseInt(raw, 36)), true),
  G: (raw, a) => /^\d+(\.\d+)?$/.test(raw) && ((a.peakG = Number(raw)), true),
  R: (raw, a) => /^[01]$/.test(raw) && ((a.rollover = raw === "1"), true),
  FIRE: (raw, a) => /^[01]$/.test(raw) && ((a.fire = raw === "1"), true),
  V: (raw, a) => /^[0-9]$/.test(raw) && ((a.victims = Number(raw)), true),
  C: (raw, a) => /^[012]$/.test(raw) && ((a.conscious = Number(raw) as 0 | 1 | 2), true),
  TR: (raw, a) => /^[01]$/.test(raw) && ((a.trapped = raw === "1"), true),
  B: (raw, a) => /^[01]$/.test(raw) && ((a.bleeding = raw === "1"), true),
  UID: (raw, a) => PROFILE_CODE.test(raw) && ((a.profileCode = raw), true),
  DV: (raw, a) => /^\d+$/.test(raw) && ((a.deltaVKmh = Number(raw)), true),
  CI: (raw, a) => {
    const m = /^([0-9A-F]+)-([0-9A-F]+)-([0-9A-F]+)-([0-9A-F]+)$/.exec(raw);
    if (!m) return false;
    const [mcc, mnc, lac, cid] = m.slice(1).map((h) => parseInt(h, 16)) as [number, number, number, number];
    a.cell = { mcc, mnc, lac, cid };
    return true;
  },
};

/** Decodes an SMS. Never throws: whatever can be read is returned, the rest is null. */
export function decodeSvx(sms: string): DecodedSvx {
  const alert = emptyAlert();
  if (!/^SVX1(#|$)/.test(sms)) {
    return { recognized: false, crcValid: false, alert, parseErrors: ["not_svx"] };
  }
  const fields = new Map<string, string>();
  for (const token of sms.split("#").slice(1)) {
    const colon = token.indexOf(":");
    if (colon > 0) fields.set(token.slice(0, colon), token.slice(colon + 1));
  }

  const ckAt = sms.lastIndexOf("#CK:");
  const crcValid = ckAt >= 0 && crc8Hex(sms.slice(0, ckAt)) === fields.get("CK");
  const parseErrors: string[] = [];
  if (ckAt < 0) parseErrors.push("missing_crc");
  else if (!crcValid) parseErrors.push("bad_crc");

  for (const [key, raw] of fields) {
    // Own properties only: a wire key such as "__proto__" or "constructor" must not hit Object.prototype.
    if (!Object.prototype.hasOwnProperty.call(FIELD_PARSERS, key)) continue; // unknown keys are ignored
    const parse = FIELD_PARSERS[key]!;
    if (!parse(raw, alert)) parseErrors.push(`invalid_${key}`);
  }

  return { recognized: true, crcValid, alert, parseErrors };
}
