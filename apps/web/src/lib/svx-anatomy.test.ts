import { describe, expect, it } from "vitest";

import { explainSvx } from "./svx-anatomy";

// A real chip message, written by encodeSvx for a frontal crash.
const SMS = "SVX1#L:1#GH:snd2bmtf#T:hsmn0#G:31.5#R:0#FIRE:0#DV:64#H:R4YNWU#CK:45";

describe("explainSvx: the anatomy of an SVX message, field by field", () => {
  const { fields, length, limit } = explainSvx(SMS);

  it("splits the message into its fields, in order", () => {
    expect(fields.map((f) => f.key)).toEqual(["SVX1", "L", "GH", "T", "G", "R", "FIRE", "DV", "H", "CK"]);
    expect(fields.map((f) => f.value)).toEqual(["", "1", "snd2bmtf", "hsmn0", "31.5", "0", "0", "64", "R4YNWU", "45"]);
  });

  it("counts the characters against the 160 of one SMS", () => {
    expect(length).toBe(SMS.length);
    expect(limit).toBe(160);
  });

  it("says in French what each field means", () => {
    const meaning = (key: string) => fields.find((f) => f.key === key)!.meaning;
    expect(meaning("L")).toBe("puce embarquée");
    expect(meaning("G")).toBe("31.5 g");
    expect(meaning("DV")).toBe("64 km/h");
    expect(meaning("R")).toBe("non");
    expect(meaning("FIRE")).toBe("non");
    expect(meaning("H")).toBe("signature HMAC de la puce");
    expect(meaning("CK")).toBe("somme de contrôle CRC-8");
  });

  it("reads the time: minutes since 1970 in base 36, shown as the Algiers clock", () => {
    // hsmn0 (base 36) = 29 889 180 minutes = 09:00 UTC = 10:00 in Algiers (UTC+1).
    expect(fields.find((f) => f.key === "T")!.meaning).toBe("10:00 (Alger)");
  });

  it("gives each field a kind, so a screen can colour them by role", () => {
    const kind = (key: string) => fields.find((f) => f.key === key)!.kind;
    expect(kind("SVX1")).toBe("header");
    expect(kind("GH")).toBe("where");
    expect(kind("T")).toBe("when");
    expect(kind("G")).toBe("severity");
    expect(kind("H")).toBe("proof");
    expect(kind("CK")).toBe("proof");
  });

  it("shows a fire, a rollover and a trapped victim as yes", () => {
    const flags = explainSvx("SVX1#L:1#R:1#FIRE:1#TR:1#CK:00").fields;
    expect(flags.filter((f) => ["R", "FIRE", "TR"].includes(f.key)).map((f) => f.meaning)).toEqual(["oui", "oui", "oui"]);
  });

  it("keeps a field it does not know, plainly marked", () => {
    const unknown = explainSvx("SVX1#ZZ:9#CK:00").fields.find((f) => f.key === "ZZ")!;
    expect(unknown).toMatchObject({ value: "9", meaning: "champ inconnu", kind: "other" });
  });

  it("handles an empty message", () => {
    expect(explainSvx("")).toEqual({ fields: [], length: 0, limit: 160 });
  });
});
