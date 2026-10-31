import { Button } from "@solvex-dergana/ui/components/button";
import { Checkbox } from "@solvex-dergana/ui/components/checkbox";
import { Label } from "@solvex-dergana/ui/components/label";
import { Skeleton } from "@solvex-dergana/ui/components/skeleton";
import { Textarea } from "@solvex-dergana/ui/components/textarea";
import { dispatchDiffers } from "@solvex-dergana/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon, SirenIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { incidentRef, timeAgo } from "@/lib/time";
import { trpc } from "@/utils/trpc";

const UNIT_NAMES: Record<string, string> = {
  ambulance_medicalisee: "Ambulance médicalisée",
  desincarceration: "Désincarcération",
  vsav_standard: "VSAV",
};

const distanceLabel = (metres: number | null) => (metres === null ? "distance inconnue" : `${(metres / 1000).toFixed(1)} km`);

/**
 * The dispatch decision (FR-S5-06). The form starts from the recommendation; approving it as it is takes one click,
 * and any difference needs a reason. The system recommends, the dispatcher decides (NFR-P1).
 */
export default function DispatchForm({ incidentId }: { incidentId: string }) {
  const queryClient = useQueryClient();
  const form = useQuery(trpc.dispatch.recommendation.queryOptions({ incidentId }));

  const [unitIds, setUnitIds] = useState<string[] | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  // The prefill is only a starting point: what the dispatcher changes is never overwritten.
  // The parent keys this form by incident, so each incident starts from its own prefill.
  const chosen = unitIds ?? form.data?.prefill ?? [];

  const approve = useMutation(
    trpc.dispatch.approve.mutationOptions({
      onSuccess: () => toast.success("Dispatch envoyé : l'ambulance reçoit la mission."),
      // A second approver, or a form that went stale: say who/why, then show the current state.
      onError: (error) => toast.error(error.message),
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: trpc.dispatch.recommendation.queryKey({ incidentId }) });
        queryClient.invalidateQueries({ queryKey: trpc.incidents.list.queryKey() });
      },
    }),
  );

  if (form.isPending) return <Skeleton className="h-40 w-full" aria-hidden="true" />;
  if (form.isError) {
    return (
      <div role="alert" className="rounded-lg border border-sev-red/40 bg-sev-red-soft p-4 text-sm text-sev-red">
        Dispatch indisponible : {form.error.message}
      </div>
    );
  }

  const { decision, candidates, recommended, notice } = form.data;

  if (decision) {
    return (
      <section aria-label="Dispatch décidé" className="space-y-2 rounded-lg border border-sev-green/40 bg-sev-green-soft p-4">
        <h3 className="flex items-center gap-2 text-base font-bold text-sev-green">
          <CheckCircle2Icon className="size-5" aria-hidden="true" />
          Dispatch décidé{decision.modified ? " (modifié)" : ""}
        </h3>
        <p className="text-sm">
          Par <strong>{decision.dispatcherName ?? "un dispatcher"}</strong> · {timeAgo(decision.decidedAt)}
        </p>
        <ul className="list-disc ps-5 text-sm">
          {decision.units.map((unit) => (
            <li key={unit.id}>
              <span className="font-mono font-semibold">{unit.callSign}</span> · {UNIT_NAMES[unit.type] ?? unit.type}
            </li>
          ))}
        </ul>
        {decision.reason && <p className="text-sm">Motif de la modification : {decision.reason}</p>}
        {decision.notes && <p className="text-sm">Consignes : {decision.notes}</p>}
      </section>
    );
  }

  const chosenTypes = chosen.flatMap((id) => candidates.find((unit) => unit.id === id)?.type ?? []);
  const modified = dispatchDiffers(recommended, chosenTypes);
  const needsReason = modified && reason.trim().length === 0;
  const canSend = chosen.length > 0 && !needsReason && !approve.isPending;

  const toggle = (id: string, on: boolean) => setUnitIds(on ? [...chosen, id] : chosen.filter((c) => c !== id));

  return (
    <form
      aria-label="Décision de dispatch"
      className="space-y-4 rounded-lg border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSend) return;
        approve.mutate({
          incidentId,
          expectedVersion: form.data.version,
          unitIds: chosen,
          reason: modified ? reason : undefined,
          notes: notes.trim() || undefined,
        });
      }}
    >
      <header className="flex flex-wrap items-center gap-2">
        <SirenIcon className="size-5 text-primary" aria-hidden="true" />
        <h3 className="text-base font-bold">Décision de dispatch</h3>
        <span className="ms-auto text-xs font-semibold text-muted-foreground">Vous décidez</span>
      </header>

      {notice && (
        <p role="status" className="flex items-start gap-2 rounded-md border border-sev-yellow/40 bg-sev-yellow-soft p-3 text-sm text-sev-yellow">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {notice}
        </p>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">Unités, de la plus proche à la plus éloignée</legend>
        {candidates.length === 0 && <p className="text-sm text-muted-foreground">Aucune unité disponible.</p>}
        {candidates.map((unit) => (
          <div key={unit.id} className="flex min-h-11 items-center gap-3 rounded-md border px-3">
            <Checkbox
              id={`unit-${unit.id}`}
              checked={chosen.includes(unit.id)}
              onCheckedChange={(on) => toggle(unit.id, on)}
            />
            <Label htmlFor={`unit-${unit.id}`} className="flex flex-1 flex-wrap items-center justify-between gap-x-3 font-normal">
              <span>
                <span className="font-mono font-semibold">{unit.callSign}</span> · {UNIT_NAMES[unit.type] ?? unit.type}
              </span>
              <span className="text-sm text-muted-foreground">
                {unit.baseName} · <span className="tabular">{distanceLabel(unit.distanceM)}</span>
                {unit.busyWith && (
                  <strong className="ms-2 text-sev-yellow">déjà en mission (#{incidentRef(unit.busyWith)})</strong>
                )}
              </span>
            </Label>
          </div>
        ))}
      </fieldset>

      {modified && (
        <div className="space-y-2">
          <Label htmlFor="dispatch-reason">Motif de la modification (obligatoire)</Label>
          <Textarea
            id="dispatch-reason"
            rows={2}
            maxLength={500}
            placeholder="Pourquoi ce dispatch diffère de la recommandation ?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={needsReason}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="dispatch-notes">Consignes pour l'équipage (facultatif)</Label>
        <Textarea
          id="dispatch-notes"
          rows={2}
          maxLength={500}
          placeholder="Accès, danger, point de rendez-vous…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={!canSend}>
        {approve.isPending ? (
          <>
            <Loader2Icon className="animate-spin" /> Envoi…
          </>
        ) : modified ? (
          "Dispatcher avec modification"
        ) : (
          "Approuver la recommandation"
        )}
      </Button>
    </form>
  );
}
