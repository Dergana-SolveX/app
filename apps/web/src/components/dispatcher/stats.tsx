import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  RadioTowerIcon,
  ShuffleIcon,
  SmartphoneIcon,
  WifiIcon,
} from "lucide-react";

import { Button } from "@solvex-dergana/ui/components/button";
import { Card } from "@solvex-dergana/ui/components/card";
import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { trpc } from "@/utils/trpc";

type DateRangeOption = "7d" | "30d" | "all";

export function DispatcherStats() {
  const [range, setRange] = useState<DateRangeOption>("30d");
  const [includeEmulated, setIncludeEmulated] = useState<boolean>(true);

  // Memoize fromDate so query key stays stable across renders
  const fromDate = useMemo(() => {
    if (range === "all") return undefined;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (range === "7d" ? 7 : 30));
    return d;
  }, [range]);

  const stats = useQuery(
    trpc.stats.dispatcher.queryOptions({
      from: fromDate,
      includeEmulated,
    }),
  );

  const data = stats.data;

  return (
    <div className="space-y-6">
      {/* Header and Filter Controls Bar */}
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Statistiques du centre de régulation
          </h2>
          <p className="text-xs font-semibold text-primary/80">إحصائيات مركز التنظيم</p>
          <p className="text-sm text-muted-foreground">
            Performance opérationnelle, convergence des canaux et suivi des décisions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Time range buttons */}
          <div className="inline-flex rounded-lg border bg-muted/30 p-1" role="group" aria-label="Plage de temps">
            <Button
              variant={range === "7d" ? "default" : "ghost"}
              size="sm"
              onClick={() => setRange("7d")}
              className="h-8 text-xs font-semibold"
            >
              7 jours
            </Button>
            <Button
              variant={range === "30d" ? "default" : "ghost"}
              size="sm"
              onClick={() => setRange("30d")}
              className="h-8 text-xs font-semibold"
            >
              30 jours
            </Button>
            <Button
              variant={range === "all" ? "default" : "ghost"}
              size="sm"
              onClick={() => setRange("all")}
              className="h-8 text-xs font-semibold"
            >
              Tout
            </Button>
          </div>

          {/* Include emulated data toggle */}
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-muted/20 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/40">
            <input
              type="checkbox"
              checked={includeEmulated}
              onChange={(e) => setIncludeEmulated(e.target.checked)}
              className="size-4 rounded border-input text-primary focus:ring-primary"
              aria-label="Inclure données de démo"
            />
            <span>Inclure données de démo</span>
          </label>
        </div>
      </div>

      {/* Demo data notice banner */}
      {includeEmulated && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200"
        >
          <EmulationBadge>DONNÉES DE DÉMONSTRATION</EmulationBadge>
          <span>
            Ces métriques intègrent l'historique des données de démonstration (~40 incidents émulés sur 30 jours) pour illustrer la charge opérationnelle.
          </span>
        </div>
      )}

      {stats.isPending ? (
        <div className="py-12 text-center text-sm text-muted-foreground" role="status">
          Chargement des indicateurs statistiques…
        </div>
      ) : stats.isError ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center">
          <p className="text-sm font-semibold text-destructive">Impossible de charger les statistiques.</p>
          <Button variant="outline" size="sm" onClick={() => stats.refetch()} className="mt-2">
            Réessayer
          </Button>
        </div>
      ) : !data || data.summary.totalIncidents === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          Aucun incident enregistré sur la période sélectionnée sans les données démo.
        </div>
      ) : (
        <>
          {/* Key Metric KPI Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="p-4 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium">Médiane Crash → Décision</span>
                <ClockIcon className="size-4 text-primary" aria-hidden="true" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground">
                  {data.decisionTimes.medianSeconds}s
                </span>
                <span className="text-xs text-emerald-600 font-medium">Objectif &lt; 60s</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Temps écoulé du premier signal au clic de validation
              </p>
            </Card>

            <Card className="p-4 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium">P90 Décision</span>
                <ActivityIcon className="size-4 text-primary" aria-hidden="true" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground">
                  {data.decisionTimes.p90Seconds}s
                </span>
                <span className="text-xs text-muted-foreground">90% des cas</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Délai maximum pour les cas complexes
              </p>
            </Card>

            <Card className="p-4 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium">Taux d'ajustement</span>
                <ShuffleIcon className="size-4 text-amber-500" aria-hidden="true" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground">
                  {data.overrideRate.percentage}%
                </span>
                <span className="text-xs text-muted-foreground">
                  {data.overrideRate.overridden} / {data.overrideRate.total}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Recommandations modifiées par l'opérateur
              </p>
            </Card>

            <Card className="p-4 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium">Convergence alertes (تقارب البلاغات)</span>
                <RadioTowerIcon className="size-4 text-primary" aria-hidden="true" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground">
                  {data.alertsMerged.averagePerIncident}
                </span>
                <span className="text-xs text-muted-foreground">signaux / incident</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.alertsMerged.two + data.alertsMerged.threeOrMore} multi-signaux ({data.alertsMerged.single} mono, {data.alertsMerged.two} double, {data.alertsMerged.threeOrMore} triple+)
              </p>
            </Card>
          </div>

          {/* Section 1: Visual Charts */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Crash-to-dispatch trend */}
            <Card className="p-5 shadow-xs">
              <div className="flex items-center justify-between border-b pb-3">
                <div>
                  <h3 className="font-semibold text-foreground">Tendance décisionnelle (Crash → Dispatch)</h3>
                  <p className="text-xs text-muted-foreground">Évolution temporelle de la médiane journalière en secondes</p>
                </div>
                <ClockIcon className="size-5 text-muted-foreground" aria-hidden="true" />
              </div>

              <div className="mt-4">
                {data.decisionTimes.trend.length > 0 ? (
                  <div className="space-y-3">
                    <div className="h-40 w-full flex items-end gap-1.5 pt-6 pb-2" role="img" aria-label="Graphique des temps de décision">
                      {data.decisionTimes.trend.map((pt, idx) => {
                        const maxVal = Math.max(...data.decisionTimes.trend.map((t) => t.medianSeconds), 100);
                        const heightPct = Math.round((pt.medianSeconds / maxVal) * 100);
                        return (
                          <div key={idx} className="group relative flex-1 flex flex-col items-center h-full justify-end">
                            <div
                              style={{ height: `${heightPct}%` }}
                              className="w-full rounded-t bg-primary/80 transition-all hover:bg-primary group-hover:opacity-100"
                            />
                            <div className="opacity-0 group-hover:opacity-100 absolute -top-8 bg-popover text-popover-foreground text-[10px] px-1.5 py-0.5 rounded shadow pointer-events-none whitespace-nowrap z-10">
                              {pt.date}: {pt.medianSeconds}s
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground border-t pt-1">
                      <span>{data.decisionTimes.trend[0]?.date}</span>
                      <span className="font-medium text-emerald-600">Seuil cible: 60s</span>
                      <span>{data.decisionTimes.trend[data.decisionTimes.trend.length - 1]?.date}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-6 text-center">Données de tendance insuffisantes</p>
                )}
              </div>
            </Card>

            {/* Alert Channel Mix */}
            <Card className="p-5 shadow-xs">
              <div className="flex items-center justify-between border-b pb-3">
                <div>
                  <h3 className="font-semibold text-foreground">Mix des canaux d'alerte</h3>
                  <p className="text-xs text-muted-foreground">Répartition des signaux reçus selon le réseau porteur</p>
                </div>
                <RadioTowerIcon className="size-5 text-muted-foreground" aria-hidden="true" />
              </div>

              <div className="mt-4 space-y-4">
                {(() => {
                  const total =
                    data.channelMix.internet + data.channelMix.sms + data.channelMix.ussd || 1;
                  const intPct = Math.round((data.channelMix.internet / total) * 100);
                  const smsPct = Math.round((data.channelMix.sms / total) * 100);
                  const ussdPct = Math.max(0, 100 - intPct - smsPct);

                  return (
                    <>
                      {/* Stacked bar */}
                      <div className="h-4 w-full rounded-full bg-muted flex overflow-hidden">
                        <div style={{ width: `${intPct}%` }} className="bg-sky-500" title={`Internet: ${intPct}%`} />
                        <div style={{ width: `${smsPct}%` }} className="bg-emerald-500" title={`SMS: ${smsPct}%`} />
                        <div style={{ width: `${ussdPct}%` }} className="bg-amber-500" title={`USSD: ${ussdPct}%`} />
                      </div>

                      {/* Legend & counts */}
                      <div className="grid grid-cols-3 gap-2 pt-2 text-xs">
                        <div className="rounded-lg border p-2.5 bg-sky-500/5">
                          <div className="flex items-center gap-1.5 font-medium text-sky-700 dark:text-sky-300">
                            <WifiIcon className="size-3.5" />
                            <span>Internet</span>
                          </div>
                          <div className="mt-1 text-base font-bold text-foreground">{data.channelMix.internet}</div>
                          <div className="text-[11px] text-muted-foreground">{intPct}% (IoT direct / App)</div>
                        </div>

                        <div className="rounded-lg border p-2.5 bg-emerald-500/5">
                          <div className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
                            <SmartphoneIcon className="size-3.5" />
                            <span>SMS</span>
                          </div>
                          <div className="mt-1 text-base font-bold text-foreground">{data.channelMix.sms}</div>
                          <div className="text-[11px] text-muted-foreground">{smsPct}% (GSM fallback)</div>
                        </div>

                        <div className="rounded-lg border p-2.5 bg-amber-500/5">
                          <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                            <RadioTowerIcon className="size-3.5" />
                            <span>USSD</span>
                          </div>
                          <div className="mt-1 text-base font-bold text-foreground">{data.channelMix.ussd}</div>
                          <div className="text-[11px] text-muted-foreground">{ussdPct}% (Signal canal D)</div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </Card>
          </div>

          {/* Section 2: Severity Split & Override Reasons */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Severity Distribution */}
            <Card className="p-5 shadow-xs">
              <div className="flex items-center justify-between border-b pb-3">
                <div>
                  <h3 className="font-semibold text-foreground">Gravité clinique évaluée</h3>
                  <p className="text-xs text-muted-foreground">Triage automatisé pré-hospitalier selon le score Vittel</p>
                </div>
                <AlertTriangleIcon className="size-5 text-muted-foreground" aria-hidden="true" />
              </div>

              <div className="mt-4 space-y-3">
                {(() => {
                  const total = data.summary.totalIncidents || 1;
                  const redPct = Math.round((data.severitySplit.red / total) * 100);
                  const yellowPct = Math.round((data.severitySplit.yellow / total) * 100);
                  const greenPct = Math.round((data.severitySplit.green / total) * 100);

                  return (
                    <>
                      <div>
                        <div className="flex justify-between text-xs font-medium mb-1">
                          <span className="text-red-600 dark:text-red-400">Urgence absolue (Rouge)</span>
                          <span>{data.severitySplit.red} incidents ({redPct}%)</span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                          <div style={{ width: `${redPct}%` }} className="h-full bg-red-600" />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-medium mb-1">
                          <span className="text-amber-600 dark:text-amber-400">Urgence relative (Jaune)</span>
                          <span>{data.severitySplit.yellow} incidents ({yellowPct}%)</span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                          <div style={{ width: `${yellowPct}%` }} className="h-full bg-amber-500" />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-medium mb-1">
                          <span className="text-emerald-600 dark:text-emerald-400">Impliqué sans détresse (Vert)</span>
                          <span>{data.severitySplit.green} incidents ({greenPct}%)</span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                          <div style={{ width: `${greenPct}%` }} className="h-full bg-emerald-500" />
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </Card>

            {/* Override Reasons */}
            <Card className="p-5 shadow-xs">
              <div className="flex items-center justify-between border-b pb-3">
                <div>
                  <h3 className="font-semibold text-foreground">Motifs de modification du dispatch</h3>
                  <p className="text-xs text-muted-foreground">Pourquoi le régulateur a ajusté les moyens préconisés</p>
                </div>
                <CheckCircle2Icon className="size-5 text-muted-foreground" aria-hidden="true" />
              </div>

              <div className="mt-4">
                {data.overrideRate.topReasons.length > 0 ? (
                  <ul className="space-y-2.5">
                    {data.overrideRate.topReasons.map((r, i) => (
                      <li key={i} className="flex items-center justify-between rounded-lg border bg-muted/20 p-2.5 text-xs">
                        <span className="text-foreground font-medium">{r.reason}</span>
                        <span className="rounded bg-primary/10 px-2 py-0.5 font-bold text-primary">
                          {r.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Aucun motif enregistré sur cette plage.
                  </p>
                )}
              </div>
            </Card>
          </div>

          {/* Section 3: Distribution by Commune and Authority */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="p-5 shadow-xs">
              <div className="flex items-center justify-between border-b pb-3">
                <div>
                  <h3 className="font-semibold text-foreground">Incidents par commune (حسب البلدية)</h3>
                  <p className="text-xs text-muted-foreground">Concentration géographique (Wilaya d'Alger)</p>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">
                  {data.byCommune.length} communes actives
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                {data.byCommune.map((c, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border p-2 text-xs">
                    <span className="truncate font-medium text-foreground">{c.commune}</span>
                    <span className="ml-2 font-bold text-primary">{c.count}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5 shadow-xs">
              <div className="flex items-center justify-between border-b pb-3">
                <div>
                  <h3 className="font-semibold text-foreground">Répartition par autorité (حسب الهيئة)</h3>
                  <p className="text-xs text-muted-foreground">Notification des forces de sécurité et secours</p>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">
                  {data.byAuthority.length} corps
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {data.byAuthority.map((a, i) => {
                  const pct = data.summary.totalIncidents > 0 ? Math.round((a.count / data.summary.totalIncidents) * 100) : 0;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground">{a.authority}</span>
                        <span className="font-semibold text-muted-foreground">
                          {a.count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div style={{ width: `${pct}%` }} className="h-full bg-primary" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
