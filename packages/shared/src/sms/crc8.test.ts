import { describe, expect, it } from "vitest";

import { crc8, crc8Hex } from "./crc8";

describe("crc8 (CRC-8/SMBUS: poly 0x07, init 0x00)", () => {
  it("matches the standard catalogue check value for '123456789'", () => {
    // 0xF4 is the published check value of CRC-8/SMBUS (reveng catalogue).
    expect(crc8("123456789")).toBe(0xf4);
  });

  it("is 0 for the empty string (init value, no input)", () => {
    expect(crc8("")).toBe(0x00);
  });

  it("changes when a single character changes", () => {
    expect(crc8("SVX1#L:2")).not.toBe(crc8("SVX1#L:3"));
  });
});

describe("crc8Hex", () => {
  it("writes 2 uppercase hex characters, zero padded", () => {
    expect(crc8Hex("123456789")).toBe("F4");
    expect(crc8Hex("")).toBe("00");
  });
});
