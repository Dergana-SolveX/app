import type { ChipState } from "@solvex-dergana/shared";
import { ShieldAlertIcon, CarIcon } from "lucide-react";

export function formatDegrees(deg: number): string {
  if (Math.abs(deg) < 0.05) return "0.0°";
  const sign = deg > 0 ? "+" : "";
  return `${sign}${deg.toFixed(1)}°`;
}

export function getVehicleTwinStatus({
  rollDeg,
  pitchDeg,
}: {
  rollDeg: number;
  pitchDeg: number;
}): "STABLE" | "INCLINÉ" | "TONNEAU" {
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
  if (lastImpactMs !== null && nowMs - lastImpactMs <= 800) return true;
  return false;
}

export function VehicleTwin({
  rollDeg = 0,
  pitchDeg = 0,
  state,
  nowMs,
  lastImpactMs = null,
}: {
  rollDeg: number;
  pitchDeg: number;
  state: ChipState;
  nowMs: number;
  lastImpactMs?: number | null;
}) {
  const impacting = isImpactingNow(state, nowMs, lastImpactMs);
  const status = getVehicleTwinStatus({ rollDeg, pitchDeg });

  // 3D rotation angles clamped for smooth visual presentation
  const clampedRoll = Math.max(-180, Math.min(180, rollDeg));
  const clampedPitch = Math.max(-90, Math.min(90, pitchDeg));

  // Alternate flash color (red/white) based on 150ms cycle during impact
  const flashPhase = Math.floor(nowMs / 150) % 2 === 0;

  return (
    <section aria-labelledby="vehicle-twin-title" className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b pb-2">
        <div>
          <h2 id="vehicle-twin-title" className="text-sm font-bold tracking-tight">
            Jumeau Numérique 3D
          </h2>
          <p className="text-xs text-muted-foreground" dir="rtl">
            التوأم الرقمي للمركبة (توجيه ثلاثي الأبعاد)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {impacting ? (
            <span className="flex items-center gap-1 rounded bg-red-500/20 px-2 py-0.5 text-xs font-bold text-red-400 animate-pulse">
              <ShieldAlertIcon className="h-3.5 w-3.5" />
              CHOC / IMPACT
            </span>
          ) : (
            <span
              className={`rounded px-2 py-0.5 text-xs font-semibold ${
                status === "TONNEAU"
                  ? "bg-amber-500/20 text-amber-300"
                  : status === "INCLINÉ"
                  ? "bg-blue-500/20 text-blue-300"
                  : "bg-emerald-500/20 text-emerald-300"
              }`}
            >
              {status}
            </span>
          )}
        </div>
      </div>

      {/* 3D Viewport with CSS 3D perspective */}
      <div
        className="relative flex h-52 w-full items-center justify-center overflow-hidden rounded-md border border-border/50 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950"
        style={{ perspective: "900px" }}
      >
        {/* Background Grid & Horizon */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b15_1px,transparent_1px),linear-gradient(to_bottom,#1e293b15_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

        {/* Impact Flash Backdrop */}
        {impacting && (
          <div
            className={`absolute inset-0 pointer-events-none transition-opacity duration-100 ${
              flashPhase ? "bg-red-600/30" : "bg-white/20"
            }`}
          />
        )}

        {/* 3D Vehicle Object */}
        <div
          className="relative transition-transform duration-75 ease-out"
          style={{
            transformStyle: "preserve-3d",
            transform: `rotateX(${-clampedPitch}deg) rotateZ(${-clampedRoll}deg)`,
          }}
        >
          {/* Shadow plane beneath vehicle */}
          <div
            className="absolute -bottom-10 left-1/2 h-16 w-32 -translate-x-1/2 rounded-full bg-black/60 blur-md pointer-events-none"
            style={{ transform: "rotateX(90deg) translateZ(-20px)" }}
          />

          {/* Low-Poly Styled Vehicle Body */}
          <div
            className={`relative h-20 w-36 rounded-xl border transition-colors duration-100 ${
              impacting
                ? flashPhase
                  ? "border-red-400 bg-red-600 shadow-[0_0_25px_#ef4444]"
                  : "border-white bg-slate-100 text-slate-900 shadow-[0_0_25px_#ffffff]"
                : "border-cyan-500/40 bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 shadow-[0_0_20px_rgba(6,182,212,0.15)]"
            }`}
          >
            {/* Front Headlights */}
            <div className="absolute right-0 top-2 flex flex-col gap-2">
              <span
                className={`h-3 w-2 rounded-l-sm ${
                  impacting ? (flashPhase ? "bg-red-300" : "bg-yellow-200") : "bg-cyan-300 shadow-[0_0_8px_#67e8f9]"
                }`}
              />
              <span
                className={`h-3 w-2 rounded-l-sm ${
                  impacting ? (flashPhase ? "bg-red-300" : "bg-yellow-200") : "bg-cyan-300 shadow-[0_0_8px_#67e8f9]"
                }`}
              />
            </div>

            {/* Rear Taillights */}
            <div className="absolute left-0 top-2 flex flex-col gap-2">
              <span className="h-3 w-2 rounded-r-sm bg-red-500 shadow-[0_0_8px_#ef4444]" />
              <span className="h-3 w-2 rounded-r-sm bg-red-500 shadow-[0_0_8px_#ef4444]" />
            </div>

            {/* Cabin / Windshield Roof */}
            <div className="absolute left-6 top-3 h-14 w-20 rounded-md border border-cyan-400/30 bg-slate-900/80 p-1">
              <div className="flex h-full w-full items-center justify-center font-mono text-[9px] font-bold text-cyan-300">
                SVX · 001
              </div>
            </div>

            {/* 4 Wheels */}
            <div className="absolute -bottom-2.5 left-4 h-5 w-7 rounded-sm bg-slate-950 border border-slate-700" />
            <div className="absolute -bottom-2.5 right-4 h-5 w-7 rounded-sm bg-slate-950 border border-slate-700" />
            <div className="absolute -top-2.5 left-4 h-5 w-7 rounded-sm bg-slate-950 border border-slate-700" />
            <div className="absolute -top-2.5 right-4 h-5 w-7 rounded-sm bg-slate-950 border border-slate-700" />
          </div>
        </div>

        {/* Live Orientation HUD Overlays */}
        <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded bg-black/60 px-2 py-1 font-mono text-xs text-muted-foreground backdrop-blur-sm">
          <span>Roulis (Roll) :</span>
          <strong className="text-cyan-300">{formatDegrees(rollDeg)}</strong>
        </div>

        <div className="absolute bottom-2 right-2 flex items-center gap-2 rounded bg-black/60 px-2 py-1 font-mono text-xs text-muted-foreground backdrop-blur-sm">
          <span>Tangage (Pitch) :</span>
          <strong className="text-cyan-300">{formatDegrees(pitchDeg)}</strong>
        </div>
      </div>
    </section>
  );
}
