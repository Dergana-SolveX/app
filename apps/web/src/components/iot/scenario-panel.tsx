import { Button } from "@solvex-dergana/ui/components/button";
import { FlameIcon, PlayIcon, PowerIcon, RotateCcwIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { useState } from "react";

import { NumberStepper, ToggleChip } from "@/components/bilan/controls";

import type { Scenario, Snapshot } from "./use-chip-simulator";

/** The five ready-made scenarios, on the keys 1 to 5 (PRD FR-S8-09). */
export const SCENARIOS: { key: string; label: string; scenario: Scenario }[] = [
  { key: "1", label: "Choc frontal", scenario: { kind: "trace", name: "frontal_40", label: "Choc frontal" } },
  { key: "2", label: "Tonneau", scenario: { kind: "trace", name: "rollover", label: "Tonneau" } },
  { key: "3", label: "Incendie à l'arrêt", scenario: { kind: "trace", name: "fire_parked", label: "Incendie à l'arrêt" } },
  { key: "4", label: "Zone blanche", scenario: { kind: "trace", name: "frontal_40", forceSms: true, label: "Zone blanche : choc frontal par SMS" } },
  { key: "5", label: "Nid-de-poule", scenario: { kind: "trace", name: "pothole", label: "Nid-de-poule" } },
];

function Kbd({ children }: { children: string }) {
  return <kbd className="tabular rounded border bg-muted px-1.5 font-mono text-xs font-bold text-muted-foreground">{children}</kbd>;
}

/** The presenter's controls: scenarios, arm / disarm, reset, and the jury's own impact. */
export function ScenarioPanel({
  state,
  busy,
  onStart,
  onPress,
}: {
  state: Snapshot["state"];
  busy: boolean;
  onStart: (scenario: Scenario) => void;
  onPress: (button: "arm" | "disarm" | "reset") => void;
}) {
  const [custom, setCustom] = useState({ peakG: 40, durationMs: 80, rollDeg: 0, fire: false });
  const armed = state === "ARMED";
  const canToggleArm = state === "IDLE" || state === "ARMED";

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="scenarios-title">
        <h2 id="scenarios-title" className="mb-2 text-sm font-bold">
          Scénarios
        </h2>
        <ul className="grid grid-cols-1 gap-2">
          {SCENARIOS.map(({ key, label, scenario }) => (
            <li key={key}>
              <Button type="button" size="lg" variant="outline" className="w-full justify-between" disabled={busy} onClick={() => onStart(scenario)}>
                <span className="flex items-center gap-2">
                  <PlayIcon aria-hidden="true" />
                  {label}
                </span>
                <Kbd>{key}</Kbd>
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="lg" variant={armed ? "default" : "outline"} aria-pressed={armed} disabled={!canToggleArm} onClick={() => onPress(armed ? "disarm" : "arm")}>
          {armed ? <ShieldCheckIcon aria-hidden="true" /> : <ShieldOffIcon aria-hidden="true" />}
          {armed ? "Désarmer" : "Armer"}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={() => onPress("reset")}>
          <RotateCcwIcon aria-hidden="true" />
          Reset <Kbd>R</Kbd>
        </Button>
      </div>

      <section aria-labelledby="custom-title" className="rounded-lg border bg-card p-3">
        <h2 id="custom-title" className="mb-3 text-sm font-bold">
          Impact personnalisé
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <NumberStepper label="Pic" unit="g" value={custom.peakG} onChange={(v) => setCustom({ ...custom, peakG: v ?? 0 })} min={0} max={400} step={5} fallback={40} />
          <NumberStepper label="Durée" unit="ms" value={custom.durationMs} onChange={(v) => setCustom({ ...custom, durationMs: v ?? 0 })} min={0} max={300} step={5} fallback={80} />
          <NumberStepper label="Tonneau" unit="°" value={custom.rollDeg} onChange={(v) => setCustom({ ...custom, rollDeg: v ?? 0 })} min={0} max={360} step={30} fallback={0} />
          <div className="flex flex-col justify-end">
            <ToggleChip label="Incendie" pressed={custom.fire} onPressedChange={(fire) => setCustom({ ...custom, fire })} />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Seuil de la puce : plus de 6 g pendant au moins 3 ms. Au-delà de 200 g, le capteur sature.</p>
        <Button
          type="button"
          size="lg"
          className="mt-3 w-full"
          disabled={busy}
          onClick={() => onStart({ kind: "custom", label: "Impact personnalisé", params: custom })}
        >
          {custom.fire ? <FlameIcon aria-hidden="true" /> : <PowerIcon aria-hidden="true" />}
          Lancer l'impact
        </Button>
      </section>
    </div>
  );
}
