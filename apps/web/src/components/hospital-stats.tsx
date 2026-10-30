import { Button } from "@solvex-dergana/ui/components/button";
import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, ClockIcon, HeartPulseIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { trpc } from "@/utils/trpc";

type DateRange = "7d" | "30d" | "all";

const RANGES: { id: DateRange; label: string }[] = [
  { id: "7d", label: "7 jours" },
  { id: "30d", label: "30 jours" },
  { id: "all", label: "Tout" },
];

const number = (value: number) => value.toLocaleString("fr-FR");
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;
/** `2026-10-29` to `29/10`, read from the text so a time zone can never shift the day. */
const dayLabel = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** A horizontal bar whose length is `value` out of `max`; the number is always written next to it. */
function Bar({ value, max, className, label }: { value: number; max: number; className: string; label: string }) {
  const width = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div role="img" aria-label={label} className="h-3 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${width}%` }} />
    </div>
  );
}

/**
 * The hospital's Statistiques tab (PRD FR-ST-02): this hospital's arrivals, accept vs divert, why it diverted,
 * how early AT-MIST arrives, and how often RED patients reach it with the capabilities they need.
 * The server only ever returns this hospital's own data (FR-ST-03).
 */
export function HospitalStats({ hospitalId }: { hospitalId: string }) {
  const [range, setRange] = useState<DateRange>("30d");
  const [includeEmulated, setIncludeEmulated] = useState(true);

  // Computed once per range so the query key stays stable between renders.
  const from = useMemo(() => {
    if (range === "all") return undefined;
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (range === "7d" ? 7 : 30));
    return date;
  }, [range]);

  const stats = useQuery(trpc.stats.hospital.queryOptions({ hospitalId, from, includeEmulated }));
  const data = stats.data;
  const handovers = data ? data.acceptVsDivert.accepted + data.acceptVsDivert.diverted : 0;
  const biggestDay = data ? Math.max(1, ...data.arrivalsByDay.map((day) => day.count)) : 1;
  const biggestReason = data ? Math.max(1, ...data.divertReasons.map((reason) => reason.count)) : 1;

  return (
    <section aria-labelledby="hospital-stats-title" className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 id="hospital-stats-title" className="text-xl font-bold tracking-tight">
            Statistiques de l'hôpital
          </h2>
          <p lang="ar" dir="rtl" className="text-xs font-semibold text-primary/80">
            إحصائيات المستشفى
          </p>
          <p className="text-sm text-muted-foreground">Uniquement les arrivées de votre établissement.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border bg-muted/30 p-1" role="group" aria-label="Plage de temps">
            {RANGES.map(({ id, label }) => (
              <Button
                key={id}
                size="sm"
                variant={range === id ? "default" : "ghost"}
                aria-pressed={range === id}
                className="h-8 text-xs font-semibold"
                onClick={() => setRange(id)}
              >
                {label}
              </Button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-muted/20 px-3 py-1.5 text-xs font-medium">
            <input
              type="checkbox"
              checked={includeEmulated}
              onChange={(event) => setIncludeEmulated(event.target.checked)}
              className="size-4"
              aria-label="Inclure données de démo"
            />
            <span>Inclure données de démo</span>
          </label>
        </div>
      </div>

      {includeEmulated && (
        <div role="status" className="flex items-center gap-3 rounded-lg border border-emulation/40 bg-emulation-soft p-3 text-xs text-emulation">
          <EmulationBadge>DONNÉES DE DÉMONSTRATION</EmulationBadge>
          <span>Ces chiffres incluent l'historique de démonstration (émulé). Décochez pour ne voir que l'activité réelle.</span>
        </div>
      )}

      {stats.isPending && (
        <p role="status" className="py-12 text-center text-sm text-muted-foreground">
          Chargement des indicateurs…
        </p>
      )}

      {stats.isError && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center">
          <p className="text-sm font-semibold text-destructive">Impossible de charger les statistiques.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => stats.refetch()}>
            Réessayer
          </Button>
        </div>
      )}

      {data && data.arrivalsByDay.length === 0 && handovers === 0 && (
        <p className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          Aucune arrivée sur la période choisie.
        </p>
      )}

      {data && (data.arrivalsByDay.length > 0 || handovers > 0) && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-xl border bg-card p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <CheckCircle2Icon className="size-4" aria-hidden="true" /> Taux d'acceptation
              </h3>
              <p className="tabular mt-2 text-3xl font-bold">{number(data.acceptVsDivert.rate)} %</p>
              <p className="mt-1 text-sm">
                <span className="font-semibold">{plural(data.acceptVsDivert.accepted, "acceptée")}</span>
                {" · "}
                <span className="font-semibold">{plural(data.acceptVsDivert.diverted, "déroutée")}</span>
              </p>
              <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${data.acceptVsDivert.accepted} acceptées sur ${handovers}`}>
                <div className="bg-sev-green" style={{ width: `${handovers ? (data.acceptVsDivert.accepted / handovers) * 100 : 0}%` }} />
                <div className="bg-sev-red" style={{ width: `${handovers ? (data.acceptVsDivert.diverted / handovers) * 100 : 0}%` }} />
              </div>
            </article>

            <article className="rounded-xl border bg-card p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <ClockIcon className="size-4" aria-hidden="true" /> Délai AT-MIST avant arrivée
              </h3>
              <p className="tabular mt-2 text-3xl font-bold">{number(data.averageLeadTimeMinutes)} min</p>
              <p className="mt-1 text-sm text-muted-foreground">Moyenne entre la fiche reçue et l'arrivée du patient.</p>
            </article>

            <article className="rounded-xl border bg-card p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <HeartPulseIcon className="size-4" aria-hidden="true" /> Patients rouges bien orientés
              </h3>
              <p className="tabular mt-2 text-3xl font-bold">{number(data.redWithCapabilitiesRate)} %</p>
              <p className="mt-1 text-sm text-muted-foreground">Reçus avec tous les moyens nécessaires, dès la première tentative.</p>
            </article>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <article className="space-y-3 rounded-xl border bg-card p-4">
              <h3 className="text-sm font-bold">Arrivées par jour et par gravité</h3>
              <ul className="space-y-3">
                {data.arrivalsByDay.map((day) => (
                  <li key={day.date}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="tabular font-mono font-semibold">{dayLabel(day.date)}</span>
                      <span className="text-muted-foreground">
                        {plural(day.red, "rouge")} · {plural(day.yellow, "jaune")} · {plural(day.green, "vert")}
                      </span>
                    </div>
                    <div className="mt-1 flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${day.count} arrivées le ${dayLabel(day.date)}`}>
                      <div className="bg-sev-red" style={{ width: `${(day.red / biggestDay) * 100}%` }} />
                      <div className="bg-sev-yellow" style={{ width: `${(day.yellow / biggestDay) * 100}%` }} />
                      <div className="bg-sev-green" style={{ width: `${(day.green / biggestDay) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </article>

            <article className="space-y-3 rounded-xl border bg-card p-4">
              <h3 className="text-sm font-bold">Motifs de déroutement, par spécialité</h3>
              {data.divertReasons.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun déroutement sur la période.</p>
              ) : (
                <ul className="space-y-3">
                  {data.divertReasons.map((reason) => (
                    <li key={reason.reason}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-semibold">{reason.reason}</span>
                        <span className="tabular font-mono">{reason.count}</span>
                      </div>
                      <Bar value={reason.count} max={biggestReason} className="bg-sev-red" label={`${reason.reason} : ${reason.count}`} />
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>
        </>
      )}
    </section>
  );
}
