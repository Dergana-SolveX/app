import { Button } from "@solvex-dergana/ui/components/button";
import { SeverityBadge } from "@solvex-dergana/ui/components/severity-badge";
import { Skeleton } from "@solvex-dergana/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpIcon, PhoneIcon, SirenIcon } from "lucide-react";

import { evaluationView } from "@/lib/evaluation";
import { trpc } from "@/utils/trpc";

const SEVERITY_WORD = { red: "rouge", yellow: "jaune", green: "vert", unknown: "inconnue" } as const;

/**
 * The dispatcher's evaluation card (FR-S5-02): severity, the reasons behind it, the recommended units
 * and authority. Everything here is a recommendation; the dispatch decision is a separate human action.
 */
export default function EvaluationCard({ incidentId }: { incidentId: string }) {
  const query = useQuery(trpc.incidents.byId.queryOptions({ id: incidentId }));

  if (query.isPending) return <Skeleton className="h-48 w-full" aria-hidden="true" />;

  if (query.isError || !query.data) {
    return (
      <div role="alert" className="rounded-lg border border-sev-red/40 bg-sev-red-soft p-4 text-sev-red">
        <p className="font-semibold">Évaluation indisponible.</p>
        <Button variant="outline" className="mt-3" onClick={() => query.refetch()}>
          Réessayer
        </Button>
      </div>
    );
  }

  const view = evaluationView(query.data);
  // New information after the dispatch raised the severity: a suggestion only, nothing was changed.
  const escalationTo = query.data.escalation?.to ?? null;

  return (
    <article aria-label={`Évaluation, gravité ${SEVERITY_WORD[view.severity]}`} className="space-y-4 rounded-lg border bg-card p-4">
      <header className="flex flex-wrap items-center gap-3">
        <SeverityBadge severity={view.severity} />
        <h3 className="text-base font-bold">{view.headline}</h3>
        <span className="ms-auto text-xs font-semibold text-muted-foreground uppercase">Recommandation automatique</span>
      </header>

      {escalationTo && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-sev-red/40 bg-sev-red-soft p-3 text-sm text-sev-red">
          <ArrowUpIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            <strong>Nouvelles informations :</strong> la gravité recommandée passerait à{" "}
            <strong>{SEVERITY_WORD[escalationTo]}</strong>. Le dispatch déjà décidé n'a pas été modifié.
          </p>
        </div>
      )}

      <section aria-labelledby={`reasons-${incidentId}`}>
        <h4 id={`reasons-${incidentId}`} className="mb-1 text-sm font-bold">
          Pourquoi
        </h4>
        <ul className="space-y-1 text-sm">
          {view.reasons.map((reason) => (
            <li key={reason.fr}>
              {reason.fr}
              {/* Arabic is secondary: shown right-to-left under the French line. */}
              <span lang="ar" dir="rtl" className="block text-muted-foreground">
                {reason.ar}
              </span>
            </li>
          ))}
          {view.reasons.length === 0 && <li className="text-muted-foreground">Aucune règle déclenchée.</li>}
        </ul>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section aria-labelledby={`units-${incidentId}`}>
          <h4 id={`units-${incidentId}`} className="mb-1 flex items-center gap-1.5 text-sm font-bold">
            <SirenIcon className="size-4" aria-hidden="true" />
            Moyens recommandés
          </h4>
          {view.units.length > 0 ? (
            <ul className="list-disc ps-5 text-sm">
              {view.units.map((unit) => (
                <li key={unit.name}>
                  {unit.name}
                  {unit.reason && <span className="text-muted-foreground"> — {unit.reason}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun moyen recommandé : à qualifier.</p>
          )}
        </section>

        <section aria-labelledby={`authority-${incidentId}`}>
          <h4 id={`authority-${incidentId}`} className="mb-1 flex items-center gap-1.5 text-sm font-bold">
            <PhoneIcon className="size-4" aria-hidden="true" />
            Autorité à prévenir
          </h4>
          {view.authority ? (
            <p className="text-sm">
              {view.authority.name} <span className="font-mono text-muted-foreground">({view.authority.phones})</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Position inconnue : autorité non déterminée.</p>
          )}
        </section>
      </div>

      {view.vittel.length > 0 && (
        <section aria-labelledby={`vittel-${incidentId}`}>
          <h4 id={`vittel-${incidentId}`} className="mb-1 text-sm font-bold">
            Vittel pré-rempli <span className="font-normal text-muted-foreground">(à confirmer par le secouriste)</span>
          </h4>
          <ul className="space-y-1 text-sm">
            {view.vittel.map((item) => (
              <li key={`${item.level}-${item.label}`}>
                <span className="font-semibold">{item.level}</span> · {item.label}{" "}
                <span className="text-muted-foreground">— {item.source}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
