import { geohashEncode } from "../geo/geohash";
import { encodeSvx, MAX_SMS_LENGTH, type SvxAlert } from "./protocol";

export interface WitnessReportData {
  victims: number;
  conscious: 0 | 1 | 2 | null;
  fire: boolean;
  trapped: boolean;
  bleeding: boolean;
  lat?: number | null;
  lng?: number | null;
  timestamp?: number;
  profileCode?: string | null;
}

export interface SvxStringResult {
  svx: string;
  charCount: number;
  remainingChars: number;
  isSingleSegment: boolean;
}

/**
 * Builds an SvxAlert object for a witness or app report (layer 2).
 */
export function buildWitnessSvxAlert(report: WitnessReportData): SvxAlert {
  const now = report.timestamp ?? Date.now();
  const eventMinutes = Math.floor(now / 60000);

  const geohash =
    report.lat !== null &&
    report.lat !== undefined &&
    report.lng !== null &&
    report.lng !== undefined
      ? geohashEncode(report.lat, report.lng, 8)
      : null;

  return {
    layer: 2, // 2 = phone app
    geohash,
    eventMinutes,
    peakG: null,
    rollover: null,
    fire: report.fire ? true : false,
    victims: Math.min(9, Math.max(0, report.victims)),
    conscious: report.conscious,
    trapped: report.trapped ? true : false,
    bleeding: report.bleeding ? true : false,
    profileCode: report.profileCode ?? null,
    deltaVKmh: null,
    cell: null,
  };
}

/**
 * Encodes a witness report as an SVX1 protocol SMS string and reports character length.
 */
export function buildWitnessSvxString(report: WitnessReportData): SvxStringResult {
  const alert = buildWitnessSvxAlert(report);
  const svx = encodeSvx(alert);
  const charCount = svx.length;

  return {
    svx,
    charCount,
    remainingChars: Math.max(0, MAX_SMS_LENGTH - charCount),
    isSingleSegment: charCount <= MAX_SMS_LENGTH,
  };
}
