import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeftIcon, ArrowUpRightIcon, CheckIcon, XIcon } from "lucide-react";

import { clockTime, incidentRef } from "@/lib/time";
import { trpc } from "@/utils/trpc";

const STATUS_LABEL = {
  received: "Reçu",
  queued: "En attente",
  sent: "Envoyé",
  delivered: "Remis",
  failed: "Échec",
} as const;

const chip = "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-bold";

/** Checksum verdict. A word and an icon, never color alone. */
function CrcBadge({ valid }: { valid: boolean }) {
  return (
    <span
      className={cn(
        chip,
        valid
          ? "border-sev-green/40 bg-sev-green-soft text-sev-green"
          : "border-sev-red/40 bg-sev-red-soft text-sev-red",
      )}
    >
      {valid ? <CheckIcon className="size-3" aria-hidden="true" /> : <XIcon className="size-3" aria-hidden="true" />}
      CRC {valid ? "valide" : "erroné"}
    </span>
  );
}

/** Every SMS that went through the server, both ways: what the wire carried and what the server made of it. */
export default function WireLog() {
  const wire = useQuery({ ...trpc.gsm.wire.queryOptions(), refetchInterval: 2_000 });

  return (
    <section aria-labelledby="wire-title" className="rounded-lg border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="wire-title" className="text-base font-bold">
            Journal du fil (wire log)
          </h2>
          <p className="text-sm text-muted-foreground">
            Chaque SMS reçu ou envoyé, avec le verdict du serveur. Mise à jour toutes les 2 s.
          </p>
        </div>
      </div>

      {wire.isSuccess && wire.data.length === 0 && (
        <p className="rounded-md border border-dashed px-3 py-10 text-center text-muted-foreground">
          Aucun trafic pour l'instant. Envoyez un SMS depuis le panneau « Réseau GSM (émulé) ».
        </p>
      )}

      <ol className="space-y-2">
        {(wire.data ?? []).map((m) => {
          const inbound = m.direction === "in";
          return (
            <li key={m.id} className="rounded-md border bg-raised px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                <span className="tabular font-mono text-muted-foreground">{clockTime(m.at)}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-semibold",
                    inbound ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {inbound ? (
                    <ArrowDownLeftIcon className="size-4" aria-hidden="true" />
                  ) : (
                    <ArrowUpRightIcon className="size-4" aria-hidden="true" />
                  )}
                  {inbound ? "Reçu" : "Envoyé"}
                </span>
                <span className={cn(chip, "border-border bg-muted text-muted-foreground")}>SMS</span>
                <span className="tabular font-mono text-muted-foreground">{m.size} o</span>
                <span
                  className={cn(
                    chip,
                    m.status === "failed"
                      ? "border-sev-red/40 bg-sev-red-soft text-sev-red"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {STATUS_LABEL[m.status]}
                </span>
                {inbound && m.result && (
                  <>
                    {m.result.recognized ? (
                      <CrcBadge valid={m.result.crcValid} />
                    ) : (
                      <span className={cn(chip, "border-border bg-muted text-muted-foreground")}>Non SVX</span>
                    )}
                    {/* Signature check arrives with signed chip messages (issue #14). */}
                    <span className={cn(chip, "border-border bg-muted text-muted-foreground")} title="Signature non vérifiée">
                      Signature —
                    </span>
                    {m.result.duplicate && (
                      <span className={cn(chip, "border-border bg-muted text-muted-foreground")}>Doublon</span>
                    )}
                  </>
                )}
                {m.incidentId && (
                  <span className="font-mono text-muted-foreground">#{incidentRef(m.incidentId)}</span>
                )}
                {m.emulated && <EmulationBadge />}
              </div>
              <p className="mt-1.5 font-mono text-sm break-all">{m.body}</p>
              {inbound && m.result && m.result.parseErrors.length > 0 && (
                <p className="mt-1 text-xs font-semibold text-sev-yellow">
                  Anomalies : {m.result.parseErrors.join(", ")}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
