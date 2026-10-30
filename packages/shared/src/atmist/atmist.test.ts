import { describe, expect, it } from "vitest";

import { assessVictim } from "../clinical/assess";
import { buildAtMist, renderAtMistSms, type AtMistInput } from "./atmist";

const NOW = new Date("2026-10-30T12:00:00Z");
const vitals = { gcs: 12, hr: 130, sbp: 85, dbp: 50, spo2: 92, rr: 24 };

function input(over: Partial<AtMistInput> = {}): AtMistInput {
  const assessed = assessVictim({
    now: NOW,
    sensors: { l2: { rollover: { value: true, source: "iot" } } },
    profile: null,
    estAge: 76,
    vitals,
  });
  return {
    incidentAt: "2026-10-30T09:02:00Z", // 10:02 in Algiers (UTC+1)
    unit: "AMB-1",
    victimIndex: 1,
    etaMin: 12.4,
    age: 76,
    sex: "male",
    vittel: assessed.vittel,
    injuries: ["Thorax", "Bassin"],
    treatments: ["Oxygène"],
    vitals,
    shockIndex: assessed.shockIndex,
    needs: ["trauma_surgery", "icu", "blood_bank"],
    profile: null,
    ...over,
  };
}

describe("buildAtMist (PRD FR-S2-29): the structured handover", () => {
  it("fills each part of AT-MIST: age and sex, time, mechanism, injuries, signs, treatment", () => {
    const atmist = buildAtMist(input());
    expect(atmist).toMatchObject({
      unit: "AMB-1",
      victimIndex: 1,
      age: 76,
      sex: "male",
      time: "10:02",
      mechanism: ["Tonneaux"],
      injuries: ["Thorax", "Bassin"],
      treatments: ["Oxygène"],
      severe: true,
      etaMin: 12,
      signs: { gcs: 12, hr: 130, sbp: 85, dbp: 50, spo2: 92, rr: 24 },
    });
    expect(atmist.signs.shockIndex).toMatchObject({ value: 1.53, flag: "critical" });
  });

  it("adds the positive Vittel anatomical findings to the injuries, without repeating the same words", () => {
    const withVittel = assessVictim({
      now: NOW, estAge: 40,
      medic: { l3: { flailChest: { value: true, source: "medic" }, pelvicFracture: { value: true, source: "medic" } } },
    });
    const atmist = buildAtMist(input({ vittel: withVittel.vittel, injuries: ["Thorax"] }));
    expect(atmist.injuries).toEqual(["Thorax", "Volet thoracique", "Fracture du bassin"]);
  });

  it("asks the hospital to prepare what the needs and the profile call for", () => {
    const atmist = buildAtMist(
      input({
        needs: ["ct_scanner", "blood_bank", "icu"],
        profile: { bloodType: "A+", allergies: ["pénicilline"], medications: [{ name: "Sintrom", class: "anticoagulant" }] },
      }),
    );
    expect(atmist.prep).toEqual([
      "scanner",
      "lit de réanimation",
      "bilan de coagulation / antidote",
      "préparer culots A+ / O−",
    ]);
    expect(atmist.allergies).toEqual(["pénicilline"]);
    expect(atmist.bloodType).toBe("A+");
  });

  it("asks for universal O- blood when blood is needed and no blood type is known", () => {
    expect(buildAtMist(input({ needs: ["blood_bank"], profile: null })).prep).toEqual(["culots O−"]);
    expect(buildAtMist(input({ needs: ["blood_bank"], profile: { bloodType: "B+", allergies: [], medications: [] } })).prep).toEqual([
      "préparer culots B+ / O−",
    ]);
  });

  it("never carries a name, a contact or a profile code (data minimisation)", () => {
    const profile = {
      bloodType: "O-", allergies: [], medications: [],
      fullName: "Karim Test", emergencyContact: "0555 12 34 56", shortCode: "AB12CD34", birthDate: "1950-01-01",
    } as unknown as NonNullable<AtMistInput["profile"]>;
    const json = JSON.stringify(buildAtMist(input({ profile })));
    for (const secret of ["Karim", "0555", "AB12CD34", "1950"]) expect(json).not.toContain(secret);
  });

  it("is honest about what is not known: no age, no sex, no measures", () => {
    const atmist = buildAtMist(input({ age: null, sex: null, vitals: {}, shockIndex: null, etaMin: null, injuries: [] }));
    expect(atmist).toMatchObject({ age: null, sex: null, etaMin: null, signs: { gcs: null, hr: null, sbp: null, shockIndex: null } });
  });
});

