import { Button } from "@solvex-dergana/ui/components/button";
import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { Input } from "@solvex-dergana/ui/components/input";
import { Label } from "@solvex-dergana/ui/components/label";
import { Textarea } from "@solvex-dergana/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, SendIcon, SmartphoneIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SMS_PRESETS } from "@/lib/sms-presets";
import { clockTime, incidentRef } from "@/lib/time";
import { trpc } from "@/utils/trpc";

const SMS_LIMIT = 160;

export default function GsmPanel() {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState("+213550000001");
  const [body, setBody] = useState("");

  const outbox = useQuery({ ...trpc.gsm.outbox.queryOptions(), refetchInterval: 2_000 });

  const inject = useMutation(
    trpc.gsm.inject.mutationOptions({
      onSuccess: (result) => {
        if (result.kind === "alert") {
          toast.success(
            result.duplicate
              ? `Déjà reçu : incident #${result.incidentId.replace(/-/g, "").slice(0, 8).toUpperCase()} (réponse renvoyée)`
              : `Alerte reçue : incident #${result.incidentId.replace(/-/g, "").slice(0, 8).toUpperCase()} créé`,
          );
        } else {
          toast.message("Texte archivé : ce n'est pas un message SVX, aucun incident créé.");
        }
        queryClient.invalidateQueries({ queryKey: trpc.gsm.wire.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.gsm.outbox.queryKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const tooLong = body.length > SMS_LIMIT;

  return (
    <section aria-labelledby="gsm-title" className="space-y-6">
      <div className="rounded-lg border bg-card p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-secondary text-primary">
              <SmartphoneIcon className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="gsm-title" className="text-base font-bold">
                Réseau GSM (émulé)
              </h2>
              <p className="text-sm text-muted-foreground">Un téléphone envoie un SMS au numéro SVX.</p>
            </div>
          </div>
          <EmulationBadge />
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim() && !tooLong) inject.mutate({ from, body });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="gsm-from">Numéro de l'expéditeur</Label>
            <Input
              id="gsm-from"
              inputMode="tel"
              autoComplete="off"
              className="font-mono"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Messages prêts à l'emploi</legend>
            <div className="grid grid-cols-2 gap-2">
              {SMS_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  className="h-auto min-h-12 flex-col items-start gap-0.5 py-2 text-start"
                  onClick={() => setBody(preset.build())}
                >
                  <span>{preset.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">{preset.hint}</span>
                </Button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="gsm-body">Message SMS</Label>
            <Textarea
              id="gsm-body"
              rows={4}
              className="font-mono text-sm break-all"
              placeholder="SVX1#L:2#GH:…#CK:…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-invalid={tooLong}
              aria-describedby="gsm-count"
            />
            <p
              id="gsm-count"
              className={tooLong ? "text-sm font-semibold text-destructive" : "text-sm text-muted-foreground"}
            >
              <span className="tabular font-mono">
                {body.length}/{SMS_LIMIT}
              </span>{" "}
              caractères{tooLong ? ": trop long pour un seul SMS" : ""}
            </p>
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={inject.isPending || !body.trim() || tooLong}>
            {inject.isPending ? (
              <>
                <Loader2Icon className="animate-spin" /> Envoi…
              </>
            ) : (
              <>
                <SendIcon /> Envoyer au numéro SVX
              </>
            )}
          </Button>
        </form>
      </div>

      <div className="rounded-lg border bg-card p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">Boîte d'envoi GSM</h2>
          <EmulationBadge />
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Les SMS que le serveur envoie (accusés de réception, notifications). Rien ne quitte cette machine.
        </p>
        {outbox.isSuccess && outbox.data.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground">
            Aucun SMS envoyé pour l'instant. Envoyez une alerte: l'accusé de réception apparaît ici.
          </p>
        )}
        <ul className="space-y-2">
          {(outbox.data ?? []).map((m) => (
            <li key={m.id} className="rounded-md border bg-raised px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="tabular font-mono">{clockTime(m.at)}</span>
                <span className="font-semibold uppercase">
                  {m.status === "sent" ? "Envoyé" : m.status}
                  {m.incidentId ? ` · incident #${incidentRef(m.incidentId)}` : ""}
                </span>
              </div>
              <p className="mt-1 font-mono text-sm break-all">{m.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
