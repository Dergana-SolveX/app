import type { ChipState } from "@solvex-dergana/shared";
import { Button } from "@solvex-dergana/ui/components/button";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { FlameIcon, GaugeIcon, LocateFixedIcon, PlayIcon, ShieldAlertIcon } from "lucide-react";
import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { readPalette, type ScenePalette } from "./twin3d/palette";
import type { SceneHandle, Telemetry } from "./twin3d/vehicle-scene";
import type { Snapshot } from "./use-chip-simulator";

const VehicleScene = lazy(() => import("./twin3d/vehicle-scene"));

export type OrientationAngles = {
  rollDeg: number;
  pitchDeg: number;
};

export function formatDegrees(deg: number): string {
  if (Math.abs(deg) < 0.05) return "0.0°";
  const sign = deg > 0 ? "+" : "";
  return `${sign}${deg.toFixed(1)}°`;
}

export function getVehicleTwinStatus({
  rollDeg,
  pitchDeg,
}: OrientationAngles): "STABLE" | "INCLINÉ" | "TONNEAU" {
  if (Math.abs(rollDeg) > 60 || Math.abs(pitchDeg) > 60) {
    return "TONNEAU";
  }
  if (Math.abs(rollDeg) > 15 || Math.abs(pitchDeg) > 15) {
    return "INCLINÉ";
  }
  return "STABLE";
}

export function isImpactingNow(
  state: ChipState,
  nowMs: number,
  lastImpactMs: number | null,
): boolean {
  if (state === "IMPACT") return true;
  if (lastImpactMs !== null && nowMs - lastImpactMs < 800) return true;
  return false;
}

function hasWebGL() {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** The palette follows the theme class on <html>, re-read whenever it changes. */
function useScenePalette(): ScenePalette {
  const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [palette, setPalette] = useState(() => readPalette(isDark()));
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setPalette((current) => (current.dark === isDark() ? current : readPalette(isDark())));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return palette;
}

function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Renders only while the viewport is on screen and the tab is visible. */
function useOnScreen(element: React.RefObject<HTMLElement | null>) {
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const node = element.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)), { threshold: 0.01 });
    observer.observe(node);
    const onVisibility = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [element]);
  return onScreen && tabVisible;
}

/** If WebGL fails at runtime (lost context, driver blocklist), the CSS twin takes over. */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The lightweight CSS twin: shown while the 3D scene loads, and where WebGL is unavailable. */
function CssTwin({ rollDeg, pitchDeg, impacting }: { rollDeg: number; pitchDeg: number; impacting: boolean }) {
  // Pitch is clamped to [-90, 90]; roll is not, so a full rollover reads.
  const clampedPitch = Math.max(-90, Math.min(90, pitchDeg));
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-background via-card to-background" style={{ perspective: "900px" }}>
      <div className="absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_srgb,var(--border)_60%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--border)_60%,transparent)_1px,transparent_1px)] bg-[size:24px_24px]" />
      <div
        className="relative transition-transform duration-75 ease-out"
        style={{ transformStyle: "preserve-3d", transform: `rotateX(${-clampedPitch}deg) rotateZ(${-rollDeg}deg)` }}
      >
        <div
          className={cn(
            "relative h-20 w-36 rounded-xl border transition-colors duration-100",
            impacting ? "border-sev-red bg-sev-red-soft" : "border-brand/40 bg-gradient-to-r from-muted via-accent to-muted",
          )}
        >
          <div className="absolute right-0 top-2 flex flex-col gap-2">
            <span className="h-3 w-2 rounded-l-sm bg-brand" />
            <span className="h-3 w-2 rounded-l-sm bg-brand" />
          </div>
          <div className="absolute left-0 top-2 flex flex-col gap-2">
            <span className="h-3 w-2 rounded-r-sm bg-danger-solid" />
            <span className="h-3 w-2 rounded-r-sm bg-danger-solid" />
          </div>
          <div className="absolute left-6 top-3 h-14 w-20 rounded-md border border-brand/30 bg-card/80 p-1">
            <div className="flex h-full w-full items-center justify-center font-mono text-xs font-bold text-brand">SVX · 001</div>
          </div>
          <div className="absolute -bottom-2.5 left-4 h-5 w-7 rounded-sm border border-border-strong bg-background" />
          <div className="absolute -bottom-2.5 right-4 h-5 w-7 rounded-sm border border-border-strong bg-background" />
          <div className="absolute -top-2.5 left-4 h-5 w-7 rounded-sm border border-border-strong bg-background" />
          <div className="absolute -top-2.5 right-4 h-5 w-7 rounded-sm border border-border-strong bg-background" />
        </div>
      </div>
    </div>
  );
}

const hud = "rounded-md border border-border/60 bg-background/75 px-2.5 py-1.5 backdrop-blur-sm";

