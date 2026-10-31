import {
  NEED_LABELS,
  route,
  type HospitalMatch,
  type LatLng,
  type MatchHospital,
  type Need,
  type Recommendation,
  type RoadGraph,
} from "@solvex-dergana/shared";
import { Button } from "@solvex-dergana/ui/components/button";
import { Label } from "@solvex-dergana/ui/components/label";
import { Textarea } from "@solvex-dergana/ui/components/textarea";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { CheckIcon, CircleAlertIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useId, useMemo } from "react";

import { timeAgo } from "@/lib/time";

import { RouteMap } from "./route-map";

const TIER_LABELS: Record<MatchHospital["tier"], string> = {
  chu: "CHU",
  ehs: "EHS",
  eph: "EPH",
  epsp_polyclinic: "Polyclinique",
};

const minutes = (value: number) => `${Math.max(1, Math.round(value))} min`;
const km = (metres: number) => `${(metres / 1000).toFixed(1).replace(".", ",")} km`;
const decimal = (value: number) => (Math.round(value * 10) / 10).toString().replace(".", ",");

/** Consecutive pieces of the same road become one line of the step list. */
function mergeSteps(steps: { name: string | null; distanceM: number; durationS: number }[]) {
  const merged: { name: string; distanceM: number; durationS: number }[] = [];
  for (const step of steps) {
    const name = step.name ?? "Route sans nom";
    const last = merged.at(-1);
    if (last && last.name === name) {
      last.distanceM += step.distanceM;
      last.durationS += step.durationS;
    } else {
      merged.push({ name, distanceM: step.distanceM, durationS: step.durationS });
    }
  }
  return merged;
}

function NeedChip({ need, state }: { need: Need; state: "matched" | "missing" | "diverting" | "preferred-missing" | "preferred-matched" }) {
  const styles = {
    matched: "border-sev-green/40 bg-sev-green-soft text-sev-green",
    "preferred-matched": "border-sev-green/40 bg-sev-green-soft text-sev-green",
    missing: "border-sev-red/40 bg-sev-red-soft text-sev-red",
    diverting: "border-sev-yellow/40 bg-sev-yellow-soft text-sev-yellow",
    "preferred-missing": "border-input bg-muted text-muted-foreground",
  }[state];
  const Icon = state === "matched" || state === "preferred-matched" ? CheckIcon : state === "diverting" ? TriangleAlertIcon : XIcon;
  const suffix = {
    matched: "",
    "preferred-matched": " (souhaité)",
    missing: " : manque",
    diverting: " : en détournement",
    "preferred-missing": " (souhaité) : manque",
  }[state];
  return (
    <li className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold", styles)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {NEED_LABELS[need]}
      {suffix}
    </li>
  );
}

