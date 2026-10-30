import { NEED_LABELS, NEEDS, type AtMist, type Need } from "@solvex-dergana/shared";
import { Button } from "@solvex-dergana/ui/components/button";
import { Skeleton } from "@solvex-dergana/ui/components/skeleton";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { AmbulanceIcon, CheckIcon, CircleAlertIcon, ClockIcon, InboxIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ShockIndexBadge } from "@/components/bilan/shock-index-badge";
import { ToggleChip } from "@/components/bilan/controls";
import LiveStatus from "@/components/live-status";
import { arrivalCountdown } from "@/lib/arrival";
import { timeAgo } from "@/lib/time";
import { trpc } from "@/utils/trpc";

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const SEX = { male: "H", female: "F", unknown: "" } as const;

/** A line of the AT-MIST: the letter that names the part, then what the medic reported. */
function Line({ letter, label, children }: { letter: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5 text-sm">
      <dt className="flex w-24 shrink-0 items-baseline gap-1.5 text-muted-foreground">
        <span className="tabular w-4 font-mono text-base font-extrabold text-foreground" aria-hidden="true">
          {letter}
        </span>
        {label}
      </dt>
      <dd className="min-w-0 font-semibold">{children}</dd>
    </div>
  );
}

type Incoming = {
  id: string;
  status: "pending" | "accepted" | "diverted";
  atmist: Record<string, unknown>;
  etaMin: number | null;
  createdAt: string;
  respondedAt: Date | string | null;
  divertSpecialty: string | null;
};