describe("renderAtMistSms: at most 3 SMS segments of plain GSM-7 text", () => {
  const SEGMENT = 153; // a segment of a long SMS carries 153 characters
  const full = () => buildAtMist(input({ profile: { bloodType: "A+", allergies: ["pénicilline"], medications: [] }, needs: ["ct_scanner", "icu"] }));

  it("writes the handover on one readable line, a worked example", () => {
    expect(renderAtMistSms(full())).toBe(
      "AT-MIST AMB-1 V1 ; A:76a H ; T:10:02 ; M:Tonneaux ; I:Thorax, Bassin ; S:FC130 PAS85/50 SpO2 92 FR24 GCS12 IC1,53 CRITIQUE ; TX:Oxygène ; ETA:12min ; PREP:scanner, lit de réanimation, préparer culots A+ / O- ; GS:A+ ; ALLERG:pénicilline ; GRAVE (Vittel)",
    );
  });

  it("uses only characters of the basic GSM-7 alphabet (accents it has, no minus sign or curly quotes)", () => {
    const text = renderAtMistSms(buildAtMist(input({ treatments: ["Voie veineuse ’gros calibre’ – 2 × 500 ml"] })));
    expect(text).toMatch(/^[A-Za-z0-9 @£$¥èéùìòÇØøÅåÆæßÉÄÖÑÜäöñüà!"#%&'()*+,\-./:;<=>?¡§¿\n_|]*$/);
    expect(text).not.toContain("−");
    expect(text).not.toContain("’");
  });

  it("stays within 3 segments however long the inputs are, dropping the optional parts first and keeping the vital ones", () => {
    const long = Array.from({ length: 60 }, (_, i) => `lésion numéro ${i}`);
    const huge = buildAtMist(
      input({
        injuries: long, treatments: long, profile: { bloodType: "AB-", allergies: long, medications: [] },
        needs: ["neurosurgery", "ct_scanner", "icu", "trauma_surgery", "blood_bank", "burn_unit", "obstetrics", "pediatric"],
      }),
    );
    const text = renderAtMistSms(huge);
    expect(text.length).toBeLessThanOrEqual(3 * SEGMENT);
    for (const kept of ["AT-MIST AMB-1 V1", "A:76a H", "T:10:02", "FC130", "PAS85", "ETA:12min", "GRAVE"]) expect(text).toContain(kept);
  });

  it("still never exceeds 3 segments when a part that is always kept is absurdly long", () => {
    const text = renderAtMistSms(buildAtMist(input({ unit: "AMB-" + "X".repeat(900) })));
    expect(text.length).toBeLessThanOrEqual(3 * SEGMENT);
  });

  it("is a single segment of 160 characters or less for a short handover", () => {
    const short = buildAtMist(input({ injuries: [], treatments: [], needs: [], profile: null }));
    expect(renderAtMistSms(short).length).toBeLessThanOrEqual(160);
  });

  it("leaves out what is not known instead of writing blanks", () => {
    const text = renderAtMistSms(buildAtMist(input({ age: null, sex: null, vitals: {}, shockIndex: null, etaMin: null, injuries: [], treatments: [], needs: [] })));
    expect(text).not.toMatch(/null|undefined|NaN|A:|ETA|S:/);
  });
});
