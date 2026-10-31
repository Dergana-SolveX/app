import { THRESHOLDS } from "@solvex-dergana/shared";

import type { Snapshot } from "./use-chip-simulator";

const WIDTH = 760;
const HEIGHT = 250;
const PAD = { left: 48, right: 12, top: 14, bottom: 26 };
const WINDOW_MS = 6000;

/**
 * The accelerometer, live: |a| in g over the last 6 seconds, the 6 g trigger line, and the part above it shaded
 * (PRD FR-S8-08). A pulse that is too short to count shows here too, and the chip's verdict is written below.
 */
export function GChart({ chart, nowMs, rejected }: { chart: Snapshot["chart"]; nowMs: number; rejected: string | null }) {
  const threshold = THRESHOLDS.chipTrigger.peakG;
  const peak = Math.max(1, ...chart.map((p) => p.g));
  const yMax = Math.min(220, Math.max(40, Math.ceil((peak * 1.1) / 10) * 10));
  const left = nowMs - WINDOW_MS;
  const x = (t: number) => PAD.left + ((t - left) / WINDOW_MS) * (WIDTH - PAD.left - PAD.right);
  const y = (g: number) => PAD.top + (1 - Math.min(g, yMax) / yMax) * (HEIGHT - PAD.top - PAD.bottom);

  const line = chart.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.g).toFixed(1)}`).join(" ");
  const area =
    chart.length > 1
      ? `M${x(chart[0]!.t).toFixed(1)} ${y(threshold).toFixed(1)} ` +
        chart.map((p) => `L${x(p.t).toFixed(1)} ${y(Math.max(p.g, threshold)).toFixed(1)}`).join(" ") +
        ` L${x(chart.at(-1)!.t).toFixed(1)} ${y(threshold).toFixed(1)} Z`
      : "";
  const current = chart.at(-1)?.g ?? 1;

  return (
    <figure className="m-0">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <figcaption className="text-sm font-bold">Accélération (g)</figcaption>
        <p className="tabular font-mono text-2xl font-bold">
          {current.toFixed(1).replace(".", ",")} <span className="text-sm font-semibold text-muted-foreground">g</span>
        </p>
      </div>
      <svg
        role="img"
        aria-label={`Accélération des 6 dernières secondes : pic de ${peak.toFixed(1).replace(".", ",")} g, seuil de déclenchement à ${threshold} g`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full rounded-lg border bg-card"
      >
        {[0, yMax / 2, yMax].map((g) => (
          <g key={g}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(g)} y2={y(g)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(g) + 4} textAnchor="end" className="fill-muted-foreground text-xs">
              {Math.round(g)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(threshold)} y2={y(threshold)} className="stroke-sev-red" strokeWidth={2} strokeDasharray="6 4" />
        <text x={WIDTH - PAD.right - 4} y={y(threshold) - 6} textAnchor="end" className="fill-sev-red text-xs font-bold">
          Seuil {threshold} g · {THRESHOLDS.chipTrigger.minDurationMs} ms
        </text>
        {area && <path d={area} className="fill-sev-red/30" />}
        {line && <path d={line} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" />}
        <text x={PAD.left} y={HEIGHT - 6} className="fill-muted-foreground text-xs">
          −6 s
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" className="fill-muted-foreground text-xs">
          maintenant
        </text>
      </svg>
      {rejected && (
        <p role="status" className="mt-2 inline-flex items-center gap-2 rounded-md border border-sev-yellow/40 bg-sev-yellow-soft px-3 py-1.5 text-sm font-bold text-sev-yellow">
          Impulsion écartée : {rejected}
        </p>
      )}
    </figure>
  );
}
