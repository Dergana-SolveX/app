import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { BRAND_TITLE } from "@/lib/brand";

export type ArrivalSnapshot = {
  id: string;
  recSeverity: string;
  alertCount: number;
};

export type Arrival = {
  id: string;
  recSeverity: string;
  /** "new": an incident nobody had seen; "signal": another alert joined it; "escalated": it became RED. */
  kind: "new" | "signal" | "escalated";
};

/**
 * What arrived between two snapshots of the incident list: new incidents, new alerts merged into known
 * incidents, and incidents that escalated to RED. The first snapshot after loading never counts.
 */
export function detectArrivals(
  previous: ArrivalSnapshot[],
  current: ArrivalSnapshot[],
  isInitialized = true,
): Arrival[] {
  if (!isInitialized) return [];
  const known = new Map(previous.map((i) => [i.id, i]));
  const arrivals: Arrival[] = [];
  for (const item of current) {
    const before = known.get(item.id);
    if (!before) arrivals.push({ id: item.id, recSeverity: item.recSeverity, kind: "new" });
    else if (item.alertCount > before.alertCount)
      arrivals.push({ id: item.id, recSeverity: item.recSeverity, kind: "signal" });
    else if (item.recSeverity === "red" && before.recSeverity !== "red")
      arrivals.push({ id: item.id, recSeverity: item.recSeverity, kind: "escalated" });
  }
  return arrivals;
}

/** Alternates the tab title so an alert is noticed from another tab, until stopped. */
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

/* ------------------------------------------------------------------------------------------------
 * Audio. Browsers only let a page make sound after a user gesture, so one shared AudioContext is
 * created lazily and resumed on the first click or key press anywhere on the page.
 * ---------------------------------------------------------------------------------------------- */

const STORAGE_KEY = "awn-alert-sound";
const listeners = new Set<() => void>();
let context: AudioContext | null = null;
let unlockInstalled = false;
let suppressedUntil = 0;

/** The dispatcher's own corrections (split, merge) change the list too: they must not ring as arrivals. */
export function suppressArrivalsFor(ms: number) {
  suppressedUntil = Date.now() + ms;
}

function emit() {
  for (const listener of listeners) listener();
}

function audioContextClass(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

function getContext(): AudioContext | null {
  if (context) return context;
  const Ctor = audioContextClass();
  if (!Ctor) return null;
  try {
    context = new Ctor();
    context.onstatechange = emit;
  } catch {
    context = null;
  }
  return context;
}

/** Resumes audio after a user gesture. Safe to call many times. */
export function unlockAudio() {
  const ctx = getContext();
  if (ctx && ctx.state === "suspended") void ctx.resume().then(emit, () => {});
}

function installUnlock() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const unlock = () => {
    unlockAudio();
    if (context?.state === "running") {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    }
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

export function isSoundEnabled() {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(STORAGE_KEY) !== "off";
}

export function setSoundEnabled(enabled: boolean) {
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  if (enabled) unlockAudio();
  emit();
}

/** True when sound is on but the browser still waits for a click before allowing it. */
export function isAudioBlocked() {
  const ctx = context;
  return ctx !== null && ctx.state !== "running";
}

/**
 * A loud two-tone emergency siren (hi-lo, like a European ambulance), synthesized with Web Audio so no
 * asset is needed. RED plays a longer, faster pattern. Square and sawtooth waves through a compressor
 * keep it loud without clipping.
 */
export function playAlertSiren(severity: string = "unknown") {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  try {
    const red = severity === "red";
    const cycles = red ? 6 : 4;
    const half = red ? 0.28 : 0.4;
    const high = red ? 1050 : 960;
    const low = red ? 700 : 770;
    const start = ctx.currentTime + 0.02;
    const end = start + cycles * half * 2;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-10, start);
    compressor.ratio.setValueAtTime(4, start);
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, start);
    master.gain.exponentialRampToValueAtTime(1, start + 0.03);
    master.gain.setValueAtTime(1, end - 0.06);
    master.gain.exponentialRampToValueAtTime(0.0001, end);
    master.connect(compressor);
    compressor.connect(ctx.destination);

    const voices = [
      { type: "square" as const, gain: 0.55, detune: 1 },
      { type: "sawtooth" as const, gain: 0.35, detune: 1.005 },
    ];
    for (const voice of voices) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = voice.type;
      gain.gain.setValueAtTime(voice.gain, start);
      for (let i = 0; i < cycles * 2; i++) {
        osc.frequency.setValueAtTime((i % 2 === 0 ? high : low) * voice.detune, start + i * half);
      }
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(end + 0.05);
    }
  } catch {
    // Unsupported audio environment: the visual alert still shows.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sound preference and audio state for the controls. */
export function useAlertSoundSettings() {
  const enabled = useSyncExternalStore(subscribe, isSoundEnabled, () => true);
  const blocked = useSyncExternalStore(subscribe, isAudioBlocked, () => false);
  useEffect(() => {
    installUnlock();
    getContext();
    emit();
  }, []);
  const toggle = useCallback(() => setSoundEnabled(!isSoundEnabled()), []);
  const test = useCallback(() => {
    unlockAudio();
    playAlertSiren("red");
  }, []);
  return { enabled, blocked, toggle, test };
}

/**
 * Watches the incident list and, on every arrival (new incident, new alert, escalation to RED): plays the
 * siren (when enabled), flashes the tab title until the dispatcher comes back, and reports the arrivals.
 */
export function useAlertArrivals(
  incidents: ArrivalSnapshot[] | undefined,
  onArrival?: (arrivals: Arrival[]) => void,
) {
  const previous = useRef<ArrivalSnapshot[] | null>(null);
  const flashTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopFlash = useRef<(() => void) | null>(null);
  const onArrivalRef = useRef(onArrival);
  onArrivalRef.current = onArrival;

  useEffect(() => {
    if (!incidents) return;
    const snapshot = incidents.map(({ id, recSeverity, alertCount }) => ({ id, recSeverity, alertCount }));
    if (previous.current === null) {
      previous.current = snapshot;
      return;
    }
    const arrivals = detectArrivals(previous.current, snapshot);
    previous.current = snapshot;
    if (!arrivals.length || Date.now() < suppressedUntil) return;

    onArrivalRef.current?.(arrivals);
    if (isSoundEnabled()) playAlertSiren(arrivals.some((a) => a.recSeverity === "red") ? "red" : "unknown");

    if (typeof document === "undefined") return;
    const red = arrivals.some((a) => a.recSeverity === "red");
    const flasher = createTitleFlasher({
      baseTitle: BRAND_TITLE,
      alertTitle: `${red ? "ALERTE ROUGE" : "Nouvelle alerte"} (${arrivals.length}) — ${BRAND_TITLE}`,
      setTitle: (title) => {
        document.title = title;
      },
    });
    stopFlash.current?.();
    flashTimer.current = setInterval(() => flasher.step(), 800);
    const stop = () => {
      if (flashTimer.current) clearInterval(flashTimer.current);
      flashTimer.current = null;
      flasher.stop();
      window.removeEventListener("focus", stop);
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", stop);
      stopFlash.current = null;
    };
    stopFlash.current = stop;
    window.addEventListener("focus", stop);
    window.addEventListener("pointerdown", stop);
    window.addEventListener("keydown", stop);
  }, [incidents]);

  useEffect(() => () => stopFlash.current?.(), []);
}
