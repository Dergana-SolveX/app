export type PresentationAction =
  | { action: "scenario"; key: string }
  | { action: "fullscreen" }
  | { action: "reset" }
  | { action: "cancel" };

/**
 * Pure keyboard action parser for presentation mode (FR-S8-09).
 */
export function getPresentationKeyAction(key: string, state?: string): PresentationAction | null {
  if (key === " " && state === "CONFIRM") return { action: "cancel" };
  if (key === "f" || key === "F") return { action: "fullscreen" };
  if (key === "r" || key === "R") return { action: "reset" };
  if (["1", "2", "3", "4", "5"].includes(key)) return { action: "scenario", key };
  return null;
}
