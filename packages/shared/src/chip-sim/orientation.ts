import { THRESHOLDS } from "../thresholds";
import type { SensorSample } from "./detect";

const DEG = 180 / Math.PI;

/** An angle brought into (-180, 180]. */
const wrap = (deg: number) => {
  const turned = ((((deg + 180) % 360) + 360) % 360) - 180;
  return turned === -180 ? 180 : turned;
};

/** Above this distance from 1 g the accelerometer is feeling the crash, not gravity, so it cannot give the tilt. */
const GRAVITY_TRUST_G = 0.3;

export type Angles = { rollDeg: number; pitchDeg: number };

/**
 * Roll and pitch from the gyro (right now) and gravity (over time): a complementary filter. During an impact the
 * accelerometer reads the crash rather than gravity, so the filter then follows the gyro alone.
 */
export function createOrientationFilter(alpha: number = THRESHOLDS.chipSim.orientationAlpha) {
  let roll = 0;
  let pitch = 0;
  let started = false;

  return {
    update(sample: SensorSample, dtS: number): Angles {
      const magnitude = Math.hypot(sample.ax, sample.ay, sample.az);
      const gravityTrusted = Math.abs(magnitude - 1) <= GRAVITY_TRUST_G;
      const accelRoll = Math.atan2(sample.ay, sample.az) * DEG;
      const accelPitch = Math.atan2(-sample.ax, Math.hypot(sample.ay, sample.az)) * DEG;

      if (!started && gravityTrusted) {
        roll = accelRoll;
        pitch = accelPitch;
        started = true;
        return { rollDeg: roll, pitchDeg: pitch };
      }

      const predictedRoll = roll + sample.gx * dtS;
      const predictedPitch = pitch + sample.gy * dtS;
      const weight = gravityTrusted ? 1 - alpha : 0;
      roll = wrap(predictedRoll + weight * wrap(accelRoll - predictedRoll));
      pitch = wrap(predictedPitch + weight * wrap(accelPitch - predictedPitch));
      return { rollDeg: roll, pitchDeg: pitch };
    },
  };
}

/** The car is over when |roll| or |pitch| stays above 90 degrees for 2 s (PRD `rollover`). */
export function createRolloverDetector({ angleDeg, minDurationS } = THRESHOLDS.rollover) {
  let since: number | null = null;
  return {
    update(angles: Angles, tMs: number): { rollover: boolean; sinceMs: number | null } {
      if (Math.abs(angles.rollDeg) > angleDeg || Math.abs(angles.pitchDeg) > angleDeg) since ??= tMs;
      else since = null;
      return { rollover: since !== null && tMs - since >= minDurationS * 1000, sinceMs: since };
    },
  };
}
