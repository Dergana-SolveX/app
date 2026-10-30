import { describe, expect, it } from "vitest";

import { toGsm7 } from "./gsm7";

describe("toGsm7", () => {
  it("keeps plain text and the accents the alphabet has", () => {
    expect(toGsm7("Hôpital: réanimation à Alger")).toBe("Hopital: réanimation à Alger");
    // The capital Ç is in the alphabet, the small ç is not.
    expect(toGsm7("Ça ça")).toBe("Ça ca");
  });

  it("replaces typographic characters by their plain look-alikes", () => {
    expect(toGsm7("O− ’a’ « b » – c … 2 × 3 90°")).toBe("O- 'a' \" b \" - c ... 2 x 3 90o");
  });

  it("drops the accents the alphabet lacks, and writes oe for the ligature", () => {
    expect(toGsm7("être cœur Ôte naïf")).toBe("etre coeur Ote naif");
  });

  it("turns what it cannot write into a question mark, one for each character", () => {
    expect(toGsm7("ok 😀 日本")).toBe("ok ? ??");
  });

  it("avoids the characters that count double in an SMS", () => {
    expect(toGsm7("a|b ^ { } [ ] ~ \\ €")).not.toMatch(/[|^{}[\]~\\€]/);
  });

  it("leaves an empty text empty", () => {
    expect(toGsm7("")).toBe("");
  });
});
