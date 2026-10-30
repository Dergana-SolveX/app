export type CrashStatus =
  | "idle"
  | "countdown"
  | "cancelled"
  | "expired"
  | "sending"
  | "sent"
  | "error";

export interface CrashLogEntry {
  id: string;
  timestamp: number;
  action: "cancelled" | "sent" | "failed";
  reason?: string;
  peakG?: number | null;
  speedBeforeKmh?: number | null;
  simulated?: boolean;
}

export interface CrashCountdownState {
  status: CrashStatus;
  secondsRemaining: number;
  triggerTimestamp: number | null;
  peakG: number | null;
  speedBeforeKmh: number | null;
  simulated: boolean;
  submissionResult: {
    alertId: string;
    incidentId: string;
  } | null;
  errorMessage: string | null;
  localLogs: CrashLogEntry[];
}

export type CrashCountdownAction =
  | {
      type: "TRIGGER_CRASH";
      payload: {
        peakG?: number;
        speedBeforeKmh?: number;
        simulated?: boolean;
        timestamp: number;
      };
    }
  | { type: "TICK" }
  | { type: "CANCEL"; payload?: { timestamp?: number } }
  | { type: "SENDING_ALERT" }
  | {
      type: "ALERT_SENT";
      payload: { alertId: string; incidentId: string; timestamp: number };
    }
  | { type: "ALERT_ERROR"; payload: { error: string } }
  | { type: "RESET" };

export function createCrashCountdownState(): CrashCountdownState {
  return {
    status: "idle",
    secondsRemaining: 15,
    triggerTimestamp: null,
    peakG: null,
    speedBeforeKmh: null,
    simulated: false,
    submissionResult: null,
    errorMessage: null,
    localLogs: [],
  };
}

export function countdownReducer(
  state: CrashCountdownState,
  action: CrashCountdownAction,
): CrashCountdownState {
  switch (action.type) {
    case "TRIGGER_CRASH": {
      if (state.status === "countdown") return state;
      return {
        ...state,
        status: "countdown",
        secondsRemaining: 15,
        triggerTimestamp: action.payload.timestamp,
        peakG: action.payload.peakG ?? null,
        speedBeforeKmh: action.payload.speedBeforeKmh ?? null,
        simulated: action.payload.simulated ?? false,
        errorMessage: null,
      };
    }

    case "TICK": {
      if (state.status !== "countdown") return state;
      const nextRemaining = state.secondsRemaining - 1;
      if (nextRemaining <= 0) {
        return {
          ...state,
          secondsRemaining: 0,
          status: "expired",
        };
      }
      return {
        ...state,
        secondsRemaining: nextRemaining,
      };
    }

    case "CANCEL": {
      if (state.status !== "countdown") return state;
      const now = action.payload?.timestamp ?? Date.now();
      const cancelLog: CrashLogEntry = {
        id: `log-${now}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: now,
        action: "cancelled",
        reason: "user_cancelled",
        peakG: state.peakG,
        speedBeforeKmh: state.speedBeforeKmh,
        simulated: state.simulated,
      };

      return {
        ...state,
        status: "cancelled",
        localLogs: [cancelLog, ...state.localLogs],
      };
    }

    case "SENDING_ALERT": {
      return {
        ...state,
        status: "sending",
      };
    }

    case "ALERT_SENT": {
      const now = action.payload.timestamp;
      const sentLog: CrashLogEntry = {
        id: `log-${now}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: now,
        action: "sent",
        reason: state.simulated ? "simulated_sent" : "auto_crash_sent",
        peakG: state.peakG,
        speedBeforeKmh: state.speedBeforeKmh,
        simulated: state.simulated,
      };

      return {
        ...state,
        status: "sent",
        submissionResult: {
          alertId: action.payload.alertId,
          incidentId: action.payload.incidentId,
        },
        localLogs: [sentLog, ...state.localLogs],
      };
    }

    case "ALERT_ERROR": {
      return {
        ...state,
        status: "error",
        errorMessage: action.payload.error,
      };
    }

    case "RESET": {
      return {
        ...createCrashCountdownState(),
        localLogs: state.localLogs,
      };
    }

    default:
      return state;
  }
}
