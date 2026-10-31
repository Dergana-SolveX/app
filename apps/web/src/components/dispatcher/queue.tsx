import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { SeverityBadge, type Severity } from "@solvex-dergana/ui/components/severity-badge";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { ArrowUpIcon, BellRingIcon, GitMergeIcon, InboxIcon, MapPinIcon, MapPinOffIcon, UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { incidentRef, timeAgo } from "@/lib/time";
import { isActive, statusLabels, type Incident } from "./types";

type QueueIncident = Pick<
  Incident,
  | "id"
  | "recSeverity"
  | "status"
  | "lat"
  | "lng"
  | "firstAlertAt"
  | "lastAlertAt"
  | "alertCount"
  | "estimatedVictims"
  | "commune"
  | "emulated"
  | "tentative"
> &
  Partial<Pick<Incident, "hasEscalation">>;

const FILTERS: { value: Severity | "all"; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "red", label: "Rouge" },
  { value: "yellow", label: "Jaune" },
  { value: "green", label: "Vert" },
  { value: "unknown", label: "Inconnue" },
];

const STRIPE: Record<Severity, string> = {
  red: "before:bg-sev-red",
  yellow: "before:bg-sev-yellow",
  green: "before:bg-sev-green",
  unknown: "before:bg-sev-unknown",
};

/** Latest signal first: the most recent arrival is always on top. */
export const arrivalTime = (i: Pick<Incident, "firstAlertAt" | "lastAlertAt">) =>
  new Date(i.lastAlertAt ?? i.firstAlertAt).getTime();

