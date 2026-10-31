import { describe, expect, it } from "vitest";
import { getLabels, untranslatedKeys } from "./labels";

describe("i18n Labels Dictionary (FR-S2-31, FR-S7-04, NFR-UI3)", () => {
  it("provides French by default and standard Arabic for the victim flow", () => {
    expect(getLabels("fr", "witness").step1_title).toBe("Combien de victimes ?");
    expect(getLabels("ar", "witness").step1_title).toBe("كم عدد الضحايا؟");
  });

  it("provides complete Arabic translations for all required victim app and hospital board scopes", () => {
    const requiredArabicScopes = [
      "witness",
      "hospital",
      "victim",
      "crash",
      "needs",
      "live",
      "shock",
    ] as const;

    const missing = untranslatedKeys();

    for (const scope of requiredArabicScopes) {
      const scopeMissing = missing.filter((k) => k.startsWith(`${scope}.`));
      expect(scopeMissing, `Scope '${scope}' has untranslated Arabic keys`).toEqual([]);
    }
  });

  it("falls back to French when an Arabic key is absent and lists untranslated keys for review", () => {
    // Console is demo/internal only and only has French labels
    expect(getLabels("ar", "console").title).toBe("Console de démonstration");
    const missing = untranslatedKeys();
    expect(missing).toContain("console.title");
    expect(missing).toEqual(["console.title"]);
  });

  it("guarantees no Algerian Darja dialect in the UI (Modern Standard Arabic / Fusha only)", () => {
    const DARJA_FORBIDDEN_WORDS = [
      "شحال", // Darja for "كم"
      "وين", // Darja for "أين"
      "راكم", // Darja for "أنتم"
      "حاب", // Darja for "تريد"
      "واش", // Darja for "ماذا"
      "برك", // Darja for "فقط"
      "بزاف", // Darja for "كثيراً"
      "دوك", // Darja for "الآن"
      "هنايا", // Darja for "هنا"
      "كاش", // Darja for "أي / هل يوجد"
      "ديال", // Darja for "خاص بـ"
      "ياك", // Darja for "أليس كذلك"
      "درك", // Darja for "الآن"
      "ايا", // Darja interjection
      "بصح", // Darja for "لكن"
      "طابلو", // Darja loanword
      "لاباس", // Darja for "بخير" (we use أنا بخير)
      "دير", // Darja for "افعل"
    ];

    const scopes = [
      "witness",
      "hospital",
      "victim",
      "crash",
      "needs",
      "live",
      "shock",
      "navigation",
      "auth",
      "shell",
    ] as const;

    for (const scope of scopes) {
      const labels = getLabels("ar", scope);
      for (const [key, text] of Object.entries(labels)) {
        if (typeof text !== "string") continue;
        for (const darja of DARJA_FORBIDDEN_WORDS) {
          const hasDarja = new RegExp(`(^|[\\s،.!?])${darja}([\\s،.!?]|$)`).test(text);
          expect(
            hasDarja,
            `Forbidden Darja word "${darja}" found in Arabic string for ${scope}.${key}: "${text}"`,
          ).toBe(false);
        }
      }
    }
  });
});

