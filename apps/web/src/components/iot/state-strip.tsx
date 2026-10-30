import { THRESHOLDS, type ChipState } from "@solvex-dergana/shared";
import { Button } from "@solvex-dergana/ui/components/button";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { CheckIcon, XIcon } from "lucide-react";

import { STATE_LABELS } from "./labels";
import type { Snapshot } from "./use-chip-simulator";

const ORDER: ChipState[] = ["BOOT", "IDLE", "ARMED", "IMPACT", "CONFIRM", "SEND", "AWAIT_ACK", "DONE"];

const RADIUS = 38;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The 10 s the driver has to cancel, as a ring that empties and as a number. */
function CountdownRing({ remainingMs }: { remainingMs: number }) {
  const total = THRESHOLDS.chipSim.confirmS * 1000;
  const seconds = Math.ceil(remainingMs / 1000);
  return (
    <div className="relative grid size-24 shrink-0 place-items-center" role="timer" aria-label={`Annulation possible encore ${seconds} secondes`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={RADIUS} fill="none" className="stroke-border" strokeWidth={8} />
        <circle
          cx="50" cy="50" r={RADIUS} fill="none" className="stroke-sev-yellow" strokeWidth={8} strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - remainingMs / total)}
        />
      </svg>
      <span className="tabular font-mono text-3xl font-extrabold">{seconds}</span>
    </div>
  );
}

/** BOOT -> ... -> DONE, with the state the chip is in now, the CONFIRM countdown and the cancel button (PRD FR-S8-08). */
export function StateStrip({
  snapshot,
  onCancel,
}: {
  snapshot: Pick<Snapshot, "state" | "confirmRemainingMs" | "transmissions" | "forceSms">;
  onCancel: () => void;
}) {
  const { state, confirmRemainingMs, transmissions, forceSms } = snapshot;
  const current = ORDER.indexOf(state);
  const latest = transmissions.at(-1);

  return (
    <section aria-label="États de la puce" className="flex flex-col gap-3">
      <ol className="flex flex-wrap gap-1.5">
        {ORDER.map((name, index) => {
          const label = STATE_LABELS[name];
          const active = name === state;
          const passed = index < current;
          return (
            <li
              key={name}
              aria-current={active ? "step" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm font-semibold",
                active && "border-primary bg-primary text-primary-foreground",
                passed && "border-border bg-muted text-foreground",
                !active && !passed && "border-dashed text-muted-foreground",
              )}
            >
              {passed && <CheckIcon className="size-3.5" aria-hidden="true" />}
              {label}
            </li>
          );
        })}
      </ol>

      <div className="flex min-h-24 flex-wrap items-center gap-4 rounded-lg border bg-card p-3">
        {state === "CONFIRM" ? (
          <>
            {/* Said once when the countdown starts: the numbers below change every second and must not be read out. */}
            <p role="status" className="sr-only">
              Impact détecté : l'alerte part dans {THRESHOLDS.chipSim.confirmS} secondes, vous pouvez l'annuler.
            </p>
            <CountdownRing remainingMs={confirmRemainingMs} />
            <div className="min-w-0 flex-1">
              <p className="text-base font-extrabold">Impact détecté : l'alerte part dans {Math.ceil(confirmRemainingMs / 1000)} s</p>
              <p className="text-sm text-muted-foreground">Le conducteur peut annuler une fausse alerte avec le bouton (touche Espace).</p>
            </div>
            <Button type="button" size="lg" variant="destructive" onClick={onCancel}>
              <XIcon aria-hidden="true" />
              Annuler l'alerte
            </Button>
          </>
        ) : (
          <p role="status" className="text-sm">
            <StateSentence state={state} attempt={latest?.attempt} channel={latest?.channel} status={latest?.status} forceSms={forceSms} />
          </p>
        )}
      </div>
    </section>
  );
}

function StateSentence({
  state,
  attempt,
  channel,
  status,
  forceSms,
}: {
  state: ChipState;
  attempt?: number;
  channel?: "http" | "sms";
  status?: "pending" | "ok" | "failed";
  forceSms: boolean;
}) {
  switch (state) {
    case "BOOT":
      return <>La puce démarre et fait son autotest.</>;
    case "IDLE":
      return <>La puce est au repos. Elle ne réagit à un choc que lorsqu'elle est armée.</>;
    case "ARMED":
      return <>Puce armée : elle surveille l'accéléromètre, l'inclinaison et la fumée.{forceSms ? " Zone blanche : l'alerte partira par SMS." : ""}</>;
    case "AWAIT_ACK":
      return (
        <>
          Tentative {attempt ?? 1} par {channel === "sms" ? "SMS" : "Internet"} :{" "}
          {status === "failed" ? "échec, nouvel essai après une attente croissante." : "en attente de l'accusé du serveur."}
        </>
      );
    case "DONE":
      return <>Alerte reçue par le serveur : la puce a terminé.</>;
    default:
      return <>{STATE_LABELS[state]}.</>;
  }
}
