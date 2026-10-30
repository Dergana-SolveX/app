import { THRESHOLDS } from "../thresholds";

export interface AccelReading {
  timestamp: number;
  accelG: number;
}

export interface SpeedReading {
  timestamp: number;
  speedKmh: number;
}

export interface PhoneTriggerConfig {
  peakG: number;
  speedBeforeKmh: number;
  speedBeforeWindowS: number;
  speedAfterKmh: number;
}

export type RejectReason =
  | "no_impact_detected"
  | "speed_before_too_low"
  | "speed_after_too_high"
  | "awaiting_post_impact_speed";

export interface PhoneTriggerResult {
  triggered: boolean;
  simulated?: boolean;
  peakG?: number;
  speedBeforeKmh?: number;
  speedAfterKmh?: number;
  impactTimestamp?: number;
  reason?: RejectReason;
}

export class PhoneTriggerFilter {
  private accelBuffer: AccelReading[] = [];
  private speedBuffer: SpeedReading[] = [];
  private config: PhoneTriggerConfig;

  constructor(customConfig?: Partial<PhoneTriggerConfig>) {
    this.config = {
      peakG: customConfig?.peakG ?? THRESHOLDS.phoneTrigger.peakG,
      speedBeforeKmh:
        customConfig?.speedBeforeKmh ?? THRESHOLDS.phoneTrigger.speedBeforeKmh,
      speedBeforeWindowS:
        customConfig?.speedBeforeWindowS ??
        THRESHOLDS.phoneTrigger.speedBeforeWindowS,
      speedAfterKmh:
        customConfig?.speedAfterKmh ?? THRESHOLDS.phoneTrigger.speedAfterKmh,
    };
  }

  pushAccel(timestamp: number, accelG: number): void {
    this.accelBuffer.push({ timestamp, accelG });
    this.prune(timestamp);
  }

  pushSpeed(timestamp: number, speedKmh: number): void {
    this.speedBuffer.push({ timestamp, speedKmh });
    this.prune(timestamp);
  }

  private prune(now: number): void {
    // Keep a buffer of the window plus 5 seconds margin
    const cutoff = now - (this.config.speedBeforeWindowS + 5) * 1000;
    this.accelBuffer = this.accelBuffer.filter((r) => r.timestamp >= cutoff);
    this.speedBuffer = this.speedBuffer.filter((r) => r.timestamp >= cutoff);
  }

  evaluate(now: number): PhoneTriggerResult {
    const windowMs = this.config.speedBeforeWindowS * 1000;
    const searchCutoff = now - windowMs;

    // Find significant impacts in the evaluation window
    const candidates = this.accelBuffer.filter(
      (a) => a.timestamp >= searchCutoff && a.accelG >= this.config.peakG,
    );

    if (candidates.length === 0) {
      return { triggered: false, reason: "no_impact_detected" };
    }

    const firstCandidate = candidates[0];
    if (!firstCandidate) {
      return { triggered: false, reason: "no_impact_detected" };
    }

    // Pick highest peak
    let highestImpact: AccelReading = firstCandidate;
    for (const c of candidates) {
      if (c.accelG > highestImpact.accelG) {
        highestImpact = c;
      }
    }

    const impactTime = highestImpact.timestamp;
    const beforeCutoff = impactTime - windowMs;

    // Speeds in the window prior to impact [impactTime - windowMs, impactTime]
    const speedsBefore = this.speedBuffer.filter(
      (s) => s.timestamp >= beforeCutoff && s.timestamp <= impactTime,
    );

    const maxSpeedBefore =
      speedsBefore.length > 0
        ? Math.max(...speedsBefore.map((s) => s.speedKmh))
        : 0;

    if (maxSpeedBefore < this.config.speedBeforeKmh) {
      return {
        triggered: false,
        reason: "speed_before_too_low",
        peakG: highestImpact.accelG,
        speedBeforeKmh: maxSpeedBefore,
      };
    }

    // Speeds after the impact (impactTime, now]
    const speedsAfter = this.speedBuffer.filter(
      (s) => s.timestamp > impactTime && s.timestamp <= now,
    );

    const latestSpeedAfterObj = speedsAfter[speedsAfter.length - 1];
    if (!latestSpeedAfterObj) {
      return {
        triggered: false,
        reason: "awaiting_post_impact_speed",
        peakG: highestImpact.accelG,
        speedBeforeKmh: maxSpeedBefore,
      };
    }

    const latestSpeedAfter = latestSpeedAfterObj.speedKmh;

    if (latestSpeedAfter >= this.config.speedAfterKmh) {
      return {
        triggered: false,
        reason: "speed_after_too_high",
        peakG: highestImpact.accelG,
        speedBeforeKmh: maxSpeedBefore,
        speedAfterKmh: latestSpeedAfter,
      };
    }

    return {
      triggered: true,
      peakG: highestImpact.accelG,
      speedBeforeKmh: maxSpeedBefore,
      speedAfterKmh: latestSpeedAfter,
      impactTimestamp: impactTime,
    };
  }

  triggerSimulated(timestamp: number): PhoneTriggerResult {
    return {
      triggered: true,
      simulated: true,
      peakG: 6.5,
      speedBeforeKmh: 65,
      speedAfterKmh: 0,
      impactTimestamp: timestamp,
    };
  }

  reset(): void {
    this.accelBuffer = [];
    this.speedBuffer = [];
  }
}

export function createPhoneTriggerFilter(
  config?: Partial<PhoneTriggerConfig>,
): PhoneTriggerFilter {
  return new PhoneTriggerFilter(config);
}