function HospitalCard({
  rank,
  match,
  hospital,
  recommended,
  chosen,
  onChoose,
}: {
  rank: number;
  match: HospitalMatch;
  hospital: MatchHospital;
  recommended: boolean;
  chosen: boolean;
  onChoose: () => void;
}) {
  const { etaMin, missingPenaltyMin, divertPenaltyMin } = match.scoreBreakdown;
  return (
    <li className={cn("rounded-lg border bg-card p-3", chosen ? "border-primary ring-2 ring-primary/30" : "")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <span className="tabular font-mono text-muted-foreground">{rank}.</span>
            {hospital.name}
            <span className="rounded-md border px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">{TIER_LABELS[hospital.tier]}</span>
            {recommended && (
              <span className="rounded-md border border-primary/40 bg-accent px-1.5 py-0.5 text-xs font-bold text-accent-foreground">Recommandé</span>
            )}
          </p>
          <p className="mt-0.5 text-sm">
            <span className="tabular font-mono text-lg font-bold">{minutes(etaMin)}</span>{" "}
            <span className="text-muted-foreground">· {km(match.distanceM)}</span>{" "}
            {match.etaSource === "straight_line" ? (
              <span className="rounded-md border border-emulation/40 bg-emulation-soft px-1.5 py-0.5 text-xs font-bold text-emulation">
                Estimation en ligne droite
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">par la route</span>
            )}
          </p>
        </div>
        <Button type="button" variant={chosen ? "default" : "outline"} size="lg" aria-pressed={chosen} onClick={onChoose}>
          {chosen ? <CheckIcon aria-hidden="true" /> : null}
          {chosen ? "Retenu" : "Choisir"}
        </Button>
      </div>

      {match.flags.includes("secondary_transfer_risk") && (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-sev-yellow">
          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
          Transfert secondaire probable :{" "}
          {match.missing.length > 0
            ? `il manque ${match.missing.map((need) => NEED_LABELS[need]).join(", ")}.`
            : `${match.diverting.map((need) => NEED_LABELS[need]).join(", ")} en détournement.`}
        </p>
      )}
      {match.flags.includes("declined") && (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-sev-red">
          <XIcon className="size-4 shrink-0" aria-hidden="true" />
          A dérouté ce patient.
        </p>
      )}
      {match.flags.includes("stabilisation_only") && (
        <p className="mt-2 text-sm text-muted-foreground">Structure de stabilisation uniquement.</p>
      )}

      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Capacités">
        {match.matched.map((need) => (
          <NeedChip key={need} need={need} state={match.diverting.includes(need) ? "diverting" : "matched"} />
        ))}
        {match.missing.map((need) => (
          <NeedChip key={need} need={need} state="missing" />
        ))}
        {match.preferredMatched.map((need) => (
          <NeedChip key={need} need={need} state="preferred-matched" />
        ))}
        {match.preferredMissing.map((need) => (
          <NeedChip key={need} need={need} state="preferred-missing" />
        ))}
      </ul>

      <p className="tabular mt-2 font-mono text-xs text-muted-foreground">
        Score {decimal(match.score)} = {decimal(etaMin)} (trajet) + {decimal(missingPenaltyMin)} ({match.missing.length} manquant
        {match.missing.length > 1 ? "s" : ""}) + {decimal(divertPenaltyMin)} ({match.diverting.length} détournement
        {match.diverting.length > 1 ? "s" : ""})
      </p>
    </li>
  );
}

/** The ranked hospitals, the choice, and the route to the retained hospital. Everything is computed here, offline. */
export function OrientationPanel({
  orientation,
  hospitals,
  scene,
  graph,
  chosenId,
  overrideReason,
  onChoose,
  onReason,
  cache,
}: {
  orientation: Recommendation;
  hospitals: MatchHospital[];
  scene: LatLng;
  graph: RoadGraph | null | "error";
  chosenId: string | null;
  overrideReason: string;
  onChoose: (hospitalId: string | null) => void;
  onReason: (reason: string) => void;
  /** Set when the hospital list comes from the browser's memory instead of the server. */
  cache: { savedAt: number } | null;
}) {
  const reasonId = useId();
  const { needs, ...result } = orientation;
  const byId = new Map(hospitals.map((h) => [h.id, h]));
  const recommendedId = result.recommended?.hospitalId ?? null;
  const focusId = chosenId ?? recommendedId;
  const focus = focusId ? byId.get(focusId) : undefined;
  const overriding = chosenId !== null && chosenId !== recommendedId;

  const road = useMemo(
    () => (graph && graph !== "error" && focus ? route(graph, scene, [focus.lat, focus.lng]) : null),
    [graph, scene, focus],
  );
  const steps = road ? mergeSteps(road.steps) : [];

  return (
    <div className="flex flex-col gap-4">
      {cache && (
        <p role="status" className="flex items-center gap-1.5 text-sm font-semibold text-sev-yellow">
          <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
          Hors ligne : état des hôpitaux connu {timeAgo(new Date(cache.savedAt))}. Vérifiez par téléphone en cas de doute.
        </p>
      )}

      <div>
        <h3 className="text-sm font-bold">Besoins de la victime</h3>
        {needs.required.length === 0 && needs.preferred.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun besoin particulier : l'hôpital le plus proche convient.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-0.5 text-sm">
            {needs.reasons.map((reason, i) => (
              <li key={`${reason.need}-${i}`}>
                <span className="font-semibold">{NEED_LABELS[reason.need]}</span>
                <span className="text-muted-foreground"> · {reason.why}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {result.stabiliseFirst && result.stabilisation && (
        <div role="alert" className="rounded-lg border-2 border-sev-yellow bg-sev-yellow-soft px-3 py-2">
          <p className="flex items-center gap-2 text-sm font-bold text-sev-yellow">
            <TriangleAlertIcon className="size-5 shrink-0" aria-hidden="true" />
            Stabiliser d'abord
          </p>
          <p className="text-sm">
            Le meilleur hôpital est à {minutes(result.recommended!.etaMin)} et la victime est en état de choc. Structure de stabilisation la plus proche :{" "}
            <strong>{byId.get(result.stabilisation.hospitalId)?.name}</strong> à {minutes(result.stabilisation.etaMin)}.
          </p>
        </div>
      )}
      {!result.stabiliseFirst && result.stabilisation && (
        <p className="text-sm">
          Structure de stabilisation la plus proche : <strong>{byId.get(result.stabilisation.hospitalId)?.name}</strong> à{" "}
          {minutes(result.stabilisation.etaMin)}.
        </p>
      )}

      {result.ranking.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun hôpital connu.</p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Hôpitaux classés">
          {result.ranking.map((match, i) => (
            <HospitalCard
              key={match.hospitalId}
              rank={i + 1}
              match={match}
              hospital={byId.get(match.hospitalId)!}
              recommended={match.hospitalId === recommendedId}
              chosen={match.hospitalId === chosenId}
              onChoose={() => onChoose(match.hospitalId === chosenId ? null : match.hospitalId)}
            />
          ))}
        </ol>
      )}

      {result.ranking.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border bg-raised p-3">
          {recommendedId ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="lg" onClick={() => onChoose(recommendedId)} disabled={chosenId === recommendedId}>
                <CheckIcon aria-hidden="true" />
                {chosenId === recommendedId ? "Recommandé confirmé" : "Confirmer le recommandé"}
              </Button>
              <p className="text-sm text-muted-foreground">ou choisissez un autre hôpital dans la liste, en indiquant le motif.</p>
            </div>
          ) : (
            <p className="text-sm font-semibold">
              Aucun hôpital ne peut être recommandé pour cette victime : choisissez un hôpital dans la liste, en indiquant le motif.
            </p>
          )}
          {overriding && (
            <div>
              <Label htmlFor={reasonId} className="mb-1.5 block text-sm font-semibold">
                Motif du choix d'un autre hôpital (obligatoire)
              </Label>
              <Textarea
                id={reasonId}
                value={overrideReason}
                onChange={(event) => onReason(event.target.value)}
                aria-required="true"
                aria-describedby={`${reasonId}-help`}
                maxLength={300}
                placeholder="Ex. : famille sur place, hôpital recommandé saturé…"
              />
              <p id={`${reasonId}-help`} className="mt-1 text-xs text-muted-foreground">
                Le motif est enregistré avec la recommandation du système.
              </p>
            </div>
          )}
        </div>
      )}

      {focus && (
        <div>
          <h3 className="mb-2 text-sm font-bold">Itinéraire vers {focus.name}</h3>
          {graph === null && <p className="text-sm text-muted-foreground">Chargement du réseau routier…</p>}
          {graph === "error" && <p role="alert" className="text-sm text-destructive">Le réseau routier n'a pas pu être chargé.</p>}
          {graph && graph !== "error" && !road && (
            <p className="text-sm text-muted-foreground">
              Aucun itinéraire routier calculable (position hors du réseau cartographié) : seule l'estimation en ligne droite est affichée.
            </p>
          )}
          {road && (
            <>
              <RouteMap
                polyline={road.polyline}
                from={scene}
                to={[focus.lat, focus.lng]}
                fromLabel="Scène"
                toLabel={focus.shortName}
                description={`Itinéraire de la scène à ${focus.name} : ${km(road.distanceM)}, environ ${minutes(road.durationS / 60)}`}
              />
              <p className="mt-2 text-sm font-semibold">
                {km(road.distanceM)} · environ {minutes(road.durationS / 60)}
              </p>
              <ol className="mt-1 flex flex-col gap-0.5 text-sm">
                {steps.map((step, i) => (
                  <li key={i} className="flex justify-between gap-3 border-b border-dashed py-1 last:border-0">
                    <span>{step.name}</span>
                    <span className="tabular font-mono text-muted-foreground">
                      {km(step.distanceM)} · {minutes(step.durationS / 60)}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Itinéraire calculé localement (A*, OSM) — sans trafic en temps réel. Données © contributeurs OpenStreetMap (ODbL).
          </p>
        </div>
      )}
    </div>
  );
}
