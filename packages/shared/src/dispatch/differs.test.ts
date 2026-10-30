import { describe, expect, it } from "vitest";

import { dispatchDiffers } from "./differs";

const medical = { type: "ambulance_medicalisee", count: 1 };

describe("dispatchDiffers (does a dispatch need a modification reason?)", () => {
  it("is false when the chosen unit types match the recommendation", () => {
    expect(dispatchDiffers([medical], ["ambulance_medicalisee"])).toBe(false);
    expect(
      dispatchDiffers([medical, { type: "desincarceration", count: 1 }], ["desincarceration", "ambulance_medicalisee"]),
    ).toBe(false); // the order does not matter
  });

  it("is true when a recommended type is replaced by another", () => {
    expect(dispatchDiffers([medical], ["vsav_standard"])).toBe(true);
  });

  it("is true when a unit is added or missing", () => {
    expect(dispatchDiffers([medical], ["ambulance_medicalisee", "vsav_standard"])).toBe(true);
    expect(dispatchDiffers([{ ...medical, count: 2 }], ["ambulance_medicalisee"])).toBe(true);
    expect(dispatchDiffers([medical, { type: "desincarceration", count: 1 }], ["ambulance_medicalisee"])).toBe(true);
  });

  it("counts the same type recommended twice as one total", () => {
    expect(dispatchDiffers([medical, medical], ["ambulance_medicalisee", "ambulance_medicalisee"])).toBe(false);
  });

  it("treats any dispatch as a difference when nothing was recommended", () => {
    expect(dispatchDiffers([], ["vsav_standard"])).toBe(true);
    expect(dispatchDiffers(null, ["vsav_standard"])).toBe(true);
  });
});
