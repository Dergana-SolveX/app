/** Hex UCS2 (what the modem speaks once `AT+CSCS="UCS2"` is set) to text. */
export function fromUcs2Hex(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  if (!/^([0-9A-Fa-f]{4})*$/.test(clean)) throw new Error(`Not UCS2 hex: ${JSON.stringify(hex.slice(0, 40))}`);
  let text = "";
  for (let at = 0; at < clean.length; at += 4) text += String.fromCharCode(parseInt(clean.slice(at, at + 4), 16));
  return text;
}

/** `26/10/30,12:00:00+04` (local time, offset in quarter-hours) to a date. */
export function parseModemTimestamp(stamp: string): Date | null {
  const match = /^(\d\d)\/(\d\d)\/(\d\d),(\d\d):(\d\d):(\d\d)([+-])(\d\d)$/.exec(stamp);
  if (!match) return null;
  const [, yy, mo, dd, hh, mi, ss, sign, quarters] = match;
  const local = Date.UTC(2000 + Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
  const offsetMs = (sign === "-" ? -1 : 1) * Number(quarters) * 15 * 60_000;
  return new Date(local - offsetMs);
}

/** Text to the hex UCS2 the modem expects once `AT+CSCS="UCS2"` is set. */
export function toUcs2Hex(text: string): string {
  let hex = "";
  for (let at = 0; at < text.length; at++) hex += text.charCodeAt(at).toString(16).toUpperCase().padStart(4, "0");
  return hex;
}

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** Reachable through an escape: each counts for two characters of the 160. */
const GSM_EXTENDED = "^{}\[~]|€\f";

/** Can the text be sent in the 7-bit GSM alphabet (160 characters), or does it need UCS2 (70)? */
export function isGsm7(text: string): boolean {
  return [...text].every((char) => GSM_BASIC.includes(char) || GSM_EXTENDED.includes(char));
}
