/** The basic GSM-7 alphabet, minus the "extension" characters (^ { } \ [ ~ ] | €) that cost two characters each. */
const BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

const TRANSLITERATE: Record<string, string> = {
  "−": "-", "–": "-", "—": "-", "‐": "-",
  "’": "'", "‘": "'", "“": '"', "”": '"', "«": '"', "»": '"',
  "×": "x", "…": "...", "°": "o", " ": " ", " ": " ",
  œ: "oe", Œ: "OE",
};

/**
 * Text that fits the basic GSM-7 alphabet, so an SMS stays at 160 characters (153 per part of a long one)
 * instead of falling back to 70. Accents the alphabet has are kept; the others lose their accent; what is
 * left becomes "?". Every character of the result counts as exactly one.
 */
export function toGsm7(text: string): string {
  let out = "";
  for (const char of text) {
    if (BASIC.includes(char)) {
      out += char;
      continue;
    }
    const mapped = TRANSLITERATE[char] ?? char.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += [...mapped].every((c) => BASIC.includes(c)) && mapped.length > 0 ? mapped : "?";
  }
  return out;
}
