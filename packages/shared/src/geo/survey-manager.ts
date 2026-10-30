import { getOperatorInfo, type CellIdentifier, type OperatorInfo } from "./cell-survey";
import { haversineM } from "./distance";

export type CurrentCellInfo = CellIdentifier & {
  signalDbm?: number | null;
};

export type CurrentGpsFix = {
  lat: number;
  lng: number;
  accuracyM: number;
  timestamp: number;
};

export type SurveyPoint = CellIdentifier & {
  id: string;
  lat: number;
  lng: number;
  accuracyM: number;
  signalDbm?: number | null;
  recordedAt: string;
  status: "pending" | "synced" | "error";
  operator: OperatorInfo;
};

export type SurveyState = {
  currentCell: (CurrentCellInfo & { operator: OperatorInfo }) | null;
  currentGps: CurrentGpsFix | null;
  isContinuous: boolean;
  canLog: boolean;
  loggedPoints: SurveyPoint[];
};

export function createSurveyManager(options: { autoDistanceM?: number } = {}) {
  const autoDistanceM = options.autoDistanceM ?? 50;

  let currentCell: CurrentCellInfo | null = null;
  let currentGps: CurrentGpsFix | null = null;
  let isContinuous = false;
  let lastLoggedCoords: { lat: number; lng: number } | null = null;
  const loggedPoints: SurveyPoint[] = [];

  function getState(): SurveyState {
    const operator = currentCell
      ? getOperatorInfo(currentCell.mcc, currentCell.mnc)
      : null;

    const cellWithOp = currentCell && operator ? { ...currentCell, operator } : null;

    return {
      currentCell: cellWithOp,
      currentGps,
      isContinuous,
      canLog: Boolean(currentCell && currentGps),
      loggedPoints: [...loggedPoints],
    };
  }

  function logPoint(): SurveyPoint | null {
    if (!currentCell || !currentGps) return null;

    const id = `surv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const operator = getOperatorInfo(currentCell.mcc, currentCell.mnc);

    const point: SurveyPoint = {
      id,
      mcc: currentCell.mcc,
      mnc: currentCell.mnc,
      lac: currentCell.lac,
      cid: currentCell.cid,
      lat: currentGps.lat,
      lng: currentGps.lng,
      accuracyM: currentGps.accuracyM,
      signalDbm: currentCell.signalDbm ?? null,
      recordedAt: new Date(currentGps.timestamp || Date.now()).toISOString(),
      status: "pending",
      operator,
    };

    loggedPoints.unshift(point);
    lastLoggedCoords = { lat: currentGps.lat, lng: currentGps.lng };
    return point;
  }

  function updateCell(cell: CurrentCellInfo | null) {
    currentCell = cell;
  }

  function updateGps(gps: CurrentGpsFix | null) {
    currentGps = gps;

    if (isContinuous && currentGps && currentCell) {
      if (!lastLoggedCoords) {
        logPoint();
      } else {
        const dist = haversineM(
          lastLoggedCoords.lat,
          lastLoggedCoords.lng,
          currentGps.lat,
          currentGps.lng,
        );
        if (dist >= autoDistanceM) {
          logPoint();
        }
      }
    }
  }

  function setContinuous(enabled: boolean) {
    isContinuous = enabled;
  }

  function markSynced(id: string) {
    const found = loggedPoints.find((p) => p.id === id);
    if (found) {
      found.status = "synced";
    }
  }

  function clearHistory() {
    loggedPoints.length = 0;
    lastLoggedCoords = null;
  }

  return {
    getState,
    updateCell,
    updateGps,
    logPoint,
    setContinuous,
    markSynced,
    clearHistory,
  };
}
