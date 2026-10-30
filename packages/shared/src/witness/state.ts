// Unambiguous uppercase charset (32 chars) for 8-char short codes (FR-S4-07 / FR-S3-07)
export const SHORT_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateShortCode(rng: () => number = Math.random): string {
  let result = "";
  for (let i = 0; i < 8; i++) {
    const idx = Math.floor(rng() * SHORT_CODE_CHARS.length);
    result += SHORT_CODE_CHARS[idx % SHORT_CODE_CHARS.length];
  }
  return result;
}

export type WitnessStep =
  | 1
  | 2
  | 3
  | "location_prompt"
  | "submitting"
  | "submitted"
  | "error";

export type DangerType = "fire" | "trapped" | "bleeding" | "none";
export type GpsStatus = "searching" | "acquired" | "timeout" | "denied";

export type Coords = {
  lat: number;
  lng: number;
  accuracyM: number;
};

export type SubmissionPayload = {
  idempotencyKey: string;
  profileCode?: string | null;
  victims: number;
  conscious: number | null;
  fire: boolean;
  trapped: boolean;
  bleeding: boolean;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  commune: string | null;
  pkMarker: string | null;
};

export type WitnessFlowState = {
  step: WitnessStep;
  idempotencyKey: string;
  lang: "fr" | "ar";
  profileCode: string | null;
  victims: 1 | 2 | 3 | null;
  conscious: 0 | 1 | 2 | null;
  dangers: DangerType[];
  coords: Coords | null;
  gpsStatus: GpsStatus;
  gpsSecondsElapsed: number;
  manualCommune: string;
  manualPkMarker: string;
  submissionResult: {
    incidentId: string;
    alertId: string;
    duplicate: boolean;
    merged: boolean;
  } | null;
  error: string | null;
  toSubmissionPayload(): SubmissionPayload;
};

export type WitnessFlowAction =
  | { type: "SELECT_VICTIMS"; count: 1 | 2 | 3 }
  | { type: "SELECT_CONSCIOUS"; value: 0 | 1 | 2 }
  | { type: "TOGGLE_DANGER"; danger: DangerType }
  | { type: "TICK_GPS_TIMER" }
  | { type: "GPS_ACQUIRED"; coords: Coords }
  | { type: "GPS_FAILED"; status: "timeout" | "denied" }
  | { type: "SET_MANUAL_LOCATION"; commune: string; pkMarker: string }
  | { type: "SET_PROFILE_CODE"; profileCode: string | null }
  | { type: "PROCEED_SUBMIT" }
  | { type: "SET_LANG"; lang: "fr" | "ar" }
  | { type: "SUBMISSION_START" }
  | {
      type: "SUBMISSION_SUCCESS";
      result: {
        incidentId: string;
        alertId: string;
        duplicate: boolean;
        merged: boolean;
      };
    }
  | { type: "SUBMISSION_ERROR"; error: string }
  | { type: "RESET"; idempotencyKey?: string };

function toPayload(state: Omit<WitnessFlowState, "toSubmissionPayload">): SubmissionPayload {
  const hasGps = state.gpsStatus === "acquired" && state.coords !== null;
  return {
    idempotencyKey: state.idempotencyKey,
    profileCode: state.profileCode ?? null,
    victims: state.victims ?? 1,
    conscious: state.conscious,
    fire: state.dangers.includes("fire"),
    trapped: state.dangers.includes("trapped"),
    bleeding: state.dangers.includes("bleeding"),
    lat: hasGps ? state.coords!.lat : null,
    lng: hasGps ? state.coords!.lng : null,
    accuracyM: hasGps ? state.coords!.accuracyM : null,
    commune: state.manualCommune.trim() || null,
    pkMarker: state.manualPkMarker.trim() || null,
  };
}

export function createWitnessFlowState(
  idempotencyKey?: string,
  profileCode?: string | null,
): WitnessFlowState {
  const key =
    idempotencyKey ??
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `witness-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

  const baseState = {
    step: 1 as WitnessStep,
    idempotencyKey: key,
    lang: "fr" as const,
    profileCode: profileCode ?? null,
    victims: null,
    conscious: null,
    dangers: [] as DangerType[],
    coords: null,
    gpsStatus: "searching" as GpsStatus,
    gpsSecondsElapsed: 0,
    manualCommune: "",
    manualPkMarker: "",
    submissionResult: null,
    error: null,
  };

  return {
    ...baseState,
    toSubmissionPayload() {
      return toPayload(this);
    },
  };
}

export function flowReducer(
  state: WitnessFlowState,
  action: WitnessFlowAction,
): WitnessFlowState {
  let updated = { ...state };

  switch (action.type) {
    case "SELECT_VICTIMS": {
      updated.victims = action.count;
      updated.step = 2;
      break;
    }

    case "SELECT_CONSCIOUS": {
      updated.conscious = action.value;
      updated.step = 3;
      break;
    }

    case "TOGGLE_DANGER": {
      const danger = action.danger;
      if (danger === "none") {
        updated.dangers = updated.dangers.includes("none") ? [] : ["none"];
      } else {
        const withoutNone = updated.dangers.filter((d) => d !== "none");
        if (withoutNone.includes(danger)) {
          updated.dangers = withoutNone.filter((d) => d !== danger);
        } else {
          updated.dangers = [...withoutNone, danger];
        }
      }
      break;
    }

    case "TICK_GPS_TIMER": {
      if (updated.gpsStatus === "searching") {
        const nextSeconds = updated.gpsSecondsElapsed + 1;
        updated.gpsSecondsElapsed = nextSeconds;
        if (nextSeconds >= 20) {
          updated.gpsStatus = "timeout";
        }
      }
      break;
    }

    case "GPS_ACQUIRED": {
      updated.coords = action.coords;
      updated.gpsStatus = "acquired";
      break;
    }

    case "GPS_FAILED": {
      updated.gpsStatus = action.status;
      break;
    }

    case "SET_MANUAL_LOCATION": {
      updated.manualCommune = action.commune;
      updated.manualPkMarker = action.pkMarker;
      break;
    }

    case "SET_PROFILE_CODE": {
      updated.profileCode = action.profileCode;
      break;
    }

    case "PROCEED_SUBMIT": {
      if (updated.gpsStatus !== "acquired" && !updated.manualCommune && !updated.manualPkMarker) {
        updated.step = "location_prompt";
      } else {
        updated.step = "submitting";
      }
      break;
    }

    case "SET_LANG": {
      updated.lang = action.lang;
      break;
    }

    case "SUBMISSION_START": {
      updated.step = "submitting";
      updated.error = null;
      break;
    }

    case "SUBMISSION_SUCCESS": {
      updated.step = "submitted";
      updated.submissionResult = action.result;
      break;
    }

    case "SUBMISSION_ERROR": {
      updated.step = "error";
      updated.error = action.error;
      break;
    }

    case "RESET": {
      return createWitnessFlowState(action.idempotencyKey, updated.profileCode);
    }
  }

  return {
    ...updated,
    toSubmissionPayload() {
      return toPayload(this);
    },
  };
}
