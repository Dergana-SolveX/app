import { NEED_LABELS, type Need } from "@solvex-dergana/shared";
import { Button } from "@solvex-dergana/ui/components/button";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { CheckIcon, CircleAlertIcon, LoaderCircleIcon, SendIcon } from "lucide-react";

import { timeAgo } from "@/lib/time";

export type HandoverView = {
  id: string;
  hospitalId: string;
  status: "pending" | "accepted" | "diverted";
  divertSpecialty: string | null;
  createdAt: Date | string;
};

const minutes = (value: number) => `${Math.max(1, Math.round(value))} min`;

/**
 * Where the handover stands (PRD FR-S6-05): waiting, accepted, or diverted with the next best hospital already
 * chosen. The send button is the one tap that confirms the destination and warns the hospital.
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
}) {
  const latest = handovers.at(-1);
  const nameOf = (id: string) => names.get(id) ?? "L'hôpital";
  const toChosen = chosen ? handovers.filter((h) => h.hospitalId === chosen.id) : [];
  const live = toChosen.find((h) => h.status === "pending" || h.status === "accepted");

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
        <p role="status" className="flex items-center gap-2 rounded-lg border border-sev-yellow/40 bg-sev-yellow-soft px-3 py-2 text-sm font-semibold text-sev-yellow">
          <LoaderCircleIcon className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          En attente de la réponse de {nameOf(latest.hospitalId)} · envoyé {timeAgo(latest.createdAt, now)}
        </p>
      )}

      {latest?.status === "accepted" && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-sev-green/40 bg-sev-green-soft px-3 py-2 text-sm font-bold text-sev-green">
          <CheckIcon className="size-4 shrink-0" aria-hidden="true" />
          {nameOf(latest.hospitalId)} a accepté : en route
        </p>
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
