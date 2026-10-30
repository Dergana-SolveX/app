import { useEffect, useRef } from "react";

export type IncidentSummary = {
  id: string;
  recSeverity: string;
};

/**
 * Detects if a new incident has arrived with RED severity, or an existing one escalated to RED (FR-S5-07).
 */
export function detectNewRedIncident(
  previous: IncidentSummary[],
  current: IncidentSummary[],
): IncidentSummary | null {
  if (previous.length === 0) return null; // Initial snapshot does not count as a new live arrival

  const prevMap = new Map(previous.map((i) => [i.id, i.recSeverity]));

  for (const item of current) {
    if (item.recSeverity === "red") {
      const prevSev = prevMap.get(item.id);
      // New incident that is red, or previous incident that wasn't red and is now red
      if (prevSev === undefined || prevSev !== "red") {
        return item;
      }
    }
  }

  return null;
}

/**
 * Creates a step-by-step title flasher for testing and production flashing loops.
 */
export function createTitleFlasher({
  baseTitle,
  alertTitle,
  setTitle,
}: {
  baseTitle: string;
  alertTitle: string;
  setTitle: (title: string) => void;
}) {
  let isAlert = false;

  return {
    step() {
      isAlert = !isAlert;
      setTitle(isAlert ? alertTitle : baseTitle);
    },
    stop() {
      isAlert = false;
      setTitle(baseTitle);
    },
  };
}

/**
 * Synthesizes an emergency alert sound using Web Audio API (zero external audio asset files needed).
 * Safe against autoplay restrictions.
 */
export function playRedAlertTone() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, ctx.currentTime); // A5

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(440, ctx.currentTime); // A4

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.4);
    osc2.stop(ctx.currentTime + 0.4);
  } catch {
    // Autoplay policy or unsupported audio environment: ignore gracefully
  }
}

/**
 * Hook to flash tab title and play audio tone whenever a new RED incident is received (FR-S5-07).
 */
export function useRedAlert(incidents: IncidentSummary[]) {
  const prevRef = useRef<IncidentSummary[]>([]);
  const flashIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    const newRed = detectNewRedIncident(prev, incidents);
    prevRef.current = incidents;

    if (newRed) {
      // 1. Play alert sound
      playRedAlertTone();

      // 2. Start title flash
      if (typeof document !== "undefined") {
        const baseTitle = "SVX Rescue";
        const alertTitle = "🚨 ALERTE ROUGE - SVX Rescue";
        const flasher = createTitleFlasher({
          baseTitle,
          alertTitle,
          setTitle: (t) => {
            document.title = t;
          },
        });

        if (flashIntervalRef.current) clearInterval(flashIntervalRef.current);
        flashIntervalRef.current = setInterval(() => flasher.step(), 800);

        const stopFlash = () => {
          if (flashIntervalRef.current) {
            clearInterval(flashIntervalRef.current);
            flashIntervalRef.current = null;
          }
          flasher.stop();
          window.removeEventListener("focus", stopFlash);
          window.removeEventListener("click", stopFlash);
          window.removeEventListener("keydown", stopFlash);
        };

        window.addEventListener("focus", stopFlash);
        window.addEventListener("click", stopFlash);
        window.addEventListener("keydown", stopFlash);
      }
    }
  }, [incidents]);

  useEffect(() => {
    return () => {
      if (flashIntervalRef.current) {
        clearInterval(flashIntervalRef.current);
        if (typeof document !== "undefined") {
          document.title = "SVX Rescue";
        }
      }
    };
  }, []);
}
