import { cn } from "@solvex-dergana/ui/lib/utils";
import { CheckIcon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";

import { explainSvx, type SvxFieldKind } from "@/lib/svx-anatomy";

import type { Transmission } from "./use-chip-simulator";

/** Each role has its own look, and every field also prints its key: colour is never the only code. */
const KIND_STYLE: Record<SvxFieldKind, string> = {
  header: "border-border bg-muted text-foreground",
  who: "border-primary/40 bg-accent text-accent-foreground",
  where: "border-primary/40 bg-primary/15 text-foreground",
  when: "border-border bg-secondary text-secondary-foreground",
  severity: "border-sev-red/40 bg-sev-red-soft text-sev-red",
  status: "border-sev-yellow/40 bg-sev-yellow-soft text-sev-yellow",
  proof: "border-input bg-card text-foreground",
  other: "border-dashed text-muted-foreground",
};

function StatusLine({ tx }: { tx: Transmission }) {
  if (tx.status === "pending") {
    return (
      <p role="status" className="flex items-center gap-2 text-sm font-semibold text-sev-yellow">
        <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Envoi en cours…
      </p>
    );
  }
  if (tx.status === "failed") {
    return (
      <p role="status" className="flex items-center gap-2 text-sm font-semibold text-sev-red">
        <CircleAlertIcon className="size-4" aria-hidden="true" />
        Échec : {tx.error}
      </p>
    );
  }
  return (
    <p role="status" className="flex items-center gap-2 text-sm font-semibold text-sev-green">
      <CheckIcon className="size-4" aria-hidden="true" />
      Reçu par le serveur · accusé <span className="tabular font-mono">{tx.ack}</span>
    </p>
  );
}

/** What the chip actually sent (PRD FR-S8-08): the SVX message taken apart field by field, or the signed web event. */
export function PacketCard({ transmissions }: { transmissions: Transmission[] }) {
  const tx = transmissions.at(-1);
  if (!tx) {
    return (
      <section aria-label="Paquet envoyé" className="rounded-lg border border-dashed bg-card/60 p-4 text-sm text-muted-foreground">
        Le paquet envoyé par la puce apparaîtra ici, champ par champ.
      </section>
    );
  }
  const anatomy = tx.sms ? explainSvx(tx.sms) : null;
  const { packet } = tx;
  return (
    <section aria-label="Paquet envoyé" className="@container flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold">
          Paquet envoyé · tentative {tx.attempt} · {tx.channel === "sms" ? "SMS (zone blanche)" : "Internet, signé HMAC-SHA256"}
        </h2>
      </div>
      <StatusLine tx={tx} />

      {anatomy ? (
        <>
          <ul className="flex flex-wrap gap-1.5" aria-label="Champs du message SVX">
            {anatomy.fields.map((field) => (
              <li key={field.key} className={cn("min-w-0 max-w-full break-words rounded-md border px-2 py-1", KIND_STYLE[field.kind])}>
                <span className="tabular font-mono text-sm font-bold">
                  {field.key}
                  {field.value && `:${field.value}`}
                </span>
                <span className="block text-xs">{field.meaning}</span>
              </li>
            ))}
          </ul>
          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-semibold">Taille du SMS</span>
              <span className="tabular font-mono font-bold">
                {anatomy.length} / {anatomy.limit} caractères
              </span>
            </div>
            <div
              role="meter"
              aria-label="Caractères utilisés"
              aria-valuemin={0}
              aria-valuemax={anatomy.limit}
              aria-valuenow={anatomy.length}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (anatomy.length / anatomy.limit) * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Un message eCall européen (MSD) pèse jusqu'à 140 octets et exige un canal dédié. Ici, {anatomy.length} caractères de texte lisible, qui passent par n'importe quel réseau GSM.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Le format SMS (protocole figé) ne porte ni le nombre de chocs ni l'indicateur de saturation du capteur : seul l'envoi par Internet les transmet.
            </p>
          </div>
        </>
      ) : (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm @sm:grid-cols-2">
          {[
            ["Pic", `${packet.peakG.toFixed(1).replace(".", ",")} g${packet.saturated ? " (capteur saturé)" : ""}`],
            ["Delta-V", `${Math.round(packet.deltaVKmh)} km/h`],
            ["Chocs", String(packet.impacts)],
            ["Tonneaux", packet.rollover ? `oui (${packet.rolloverDeg}°)` : "non"],
            ["Incendie", packet.fire ? "oui" : "non"],
            ["Déclencheur", { impact: "choc", rollover: "tonneau", fire: "incendie" }[packet.cause]],
          ].map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!anatomy && (
        <p className="text-xs text-muted-foreground">
          Requête POST vers <span className="font-mono">/devices/…/events</span> avec les en-têtes{" "}
          <span className="font-mono">X-SVX-Signature</span> (HMAC-SHA256 du corps) et <span className="font-mono">X-SVX-Timestamp</span> (contre le rejeu).
        </p>
      )}
    </section>
  );
}
