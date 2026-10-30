import { describe, expect, it } from "vitest";
import {
  formatCellId,
  getOperatorInfo,
  parseCellId,
  validateCellSurvey,
  type CellSurveyInput,
} from "./cell-survey";

describe("Cell Survey Domain Model (FR-S4-08)", () => {
  describe("getOperatorInfo (Algerian Mobile Operators)", () => {
    it("identifies Mobilis (603-01)", () => {
      const op = getOperatorInfo(603, 1);
      expect(op.name).toBe("Mobilis");
      expect(op.brandColor).toBe("#10b981"); // emerald
      expect(op.nameAr).toBe("موبيليس");
    });

    it("identifies Djezzy (603-02)", () => {
      const op = getOperatorInfo(603, 2);
      expect(op.name).toBe("Djezzy");
      expect(op.brandColor).toBe("#ef4444"); // red
      expect(op.nameAr).toBe("جيزي");
    });

    it("identifies Ooredoo (603-03)", () => {
      const op = getOperatorInfo(603, 3);
      expect(op.name).toBe("Ooredoo");
      expect(op.brandColor).toBe("#f59e0b"); // amber
      expect(op.nameAr).toBe("أوريدو");
    });

    it("handles unknown or foreign operators gracefully", () => {
      const op = getOperatorInfo(208, 1);
      expect(op.name).toBe("Opérateur 208-1");
      expect(op.nameAr).toBe("شبكة غير معروفة");
    });
  });

  describe("formatCellId and parseCellId", () => {
    it("formats cell parameters into standard hyphenated string", () => {
      expect(formatCellId({ mcc: 603, mnc: 1, lac: 100, cid: 2 })).toBe("603-1-100-2");
      expect(formatCellId({ mcc: 603, mnc: 2, lac: 2541, cid: 45012 })).toBe("603-2-2541-45012");
    });

    it("parses valid cell id strings into numeric components", () => {
      expect(parseCellId("603-1-100-2")).toEqual({
        mcc: 603,
        mnc: 1,
        lac: 100,
        cid: 2,
      });
      expect(parseCellId("603-02-2541-45012")).toEqual({
        mcc: 603,
        mnc: 2,
        lac: 2541,
        cid: 45012,
      });
    });

    it("returns null for malformed cell id strings", () => {
      expect(parseCellId("")).toBeNull();
      expect(parseCellId("invalid")).toBeNull();
      expect(parseCellId("603-1-100")).toBeNull();
      expect(parseCellId("603-1-100-abc")).toBeNull();
      expect(parseCellId("603-1-100-2-extra")).toBeNull();
    });
  });

  describe("validateCellSurvey", () => {
    const validSurvey: CellSurveyInput = {
      mcc: 603,
      mnc: 1,
      lac: 1020,
      cid: 34501,
      lat: 36.7538,
      lng: 3.0588,
      rangeM: 800,
      signalDbm: -75,
    };

    it("accepts a complete, valid survey point", () => {
      const validated = validateCellSurvey(validSurvey);
      expect(validated.mcc).toBe(603);
      expect(validated.mnc).toBe(1);
      expect(validated.lac).toBe(1020);
      expect(validated.cid).toBe(34501);
      expect(validated.lat).toBeCloseTo(36.7538, 4);
      expect(validated.lng).toBeCloseTo(3.0588, 4);
      expect(validated.rangeM).toBe(800);
      expect(validated.source).toBe("survey");
    });

    it("defaults rangeM to 1000 if omitted or invalid", () => {
      const { rangeM: _, ...withoutRange } = validSurvey;
      const validated = validateCellSurvey(withoutRange);
      expect(validated.rangeM).toBe(1000);
    });

    it("rejects invalid or out-of-range coordinates", () => {
      expect(() => validateCellSurvey({ ...validSurvey, lat: 95 })).toThrow(/latitude/i);
      expect(() => validateCellSurvey({ ...validSurvey, lng: 190 })).toThrow(/longitude/i);
      expect(() => validateCellSurvey({ ...validSurvey, lat: NaN })).toThrow(/latitude/i);
    });

    it("rejects non-positive cell IDs", () => {
      expect(() => validateCellSurvey({ ...validSurvey, mcc: 0 })).toThrow(/mcc/i);
      expect(() => validateCellSurvey({ ...validSurvey, mnc: -1 })).toThrow(/mnc/i);
      expect(() => validateCellSurvey({ ...validSurvey, lac: 0 })).toThrow(/lac/i);
      expect(() => validateCellSurvey({ ...validSurvey, cid: -5 })).toThrow(/cid/i);
    });
  });
});
