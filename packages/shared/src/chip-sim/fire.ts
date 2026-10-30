import { THRESHOLDS } from "../thresholds";
import type { SensorSample } from "./detect";

/**
 * A fire is smoke above the baseline together with a flame, held for 3 s. The delay keeps a flicker, a cigarette
 * lighter or exhaust smoke from raising an alarm.
 */
export function createFireDebouncer({ fireDebounceS, fireSmokeAbove } = THRESHOLDS.chipSim) {
  let since: number | null = null;
  return {
    update(sample: SensorSample): boolean {
      if (sample.flame && sample.smoke > fireSmokeAbove) since ??= sample.tMs;
      else since = null;
      return since !== null && sample.tMs - since >= fireDebounceS * 1000;
    },
  };
}
