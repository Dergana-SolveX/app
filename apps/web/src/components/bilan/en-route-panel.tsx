import { NEED_LABELS, type Need } from "@solvex-dergana/shared";
import { Button } from "@solvex-dergana/ui/components/button";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ActivityIcon, CheckIcon, CircleAlertIcon, LoaderCircleIcon, RadioIcon, SendIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { NumberStepper } from "@/components/bilan/controls";
import { timeAgo } from "@/lib/time";
import { trpc } from "@/utils/trpc";

export type HandoverView = {
  id: string;
  hospitalId: string;
  status: "pending" | "accepted" | "diverted";
  divertSpecialty: string | null;
  createdAt: Date | string;
  smsFallbackSentAt?: string | null;
};

const minutes = (value: number) => `${Math.max(1, Math.round(value))} min`;

/**
 * Where the handover stands (PRD FR-S6-05): waiting, accepted, or diverted with the next best hospital already
 * chosen. The send button is the one tap that confirms the destination and warns the hospital.
 * Also offers in-transit vitals updates ("Mettre à jour constantes").
 */
export function EnRoutePanel({
  chosen,
  handovers,
  names,
  nextBest,
  sending,
  canSend,
  onSend,
  now,
  assessmentId,
  initialVitals,
}: {
  /** The hospital currently retained, if any. */
  chosen: { id: string; name: string } | null;
  handovers: HandoverView[];
  names: Map<string, string>;
  /** The recommended hospital once the ones that diverted are left out. */
  nextBest: { name: string; etaMin: number } | null;
  sending: boolean;
  canSend: boolean;
  onSend: () => void;
  now: Date;
  assessmentId?: string | null;
  initialVitals?: {
    hr?: number | null;
    sbp?: number | null;
    dbp?: number | null;
    spo2?: number | null;
    gcs?: number | null;
    rr?: number | null;
  };
}) {
  const queryClient = useQueryClient();
  const latest = handovers.at(-1);
  const nameOf = (id: string) => names.get(id) ?? "L'hôpital";
  const toChosen = chosen ? handovers.filter((h) => h.hospitalId === chosen.id) : [];
  const live = toChosen.find((h) => h.status === "pending" || h.status === "accepted");

  const [editingVitals, setEditingVitals] = useState(false);
  const [hr, setHr] = useState<number | null>(initialVitals?.hr ?? null);
  const [sbp, setSbp] = useState<number | null>(initialVitals?.sbp ?? null);
  const [dbp, setDbp] = useState<number | null>(initialVitals?.dbp ?? null);
  const [spo2, setSpo2] = useState<number | null>(initialVitals?.spo2 ?? null);
  const [gcs, setGcs] = useState<number | null>(initialVitals?.gcs ?? null);

  const updateVitalsMutation = useMutation(
    trpc.handovers.updateVitals.mutationOptions({
      onSuccess: () => {
        toast.success("Constantes transmises à l'hôpital");
        setEditingVitals(false);
        queryClient.invalidateQueries();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const handlePushVitals = () => {
    if (!assessmentId) return;
    updateVitalsMutation.mutate({
      assessmentId,
      vitals: {
        hr: hr ?? undefined,
        sbp: sbp ?? undefined,
        dbp: dbp ?? undefined,
        spo2: spo2 ?? undefined,
        gcs: gcs ?? undefined,
      },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {latest?.status === "diverted" && (
        <div role="alert" className="rounded-lg border-2 border-sev-red bg-sev-red-soft px-3 py-2">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase text-sev-red">
            <CircleAlertIcon className="size-5 shrink-0" aria-hidden="true" />
            {nameOf(latest.hospitalId)} a dérouté le patient
          </p>
          <p className="text-sm">
            Spécialité indisponible :{" "}
            <strong>{NEED_LABELS[latest.divertSpecialty as Need] ?? latest.divertSpecialty ?? "non précisée"}</strong>.{" "}
            {nextBest ? (
              <>
                Prochain meilleur hôpital présélectionné : <strong>{nextBest.name}</strong>, à {minutes(nextBest.etaMin)}. Le nouvel itinéraire est affiché plus bas.
              </>
            ) : (
              "Aucun autre hôpital ne peut être recommandé : choisissez-en un dans la liste, en indiquant le motif."
            )}
          </p>
        </div>
      )}

      {latest?.status === "pending" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sev-yellow/40 bg-sev-yellow-soft px-3 py-2 text-sm">
          <p role="status" className="flex items-center gap-2 font-semibold text-sev-yellow">
            <LoaderCircleIcon className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            En attente de la réponse de {nameOf(latest.hospitalId)} · envoyé {timeAgo(latest.createdAt, now)}
          </p>
          {latest.smsFallbackSentAt && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300">
              <RadioIcon className="size-3" aria-hidden="true" />
              Envoyé aussi par SMS
            </span>
          )}
        </div>
      )}

      {latest?.status === "accepted" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sev-green/40 bg-sev-green-soft px-3 py-2 text-sm font-bold text-sev-green">
          <p role="status" className="flex items-center gap-2">
            <CheckIcon className="size-4 shrink-0" aria-hidden="true" />
            {nameOf(latest.hospitalId)} a accepté : en route
          </p>
          {latest.smsFallbackSentAt && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300">
              <RadioIcon className="size-3" aria-hidden="true" />
              Envoyé aussi par SMS
            </span>
          )}
        </div>
      )}

      {/* Button to update vitals in transit (PRD FR-S6-05) */}
      {live && assessmentId && (
        <div className="mt-1">
          {!editingVitals ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setHr(initialVitals?.hr ?? null);
                setSbp(initialVitals?.sbp ?? null);
                setDbp(initialVitals?.dbp ?? null);
                setSpo2(initialVitals?.spo2 ?? null);
                setGcs(initialVitals?.gcs ?? null);
                setEditingVitals(true);
              }}
              className="gap-2 font-semibold"
            >
              <ActivityIcon className="size-4" aria-hidden="true" />
              Mettre à jour constantes
            </Button>
          ) : (
            <div className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <ActivityIcon className="size-4 text-primary" aria-hidden="true" />
                  Mettre à jour les constantes en route
                </h3>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditingVitals(false)}>
                  <XIcon className="size-4" aria-hidden="true" />
                  <span className="sr-only">Fermer</span>
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                <NumberStepper label="FC" unit="bpm" value={hr} min={20} max={250} step={5} fallback={80} onChange={setHr} />
                <NumberStepper label="PAS" unit="mmHg" value={sbp} min={30} max={300} step={5} fallback={120} onChange={setSbp} />
                <NumberStepper label="PAD" unit="mmHg" value={dbp} min={20} max={200} step={5} fallback={80} onChange={setDbp} />
                <NumberStepper label="SpO2" unit="%" value={spo2} min={50} max={100} step={1} fallback={98} onChange={setSpo2} />
                <NumberStepper label="Glasgow (GCS)" value={gcs} min={3} max={15} step={1} fallback={15} onChange={setGcs} />
              </div>

              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={handlePushVitals}
                  disabled={updateVitalsMutation.isPending}
                >
                  {updateVitalsMutation.isPending ? "Transmission…" : "Transmettre à l'hôpital"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditingVitals(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {chosen && !live && (
        <div>
          <Button type="button" size="lg" className="w-full sm:w-auto" onClick={onSend} disabled={sending || !canSend}>
            {sending ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <SendIcon aria-hidden="true" />}
            {sending ? "Envoi…" : `Envoyer l'AT-MIST à ${chosen.name}`}
          </Button>
          <p className={cn("mt-1 text-xs text-muted-foreground", canSend && "sr-only")}>
            Indiquez le motif du choix pour pouvoir envoyer.
          </p>
        </div>
      )}
    </div>
  );
}
