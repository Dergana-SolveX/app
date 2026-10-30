import type { Step } from "./replay-link";

/**
 * HONESTY NOTE: these transcripts are written from the response formats documented in the SIMCom SIM7600 AT
 * command manual (text mode, UCS2 charset). They were NOT captured from a real modem yet. They prove the driver
 * follows the documented protocol; only a capture from the real dongle proves our modem behaves like the manual.
 * To replace one with a real capture: log the serial traffic of a session and paste it here step by step.
 */

export const OK = "\r\nOK\r\n";

/** Hex UCS2 of a string, written out here on purpose: expected values must not come from the code under test. */
export const HEX = {
  plus213550000001: "002B003200310033003500350030003000300030003000300031",
  plus213550000002: "002B003200310033003500350030003000300030003000300032",
  /** حادث (the Arabic ACCIDENT keyword) */
  hadith: "062D0627062F062B",
  /** ACCIDENT */
  accident: "004100430043004900440045004E0054",
  /** SVXACK#AB12CD34 */
  ack: "00530056005800410043004B002300410042003100320043004400330034",
};

/** The start-up conversation: wake the modem, set modes, then look for messages left on the SIM. */
export const initSteps = (stored: string = OK): Step[] => [
  { host: "AT\r", modem: "AT\r\r\nOK\r\n" }, // the modem echoes until it is told not to
  { host: "ATE0\r", modem: "ATE0\r\r\nOK\r\n" },
  { host: "AT+CMGF=1\r", modem: OK },
  { host: 'AT+CSCS="UCS2"\r', modem: OK },
  { host: "AT+CNMI=2,1,0,1,0\r", modem: OK },
  { host: 'AT+CPMS="SM","SM","SM"\r', modem: "\r\n+CPMS: 0,30,0,30,0,30\r\n" + OK },
  { host: "AT+CSMP=49,167,0,0\r", modem: OK },
  { host: 'AT+CMGL="ALL"\r', modem: stored },
];
