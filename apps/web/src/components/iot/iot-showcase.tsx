import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { Button } from "@solvex-dergana/ui/components/button";
import { MaximizeIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { clockTime } from "@/lib/time";

import { GChart } from "./g-chart";
import { PacketCard } from "./packet-card";
import { SCENARIOS, ScenarioPanel } from "./scenario-panel";
import { StateStrip } from "./state-strip";
import { TRACE_LABEL, useChipSimulator } from "./use-chip-simulator";

/** Keys that are typed into a field must not trigger a scenario. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

/**
 * The first IoT Showcase (PRD FR-S8-07..09): a dark projector page for the simulated chip. The chip runs here in
 * real time; every alert it sends goes to the real server, which is what answers it.
 */
export default function IotShowcase() {
  const { snapshot, actions } = useChipSimulator();
  const root = useRef<HTMLDivElement>(null);
  // The keyboard handler reads the latest snapshot without being rebuilt on every tick.
  const latest = useRef(snapshot);
  latest.current = snapshot;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const { busy, state } = latest.current;
      const scenario = SCENARIOS.find((s) => s.key === event.key);
      if (scenario) {
        if (!busy) actions.start(scenario.scenario);
      } else if (event.key === "r" || event.key === "R") {
        actions.press("reset");
      } else if (event.key === " " && state === "CONFIRM") {
        event.preventDefault();
        actions.press("cancel");
      } else if (event.key === "f" || event.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void root.current?.requestFullscreen();
      } else {
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);

  const { playing } = snapshot;
  return (
    <div ref={root} className="dark min-h-[calc(100dvh-4rem)] bg-background p-4 text-foreground md:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight md:text-2xl">IoT Showcase</h1>
          <p className="text-sm text-muted-foreground">
            Mode <strong className="text-foreground">Puce simulée</strong> : la puce tourne ici en temps réel, ses alertes sont reçues par le vrai serveur.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {playing && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emulation/50 bg-emulation-soft px-2 py-0.5 text-xs font-bold tracking-wide text-emulation uppercase">
              {TRACE_LABEL} · {playing.label} · graine {playing.seed}
            </span>
          )}
          {/* Permanent: nothing on this page comes from real hardware (PRD NFR-P5). */}
          <EmulationBadge />
          <Button type="button" variant="outline" size="icon-lg" aria-label="Plein écran (touche F)" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())}>
            <MaximizeIcon aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)_minmax(0,22rem)]">
        <ScenarioPanel state={snapshot.state} busy={snapshot.busy} onStart={actions.start} onPress={actions.press} />

        <div className="flex min-w-0 flex-col gap-4">
          <GChart chart={snapshot.chart} nowMs={snapshot.nowMs} rejected={snapshot.rejected} />
          <StateStrip snapshot={snapshot} onCancel={() => actions.press("cancel")} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <PacketCard transmissions={snapshot.transmissions} />
          <section aria-labelledby="journal-title" className="rounded-lg border bg-card p-3">
            <h2 id="journal-title" className="mb-2 text-sm font-bold">
              Journal de la puce
            </h2>
            {snapshot.records.length === 0 ? (
              <p className="text-sm text-muted-foreground">Rien pour l'instant.</p>
            ) : (
              <ol className="flex max-h-56 flex-col-reverse gap-0.5 overflow-y-auto text-xs">
                {snapshot.records.slice(-12).map((record, i) => (
                  <li key={`${record.tMs}-${i}`} className="flex gap-2 font-mono">
                    <span className="tabular text-muted-foreground">{clockTime(new Date(Date.now() - (snapshot.nowMs - record.tMs)))}</span>
                    <span>
                      {record.type === "state_change" ? `${record.data.from} → ${record.data.to}` : record.type}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <p className="text-xs text-muted-foreground">
            Touches : <kbd className="font-mono">1</kbd>–<kbd className="font-mono">5</kbd> scénarios · <kbd className="font-mono">Espace</kbd> annuler · <kbd className="font-mono">R</kbd> reset · <kbd className="font-mono">F</kbd> plein écran
          </p>
        </div>
      </div>
    </div>
  );
}