const located = (i: Pick<Incident, "lat" | "lng">) => i.lat !== null && i.lng !== null;

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function DispatcherQueue({
  incidents,
  selectedId,
  onSelect,
  highlightedId = null,
  onHighlight,
  onLocate,
  unseenIds,
}: {
  incidents: QueueIncident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The alert pointed at (hover or keyboard focus), here or on the map. */
  highlightedId?: string | null;
  onHighlight?: (id: string | null) => void;
  /** Shows the alert's position on the map. */
  onLocate?: (id: string) => void;
  /** Alerts that arrived live and have not been opened yet. */
  unseenIds?: ReadonlySet<string>;
}) {
  const now = useNow(15_000);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const active = incidents.filter(isActive).toSorted((a, b) => arrivalTime(b) - arrivalTime(a));
  const rows = filter === "all" ? active : active.filter((i) => i.recSeverity === filter);
  const count = (value: Severity | "all") =>
    value === "all" ? active.length : active.filter((i) => i.recSeverity === value).length;

  return (
    <aside
      aria-label="File des alertes"
      className="flex min-w-0 flex-col rounded-lg border bg-card shadow-sm lg:max-h-[calc(100dvh-13rem)]"
    >
      <header className="space-y-3 border-b p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <BellRingIcon className="size-5 text-primary" aria-hidden="true" />
            Alertes par ordre d'arrivée
          </h2>
          {!!unseenIds?.size && (
            <span className="rounded-full bg-sev-red px-2.5 py-0.5 text-xs font-semibold text-destructive-foreground">
              {unseenIds.size} nouvelle{unseenIds.size > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div role="group" aria-label="Filtrer par gravité" className="flex flex-wrap gap-1.5">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors hover:bg-accent",
                filter === value && "border-brand bg-brand-soft text-brand-soft-foreground hover:bg-brand-soft",
              )}
            >
              {label}
              <span className="tabular text-xs opacity-80">{count(value)}</span>
            </button>
          ))}
        </div>
      </header>

      {!rows.length ? (
        <div className="grid place-items-center gap-2 px-6 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <InboxIcon className="size-6" aria-hidden="true" />
          </span>
          <p className="font-semibold">{active.length ? "Aucune alerte pour ce filtre." : "Aucune alerte en cours."}</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Les alertes reçues par SMS, application ou puce s'affichent ici dès leur arrivée.
          </p>
        </div>
      ) : (
        <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" aria-label="Alertes en cours, la plus récente en premier">
          {rows.map((i) => {
            const name = i.commune ?? `Incident #${incidentRef(i.id)}`;
            const unseen = unseenIds?.has(i.id) ?? false;
            const hasPosition = located(i);
            return (
              <li
                key={i.id}
                onMouseEnter={() => onHighlight?.(i.id)}
                onMouseLeave={() => onHighlight?.(null)}
                className={cn(
                  "relative flex overflow-hidden rounded-md border bg-card transition-colors before:absolute before:inset-y-0 before:start-0 before:w-1",
                  STRIPE[i.recSeverity],
                  highlightedId === i.id && "border-border-strong bg-accent",
                  selectedId === i.id && "border-brand bg-brand-soft/60",
                  unseen && selectedId !== i.id && "border-sev-red/50",
                )}
              >
                <button
                  type="button"
                  aria-pressed={selectedId === i.id}
                  onClick={() => onSelect(i.id)}
                  onFocus={() => onHighlight?.(i.id)}
                  onBlur={() => onHighlight?.(null)}
                  className="min-w-0 flex-1 space-y-1.5 py-3 ps-4 pe-2 text-start focus-visible:outline-offset-[-2px]"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={i.recSeverity} />
                    {unseen && (
                      <span className="rounded-full bg-sev-red px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
                        Nouveau
                      </span>
                    )}
                    <span className="ms-auto text-xs text-muted-foreground">
                      <time dateTime={new Date(arrivalTime(i)).toISOString()} className="tabular font-medium text-foreground">
                        {new Date(arrivalTime(i)).toLocaleTimeString("fr-DZ", { hour: "2-digit", minute: "2-digit" })}
                      </time>{" "}
                      · {timeAgo(new Date(arrivalTime(i)), now)}
                    </span>
                  </span>
                  <span className="block truncate text-base font-semibold">{name}</span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span>
                      {i.alertCount} alerte{i.alertCount > 1 ? "s" : ""}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UsersIcon className="size-3.5" aria-hidden="true" />
                      {i.estimatedVictims ?? "?"} victime{(i.estimatedVictims ?? 0) > 1 ? "s" : ""}
                    </span>
                    <span>{statusLabels[i.status]}</span>
                  </span>
                  {(i.emulated || i.tentative || i.hasEscalation || !hasPosition) && (
                    <span className="flex flex-wrap gap-1.5 pt-0.5">
                      {i.hasEscalation && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-sev-red/40 bg-sev-red-soft px-2 py-0.5 text-xs font-semibold text-sev-red">
                          <ArrowUpIcon className="size-3.5" aria-hidden="true" />
                          Nouvelles informations
                        </span>
                      )}
                      {i.tentative && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-sev-yellow/40 bg-sev-yellow-soft px-2 py-0.5 text-xs font-semibold text-sev-yellow">
                          <GitMergeIcon className="size-3.5" aria-hidden="true" />
                          Fusion à confirmer
                        </span>
                      )}
                      {i.emulated && <EmulationBadge />}
                      {!hasPosition && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-sev-yellow/40 bg-sev-yellow-soft px-2 py-0.5 text-xs font-semibold text-sev-yellow">
                          <MapPinOffIcon className="size-3.5" aria-hidden="true" />
                          Sans position : rappeler pour préciser
                        </span>
                      )}
                    </span>
                  )}
                </button>
                {onLocate && (
                  <button
                    type="button"
                    disabled={!hasPosition}
                    onClick={() => onLocate(i.id)}
                    onFocus={() => onHighlight?.(i.id)}
                    onBlur={() => onHighlight?.(null)}
                    aria-label={hasPosition ? `Voir ${name} sur la carte` : `${name} : position inconnue`}
                    title={hasPosition ? "Voir sur la carte" : "Position inconnue"}
                    className="grid w-12 shrink-0 place-items-center border-s text-muted-foreground transition-colors hover:bg-accent hover:text-primary focus-visible:outline-offset-[-2px] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <MapPinIcon className="size-5" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