/**
 * The 3D twin (PRD FR-S8-08): a car driving to the right whose every motion is the chip's own sensor
 * recording replayed (see `motion-track.ts`): the barrier, the pothole, the rollover and the fire follow the
 * scenario chosen, in sync with the chart and the chip's states.
 */
export function VehicleTwin({ snapshot }: { snapshot: Snapshot }) {
  const { orientation, state, nowMs, lastImpactMs, isImpacting, playing } = snapshot;
  const impacting = isImpacting ?? isImpactingNow(state, nowMs, lastImpactMs);
  const status = getVehicleTwinStatus(orientation);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const viewport = useRef<HTMLDivElement>(null);
  const scene = useRef<SceneHandle>(null);
  const palette = useScenePalette();
  const reducedMotion = usePrefersReducedMotion();
  const active = useOnScreen(viewport);
  const webgl = useMemo(hasWebGL, []);
  const [telemetry, setTelemetry] = useState<Telemetry>({ speedKmh: 50, crashed: false, flame: false, parked: false });

  const fallback = <CssTwin rollDeg={orientation.rollDeg} pitchDeg={orientation.pitchDeg} impacting={impacting} />;
  const summary = [
    telemetry.crashed ? "véhicule accidenté, à l'arrêt" : telemetry.parked ? "véhicule garé sur la bande d'arrêt" : `véhicule à ${telemetry.speedKmh} km/h`,
    telemetry.flame ? "en feu" : null,
    status.toLowerCase(),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section aria-labelledby="vehicle-twin-title" className="min-w-0 rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-2">
        <div className="min-w-0">
          <h2 id="vehicle-twin-title" className="text-sm font-bold tracking-tight">
            Jumeau Numérique 3D
          </h2>
          <p className="text-xs text-muted-foreground" dir="rtl">
            التوأم الرقمي للمركبة (توجيه ثلاثي الأبعاد)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {telemetry.flame && (
            <span className="flex items-center gap-1 rounded bg-sev-red/15 px-2 py-0.5 text-xs font-bold text-sev-red">
              <FlameIcon className="size-3.5" aria-hidden="true" />
              FEU
            </span>
          )}
          {impacting ? (
            <span className="flex items-center gap-1 rounded bg-sev-red/20 px-2 py-0.5 text-xs font-bold text-sev-red motion-safe:animate-pulse">
              <ShieldAlertIcon className="size-3.5" aria-hidden="true" />
              CHOC / IMPACT
            </span>
          ) : (
            <span
              className={cn(
                "rounded px-2 py-0.5 text-xs font-semibold",
                status === "TONNEAU" ? "bg-sev-yellow/20 text-sev-yellow" : status === "INCLINÉ" ? "bg-info/20 text-info" : "bg-sev-green/20 text-sev-green",
              )}
            >
              {status}
            </span>
          )}
        </div>
      </div>

      <div
        ref={viewport}
        role="img"
        aria-label={`Jumeau numérique 3D : ${summary}`}
        className="relative aspect-[16/10] max-h-[30rem] min-h-56 w-full overflow-hidden rounded-md border border-border/60"
      >
        {webgl ? (
          <SceneBoundary fallback={fallback}>
            <Suspense fallback={fallback}>
              <VehicleScene
                ref={scene}
                snapshotRef={snapshotRef}
                palette={palette}
                reducedMotion={reducedMotion}
                active={active}
                onTelemetry={setTelemetry}
              />
            </Suspense>
          </SceneBoundary>
        ) : (
          fallback
        )}

        {/* HUD: what the scene shows, also as text. */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start justify-between gap-2">
          <div className={cn(hud, "flex items-baseline gap-1.5")}>
            <GaugeIcon className="size-3.5 self-center text-muted-foreground" aria-hidden="true" />
            <span className="tabular font-mono text-xl font-bold leading-none">{telemetry.speedKmh}</span>
            <span className="text-xs text-muted-foreground">km/h</span>
          </div>
          {playing && (
            <div className={cn(hud, "flex max-w-[60%] items-center gap-1.5 text-xs font-semibold")}>
              <PlayIcon className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
              <span className="truncate">{playing.label}</span>
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap items-end justify-between gap-1 font-mono text-xs text-muted-foreground">
          <div className={cn(hud, "flex items-center gap-1.5 py-1")}>
            <span>Roulis :</span>
            <strong className="text-brand">{formatDegrees(orientation.rollDeg)}</strong>
          </div>
          {webgl && (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="pointer-events-auto bg-background/75 backdrop-blur-sm"
              aria-label="Recentrer la vue 3D"
              title="Recentrer la vue (glisser pour tourner autour du véhicule)"
              onClick={() => scene.current?.recenter()}
            >
              <LocateFixedIcon aria-hidden="true" />
            </Button>
          )}
          <div className={cn(hud, "flex items-center gap-1.5 py-1")}>
            <span>Tangage :</span>
            <strong className="text-brand">{formatDegrees(orientation.pitchDeg)}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
