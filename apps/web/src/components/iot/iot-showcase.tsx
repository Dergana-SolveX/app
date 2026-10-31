import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { Button } from "@solvex-dergana/ui/components/button";
import { MaximizeIcon, MinimizeIcon, TvIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { clockTime } from "@/lib/time";

import { BlockDiagram } from "./block-diagram";
import { GChart } from "./g-chart";
import { JourneyTimeline } from "./journey-timeline";
import { RECORD_LABELS, STATE_LABELS } from "./labels";
import { PacketCard } from "./packet-card";
import { getPresentationKeyAction } from "./presentation";
import { SCENARIOS, ScenarioPanel } from "./scenario-panel";
import { StateStrip } from "./state-strip";
import { TRACE_LABEL, useChipSimulator } from "./use-chip-simulator";
import { VehicleTwin } from "./vehicle-twin";

/** Keys that are typed into a field must not trigger a scenario. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

/**
 * The IoT Showcase (PRD FR-S8-07..10, NFR-S8-1): a 16:9 projector page for the simulated chip. It follows the app theme.
 * Includes 3D vehicle twin, animated SVG block diagram, event-driven timeline, and projector presentation mode.
 */
export default function IotShowcase() {
  const { snapshot, actions } = useChipSimulator();
  const root = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cursorHidden, setCursorHidden] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The keyboard handler reads the latest snapshot without being rebuilt on every tick.
  const latest = useRef(snapshot);
  latest.current = snapshot;

  // Handle Fullscreen Changes
  useEffect(() => {
    const onFullscreenChange = () => {
      const isFs = Boolean(document.fullscreenElement);
      setIsFullscreen(isFs);
      if (!isFs) setCursorHidden(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Inactivity Cursor Auto-Hiding (after 3 seconds) specifically in Fullscreen / Presentation mode
  useEffect(() => {
    if (!isFullscreen) {
      setCursorHidden(false);
      return;
    }

    const onMouseMove = () => {
      setCursorHidden(false);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        setCursorHidden(true);
      }, 3000);
    };

    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isFullscreen]);

  // Keyboard Shortcuts (F, 1-5, R, Space during CONFIRM)
  useEffect(() => {
    let spaceCancelled = false;

    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const { busy, state } = latest.current;

      const action = getPresentationKeyAction(event.key, state);
      if (!action) return;

      if (action.action === "cancel") {
        event.preventDefault();
        spaceCancelled = true;
        actions.press("cancel");
        return;
      }

      if (isTyping(event.target)) return;

      if (action.action === "scenario") {
        const scenario = SCENARIOS.find((s) => s.key === action.key);
        if (scenario && !busy) actions.start(scenario.scenario);
      } else if (action.action === "reset") {
        actions.press("reset");
      } else if (action.action === "fullscreen") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void root.current?.requestFullscreen();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " " && spaceCancelled) {
        event.preventDefault();
        spaceCancelled = false;
      }
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [actions]);

  const { playing } = snapshot;
  const activeChannel = snapshot.transmissions.length > 0
    ? snapshot.transmissions[snapshot.transmissions.length - 1]!.channel
    : snapshot.forceSms
    ? "sms"
    : "http";

  const peakG = snapshot.chart.length > 0 ? Math.max(...snapshot.chart.map((c) => c.g)) : 0;

  return (
    <div
      ref={root}
      className={`min-h-[calc(100dvh-4rem)] overflow-x-hidden bg-background p-3 text-foreground transition-all sm:p-4 md:p-6 ${
        isFullscreen && cursorHidden ? "cursor-none" : ""
      }`}
    >
      {/* Header */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight md:text-2xl">IoT Showcase</h1>
            <span className="flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              <TvIcon className="h-3 w-3" />
              16:9 Projecteur
            </span>
          </div>
          <p className="text-xs text-muted-foreground md:text-sm">
            Mode <strong className="text-foreground">Puce simulée</strong> : capteurs réels, jumeau 3D & alertes reçues par le serveur.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {playing && <EmulationBadge>{`${TRACE_LABEL} · ${playing.label} · graine ${playing.seed}`}</EmulationBadge>}
          {/* Permanent: nothing on this page comes from real hardware (PRD NFR-P5). */}
          <EmulationBadge />
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            aria-label="Plein écran (touche F)"
            onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())}
          >
            {isFullscreen ? <MinimizeIcon aria-hidden="true" /> : <MaximizeIcon aria-hidden="true" />}
          </Button>
        </div>
      </header>

      {/* Main Grid: 16:9 Presentation Layout */}
      {/* One column on phones; controls beside a stacked pair on tablets; three columns only once each has room. */}
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1.2fr)_minmax(0,1fr)]">
        {/* Left Column: Scenarios & Chip Log */}
        <div className="flex min-w-0 flex-col gap-4 lg:row-span-2 xl:row-span-1">
          <ScenarioPanel state={snapshot.state} busy={snapshot.busy} onStart={actions.start} onPress={actions.press} />

          <section aria-labelledby="journal-title" className="rounded-lg border bg-card p-3 shadow-sm">
            <h2 id="journal-title" className="mb-2 text-sm font-bold">
              Journal de la puce
            </h2>
            {snapshot.records.length === 0 ? (
              <p className="text-xs text-muted-foreground">Rien pour l'instant.</p>
            ) : (
              <ol className="flex max-h-52 flex-col-reverse gap-0.5 overflow-y-auto text-xs">
                {snapshot.records.slice(-12).map((record, i) => (
                  <li key={`${record.tMs}-${i}`} className="flex gap-2 font-mono text-xs">
                    <span className="tabular text-muted-foreground">{clockTime(new Date(Date.now() - (snapshot.nowMs - record.tMs)))}</span>
                    <span>
                      {record.type === "state_change"
                        ? `${STATE_LABELS[record.data.from as keyof typeof STATE_LABELS]} → ${STATE_LABELS[record.data.to as keyof typeof STATE_LABELS]}`
                        : RECORD_LABELS[record.type]}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Keyboard shortcuts mean nothing on a touch screen. */}
          <div className="hidden rounded-md border border-border/40 bg-muted/20 p-2.5 text-xs text-muted-foreground [@media(hover:hover)]:block">
            <div className="font-semibold text-foreground mb-1">Raccourcis Présentation :</div>
            <div><kbd className="font-mono bg-muted px-1 rounded">1</kbd>–<kbd className="font-mono bg-muted px-1 rounded">5</kbd> Scénarios</div>
            <div><kbd className="font-mono bg-muted px-1 rounded">Espace</kbd> Annuler alerte (CONFIRM)</div>
            <div><kbd className="font-mono bg-muted px-1 rounded">R</kbd> Réinitialiser puce</div>
            <div><kbd className="font-mono bg-muted px-1 rounded">F</kbd> Plein écran</div>
          </div>
        </div>

        {/* Center Column: 3D Vehicle Twin, Live G-Chart, State Strip */}
        <div className="flex min-w-0 flex-col gap-4">
          <VehicleTwin
            orientation={snapshot.orientation}
            state={snapshot.state}
            nowMs={snapshot.nowMs}
            lastImpactMs={snapshot.lastImpactMs}
            isImpacting={snapshot.isImpacting}
          />
          <GChart chart={snapshot.chart} nowMs={snapshot.nowMs} rejected={snapshot.rejected} />
          <StateStrip snapshot={snapshot} onCancel={() => actions.press("cancel")} />
        </div>

        {/* Right Column: Hardware Block Diagram, Packet Anatomy */}
        <div className="flex min-w-0 flex-col gap-4">
          <BlockDiagram
            state={snapshot.state}
            channel={activeChannel}
            peakG={peakG}
            orientation={snapshot.orientation}
          />
          <PacketCard transmissions={snapshot.transmissions} />
        </div>
      </div>

      {/* Bottom Full-Width: Alert Journey Timeline */}
      <div className="mt-4">
        <JourneyTimeline
          transmissions={snapshot.transmissions}
          records={snapshot.records}
          nowMs={snapshot.nowMs}
        />
      </div>
    </div>
  );
}
