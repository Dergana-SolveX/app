import { NEED_LABELS, NEEDS, type AtMist, type Need } from "@solvex-dergana/shared";
import { Button } from "@solvex-dergana/ui/components/button";
import { Skeleton } from "@solvex-dergana/ui/components/skeleton";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import {
  ActivityIcon,
  AmbulanceIcon,
  CheckIcon,
  CircleAlertIcon,
  ClockIcon,
  InboxIcon,
  RadioIcon,
  XIcon,
} from "lucide-react";
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
  smsFallbackSentAt?: string | null;
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
            {handover.smsFallbackSentAt && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-bold tracking-wide text-amber-700 dark:text-amber-300">
                <RadioIcon className="size-3.5" aria-hidden="true" />
                Envoyé aussi par SMS
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
            {atmist.injuries.length ? atmist.injuries.join(", ") : "non précisées"}
          </Line>
        </dl>
        <dl>
          <Line letter="S" label="Constantes">
            <span className="flex flex-wrap items-center gap-2">
              <span>{vitals.length ? vitals.join(" · ") : "non mesurées"}</span>
              {signs.shockIndex && <ShockIndexBadge result={signs.shockIndex} />}
            </span>
          </Line>
          <Line letter="T" label="Traitements">
            {atmist.treatments.length ? atmist.treatments.join(", ") : "aucun"}
          </Line>
          {(atmist.bloodType || (atmist.allergies && atmist.allergies.length > 0)) && (
            <Line letter="P" label="Profil">
              {[
                atmist.bloodType && `Groupe ${atmist.bloodType}`,
                atmist.allergies && atmist.allergies.length > 0 && `allergies : ${atmist.allergies.join(", ")}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Line>
          )}
          {atmist.prep.length > 0 && (
            <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
              <p className="font-extrabold text-primary uppercase tracking-wide">À préparer :</p>
              <ul className="mt-1 list-disc list-inside space-y-0.5">
                {atmist.prep.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </dl>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div>
          {handover.status === "accepted" && (
            <p className="flex items-center gap-1.5 text-sm font-bold text-sev-green">
              <CheckIcon className="size-4" aria-hidden="true" />
              Transfert accepté · équipe prévenue
            </p>
          )}
          {handover.status === "diverted" && (
            <p className="flex items-center gap-1.5 text-sm font-bold text-sev-red">
              <CircleAlertIcon className="size-4" aria-hidden="true" />
              Dérouté · spécialité : {NEED_LABELS[handover.divertSpecialty as Need] ?? handover.divertSpecialty}
            </p>
          )}
        </div>

        {pending && !diverting && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="lg"
              variant="default"
              disabled={respond.isPending}
              onClick={() => respond.mutate({ handoverId: handover.id, decision: "accept" })}
            >
              <CheckIcon aria-hidden="true" />
              Accepter
            </Button>
            <Button type="button" size="lg" variant="destructive" onClick={() => setDiverting(true)}>
              <XIcon aria-hidden="true" />
              Dériver
            </Button>
          </div>
        )}

        {pending && diverting && (
          <fieldset className="w-full space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <legend className="text-sm font-bold text-destructive">
              Précisez la spécialité saturée ou indisponible (obligatoire) :
            </legend>
            <div className="flex flex-wrap gap-2">
              {NEEDS.map((need) => (
                <ToggleChip
                  key={need}
                  label={NEED_LABELS[need]}
                  pressed={specialty === need}
                  onPressedChange={(on) => setSpecialty(on ? need : null)}
                />
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

/** The hospital's arrivals board: incoming AT-MIST cards, live, with Accept / Divert and specialty toggles (PRD FR-S7-01, FR-S7-02, FR-S7-03). */
export default function HospitalBoard({ hospitalId }: { hospitalId: string }) {
  const queryClient = useQueryClient();
  const now = useNow(1_000);
  const hospital = useQuery(trpc.hospitals.byId.queryOptions({ hospitalId }));
  const incoming = useQuery(trpc.handovers.incoming.queryOptions({ hospitalId }));

  const updateStatus = useMutation(
    trpc.hospitals.updateStatus.mutationOptions({
      onSuccess: () => {
        toast.success("Disponibilité mise à jour");
        queryClient.invalidateQueries({ queryKey: trpc.hospitals.byId.queryKey({ hospitalId }) });
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  // Snapshot + stream: on `ready`, `resync` and every event, fetch the list and hospital state again.
  const stream = useSubscription(
    trpc.handovers.onHospital.subscriptionOptions(
      { hospitalId },
      {
        onData: () => {
          queryClient.invalidateQueries({ queryKey: trpc.handovers.incoming.queryKey({ hospitalId }) });
          queryClient.invalidateQueries({ queryKey: trpc.hospitals.byId.queryKey({ hospitalId }) });
        },
      },
    ),
  );

  const waiting = (incoming.data ?? []).filter((h) => h.status === "pending").length;

  return (
    <section aria-labelledby="arrivals-title" className="p-4 md:p-6">
      {/* Specialty availability toggle bar (PRD FR-S7-02) */}
      {hospital.isSuccess && (
        <div className="mb-6 rounded-lg border bg-card p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-extrabold flex items-center gap-2">
                <span>{hospital.data.name}</span>
                <span className="text-xs font-normal text-muted-foreground uppercase tracking-wider">
                  ({hospital.data.commune})
                </span>
              </h2>
              <p className="text-xs text-muted-foreground">
                Disponibilité des spécialités · Les détournements sont répercutés instantanément sur les tablettes ambulances
                {hospital.data.statusUpdatedAt && ` · modifié ${timeAgo(hospital.data.statusUpdatedAt, now)}`}
              </p>
            </div>
            {hospital.data.staleDivert && (
              <div
                role="alert"
                className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-700 dark:text-amber-300"
              >
                <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
                Détournement actif depuis plus de 6 h — Confirmez-vous le statut ?
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {NEEDS.filter((need) => hospital.data.capabilities[need]).map((need) => {
              const isDiverted = hospital.data.status[need] === "divert";
              return (
                <button
                  key={need}
                  type="button"
                  onClick={() =>
                    updateStatus.mutate({
                      hospitalId,
                      specialty: need,
                      status: isDiverted ? "accept" : "divert",
                    })
                  }
                  disabled={updateStatus.isPending}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-bold transition-colors duration-150 outline-none cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2",
                    isDiverted
                      ? "border-sev-red bg-sev-red-soft text-sev-red"
                      : "border-input bg-card hover:border-primary/60 text-foreground",
                  )}
                >
                  <span className={cn("size-2 rounded-full", isDiverted ? "bg-sev-red" : "bg-sev-green")} />
                  {NEED_LABELS[need]}
                  <span className="font-mono text-[10px] uppercase opacity-75">
                    {isDiverted ? "Dérouté" : "Accepte"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
