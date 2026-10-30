import { describe, expect, it } from "vitest";

import { WITNESS_TEXT } from "./i18n";

describe("Witness i18n dictionary", () => {
  it("provides complete French and Arabic strings for all steps", () => {
    expect(WITNESS_TEXT.fr.title).toBeDefined();
    expect(WITNESS_TEXT.ar.title).toBeDefined();

    expect(WITNESS_TEXT.fr.step1_title).toContain("victime");
    expect(WITNESS_TEXT.ar.step1_title).toContain("الضحايا");

    expect(WITNESS_TEXT.fr.step2_title).toContain("conscient");
    expect(WITNESS_TEXT.ar.step2_title).toContain("واعون");

    expect(WITNESS_TEXT.fr.step3_title).toContain("Danger");
    expect(WITNESS_TEXT.ar.step3_title).toContain("أخطار");

    expect(WITNESS_TEXT.fr.gps_timeout_prompt).toContain("Où êtes-vous");
    expect(WITNESS_TEXT.ar.gps_timeout_prompt).toContain("أين أنتم");
  });
});