function HandoverCard({ handover, now, hospitalId }: { handover: Incoming; now: Date; hospitalId: string }) {
  const atmist = handover.atmist as unknown as AtMist;
  const queryClient = useQueryClient();
  const [diverting, setDiverting] = useState(false);
  const [specialty, setSpecialty] = useState<Need | null>(null);

  const respond = useMutation(
    trpc.handovers.respond.mutationOptions({
      onSuccess: (answer) => {
        toast.success(answer.status === "accepted" ? "Transfert accepté" : "Transfert dérouté");
        setDiverting(false);
        queryClient.invalidateQueries({ queryKey: trpc.handovers.incoming.queryKey({ hospitalId }) });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const countdown = arrivalCountdown(handover.createdAt, handover.etaMin, now);
  const { signs } = atmist;
  const pending = handover.status === "pending";
  const vitals = [
    signs.hr !== null && `FC ${signs.hr}`,
    signs.sbp !== null && `PAS ${signs.sbp}${signs.dbp !== null ? `/${signs.dbp}` : ""}`,
    signs.spo2 !== null && `SpO2 ${signs.spo2} %`,
    signs.rr !== null && `FR ${signs.rr}`,
    signs.gcs !== null && `Glasgow ${signs.gcs}`,
  ].filter(Boolean);

  return (
    <li className={cn("rounded-lg border bg-card p-4", pending && "border-primary/60 ring-2 ring-primary/20")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-2 text-base font-extrabold">
            <AmbulanceIcon className="size-5 text-primary" aria-hidden="true" />
            {atmist.unit} · victime {atmist.victimIndex}
            {atmist.severe && (
              <span className="inline-flex items-center gap-1 rounded-md border border-sev-red/40 bg-sev-red-soft px-2 py-0.5 text-xs font-bold tracking-wide text-sev-red uppercase">
                <CircleAlertIcon className="size-3.5" aria-hidden="true" />
                Traumatisé grave
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">Envoyé {timeAgo(handover.createdAt, now)}</p>
        </div>
        {countdown && (
          <div className="text-end" role="timer" aria-label="Arrivée estimée">
            <p className="flex items-center justify-end gap-1 text-xs font-semibold text-muted-foreground">
              <ClockIcon className="size-3.5" aria-hidden="true" />
              {countdown.late ? "Retard sur l'arrivée" : "Arrivée dans"}
            </p>
            <p className={cn("tabular font-mono text-2xl font-extrabold", countdown.late && "text-sev-yellow")}>{countdown.text}</p>
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <dl>
          <Line letter="A" label="Âge / sexe">
            {atmist.age !== null ? `${atmist.age} ans` : "âge inconnu"} {atmist.sex ? SEX[atmist.sex] : ""}
          </Line>
          <Line letter="T" label="Heure">
            {atmist.time}
          </Line>
          <Line letter="M" label="Mécanisme">
            {atmist.mechanism.length ? atmist.mechanism.join(", ") : "non précisé"}
          </Line>
          <Line letter="I" label="Lésions">
            {atmist.injuries.length ? atmist.injuries.join(", ") : "aucune signalée"}
          </Line>
          <Line letter="S" label="Signes">
            {vitals.length ? vitals.join(" · ") : "non mesurés"}
          </Line>
          <Line letter="T" label="Gestes">
            {atmist.treatments.length ? atmist.treatments.join(", ") : "aucun"}
          </Line>
        </dl>
        <div className="flex flex-col gap-2">
          <ShockIndexBadge result={signs.shockIndex} />
          {atmist.prep.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">À préparer</p>
              <ul className="flex flex-wrap gap-1.5">
                {atmist.prep.map((tag) => (
                  <li key={tag} className="rounded-md border border-primary/40 bg-accent px-2 py-1 text-sm font-semibold text-accent-foreground">
                    {tag}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(atmist.bloodType || atmist.allergies.length > 0) && (
            <p className="text-sm">
              {atmist.bloodType && (
                <>
                  Groupe <strong>{atmist.bloodType}</strong>
                </>
              )}
              {atmist.bloodType && atmist.allergies.length > 0 && " · "}
              {atmist.allergies.length > 0 && (
                <>
                  Allergies : <strong>{atmist.allergies.join(", ")}</strong>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 border-t pt-3">
        {!pending && (
          <p
            role="status"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-bold",
              handover.status === "accepted"
                ? "border-sev-green/40 bg-sev-green-soft text-sev-green"
                : "border-sev-yellow/40 bg-sev-yellow-soft text-sev-yellow",
            )}
          >
            {handover.status === "accepted" ? <CheckIcon className="size-4" aria-hidden="true" /> : <XIcon className="size-4" aria-hidden="true" />}
            {handover.status === "accepted"
              ? "Accepté"
              : `Dérouté : ${NEED_LABELS[handover.divertSpecialty as Need] ?? handover.divertSpecialty}`}
          </p>
        )}

        {pending && !diverting && (
          <div className="flex flex-wrap gap-3">
            <Button type="button" size="lg" onClick={() => respond.mutate({ handoverId: handover.id, decision: "accept" })} disabled={respond.isPending}>
              <CheckIcon aria-hidden="true" />
              Accepter
            </Button>
            <Button type="button" size="lg" variant="outline" onClick={() => setDiverting(true)} disabled={respond.isPending}>
              <XIcon aria-hidden="true" />
              Dérouter
            </Button>
          </div>
        )}

        {pending && diverting && (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-bold">Quelle spécialité ne peut pas être assurée ? (obligatoire)</legend>
            <div role="group" aria-label="Spécialité indisponible" className="flex flex-wrap gap-2">
              {NEEDS.map((need) => (
                <ToggleChip key={need} label={NEED_LABELS[need]} pressed={specialty === need} onPressedChange={() => setSpecialty(specialty === need ? null : need)} />
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                size="lg"
                variant="destructive"
                disabled={!specialty || respond.isPending}
                onClick={() => respond.mutate({ handoverId: handover.id, decision: "divert", specialty: specialty! })}
              >
                Confirmer le détournement
              </Button>
              <Button type="button" size="lg" variant="outline" onClick={() => setDiverting(false)}>
                Annuler
              </Button>
            </div>
          </fieldset>
        )}
      </div>
    </li>
  );
}

/** The hospital's arrivals board: incoming AT-MIST cards, live, with Accept / Divert (PRD FR-S7-01). */
export default function HospitalBoard({ hospitalId }: { hospitalId: string }) {
  const queryClient = useQueryClient();
  const now = useNow(1_000);
  const incoming = useQuery(trpc.handovers.incoming.queryOptions({ hospitalId }));

  // Snapshot + stream: on `ready`, `resync` and every event, fetch the list again.
  const stream = useSubscription(
    trpc.handovers.onHospital.subscriptionOptions(
      { hospitalId },
      { onData: () => queryClient.invalidateQueries({ queryKey: trpc.handovers.incoming.queryKey({ hospitalId }) }) },
    ),
  );

  const waiting = (incoming.data ?? []).filter((h) => h.status === "pending").length;

  return (
    <section aria-labelledby="arrivals-title" className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="arrivals-title" className="text-base font-bold">
            Arrivées annoncées
          </h2>
          <p role="status" className="text-sm text-muted-foreground">
            {incoming.isSuccess ? (waiting > 0 ? `${waiting} en attente de réponse` : "Aucun transfert en attente") : "Chargement…"}
          </p>
        </div>
        <LiveStatus status={stream.status} />
      </div>

      {incoming.isPending && (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      )}
      {incoming.isError && (
        <div role="alert" className="rounded-lg border border-sev-red/40 bg-sev-red-soft p-4 text-sev-red">
          <p className="font-semibold">Impossible de charger les arrivées.</p>
          <Button variant="outline" className="mt-3" onClick={() => incoming.refetch()}>
            Réessayer
          </Button>
        </div>
      )}
      {incoming.isSuccess && incoming.data.length === 0 && (
        <div className="grid place-items-center rounded-lg border border-dashed bg-card/60 px-6 py-14 text-center">
          <span className="mb-4 grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
            <InboxIcon className="size-6" aria-hidden="true" />
          </span>
          <p className="text-base font-bold">Aucune arrivée annoncée</p>
          <p className="mt-1 max-w-md text-muted-foreground">
            Quand une ambulance choisit cet hôpital, sa fiche AT-MIST apparaît ici en direct.
          </p>
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {incoming.data?.map((handover) => (
          <HandoverCard key={handover.id} handover={handover as Incoming} now={now} hospitalId={hospitalId} />
        ))}
      </ul>
    </section>
  );
}
