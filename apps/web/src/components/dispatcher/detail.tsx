import { Button } from "@solvex-dergana/ui/components/button";
import { useState } from "react";
import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { SeverityBadge } from "@solvex-dergana/ui/components/severity-badge";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { incidentRef } from "@/lib/time";
import {
  statusLabels,
  isActive,
  type Incident,
  type IncidentDetail,
  type Profiles,
} from "./types";

export type Correction =
  | { kind: "split"; alertIds: string[]; reason: string }
  | { kind: "merge"; targetId: string; reason: string }
  | { kind: "false_alarm"; reason: string };
type Props = {
  incident: IncidentDetail;
  profiles: Profiles | undefined;
  profilesError?: string;
  candidates: Incident[];
  onCorrect: (action: Correction) => Promise<void>;
};
const tabs = ["Évaluation", "Signaux bruts", "Profil", "Journal"] as const;
const sources = {
  iot: "Puce",
  app_auto: "Application automatique",
  app_witness: "Témoin",
  ussd: "Téléphone simple",
  unknown: "Source inconnue",
};
const date = (value: string) => new Date(value).toLocaleString("fr-DZ");

export function IncidentDetailPanel({
  incident,
  profiles,
  profilesError,
  onCorrect,
  candidates,
}: Props) {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Évaluation");
  const [correcting, setCorrecting] = useState<
    "false_alarm" | "split" | "merge" | null
  >(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <section
      aria-label="Détail de l'incident"
      className="min-w-0 rounded-lg border bg-card p-4 xl:max-h-[calc(100vh-15rem)] xl:overflow-y-auto"
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">
            Incident #{incidentRef(incident.id)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {incident.commune ?? "Commune inconnue"} {incident.roadRef}{" "}
            {incident.pkMarker} · {statusLabels[incident.status]}
          </p>
        </div>
        <SeverityBadge severity={incident.recSeverity} />
      </header>
      {profilesError && (
        <p role="alert" className="mb-3 text-sev-red">
          {profilesError}
        </p>
      )}
      {profiles?.map((p) => (
        <div
          key={p.id}
          className={cn(
            "mb-3 rounded-md border p-3 text-sm",
            p.anticoagulant
              ? "border-sev-red/40 bg-sev-red-soft text-sev-red"
              : "bg-raised",
          )}
        >
          <p className="font-bold">Profil {p.shortCode}</p>
          {p.anticoagulant && (
            <p className="font-bold">ANTICOAGULANT — risque hémorragique</p>
          )}
          <p>Groupe sanguin : {p.bloodType ?? "inconnu"}</p>
          <p>Allergies : {p.allergies.join(", ") || "non renseignées"}</p>
          {p.unreliableShockIndex && (
            <p className="font-bold">SI peu fiable (bêtabloquant)</p>
          )}
          {p.insulin && <p>Traitement par insuline</p>}
        </div>
      ))}
      {isActive(incident) && (
        <div className="mb-4 space-y-3">
          <Button
            variant="outline"
            onClick={() => {
              setCorrecting("false_alarm");
              setError(null);
            }}
          >
            Marquer fausse alerte
          </Button>
          <Button
            className="ms-2"
            variant="outline"
            disabled={
              !candidates.some((i) => i.id !== incident.id && isActive(i))
            }
            onClick={() => {
              setCorrecting("merge");
              setError(null);
            }}
          >
            Fusionner
          </Button>
          {correcting && (
            <form
              className="space-y-2 rounded-md border bg-raised p-3"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!reason.trim() || pending) return;
                setPending(true);
                setError(null);
                try {
                  await onCorrect(
                    correcting === "merge"
                      ? { kind: "merge", targetId, reason: reason.trim() }
                      : correcting === "split"
                        ? {
                            kind: "split",
                            alertIds: selected,
                            reason: reason.trim(),
                          }
                        : { kind: "false_alarm", reason: reason.trim() },
                  );
                  setSelected([]);
                  setCorrecting(null);
                  setReason("");
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Correction impossible.",
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              <p className="text-sm font-semibold">
                {correcting === "merge"
                  ? "Déplacer tous les signaux vers la destination et clore cet incident."
                  : correcting === "split"
                    ? "Déplacer les signaux sélectionnés dans un nouvel incident."
                    : "Confirmer le classement en fausse alerte. Les signaux sont conservés."}
              </p>
              {correcting === "merge" && (
                <>
                  <label className="block text-sm" htmlFor="merge-target">
                    Incident de destination
                  </label>
                  <select
                    id="merge-target"
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    required
                    className="w-full rounded-md border bg-background p-2"
                  >
                    <option value="">Choisir un incident</option>
                    {candidates
                      .filter((i) => i.id !== incident.id && isActive(i))
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.commune ?? "Sans position"} · #{incidentRef(i.id)}
                        </option>
                      ))}
                  </select>
                </>
              )}
              <label className="block text-sm" htmlFor="correction-reason">
                Motif de correction
              </label>
              <textarea
                id="correction-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                maxLength={1000}
                className="min-h-20 w-full rounded-md border bg-background p-2 focus-visible:outline-2 focus-visible:outline-ring"
              />
              {error && (
                <p role="alert" className="text-sm text-sev-red">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={
                    pending ||
                    !reason.trim() ||
                    (correcting === "merge" && !targetId) ||
                    (correcting === "split" &&
                      (!selected.length ||
                        selected.length === incident.alerts.length))
                  }
                >
                  Confirmer la correction
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setCorrecting(null)}
                >
                  Annuler
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
      {tab === "Signaux bruts" && isActive(incident) && (
        <Button
          className="mb-3"
          variant="outline"
          disabled={
            !selected.length || selected.length === incident.alerts.length
          }
          onClick={() => {
            setCorrecting("split");
            setError(null);
          }}
        >
          Séparer les signaux sélectionnés
        </Button>
      )}
      <div
        role="tablist"
        aria-label="Détails"
        className="mb-4 flex gap-1 overflow-x-auto border-b"
      >
        {tabs.map((name, index) => (
          <button
            type="button"
            key={name}
            role="tab"
            id={`incident-tab-${index}`}
            aria-controls={`incident-panel-${index}`}
            aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft"
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : null;
              if (next !== null) {
                event.preventDefault();
                setTab(tabs[next]!);
                document.getElementById(`incident-tab-${next}`)?.focus();
              }
            }}
            className={cn(
              "shrink-0 border-b-2 border-transparent px-2 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring",
              tab === name && "border-primary text-primary",
            )}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`incident-panel-${tabs.indexOf(tab)}`}
        aria-labelledby={`incident-tab-${tabs.indexOf(tab)}`}
      >
        {tab === "Évaluation" && (
          <div className="space-y-3 text-sm">
            <p>
              {incident.alertCount} alerte(s) ·{" "}
              {incident.estimatedVictims ?? "?"} victime(s) · Confiance{" "}
              {Math.round(Number(incident.confidenceScore) * 100)} %
            </p>
            <p>Première alerte : {date(incident.firstAlertAt)}</p>
            {incident.recUnits?.map((unit, i) => (
              <p key={i}>
                {unit.count} × {unit.type} {unit.reason && `— ${unit.reason}`}
              </p>
            ))}
            <p>
              Autorité :{" "}
              {incident.recAuthority === "surete_nationale"
                ? "Sûreté Nationale"
                : incident.recAuthority === "gendarmerie_nationale"
                  ? "Gendarmerie Nationale"
                  : "À déterminer"}
            </p>
            {incident.aiSummary && (
              <div className="rounded-md border border-sev-ai/40 bg-sev-ai-soft p-3 text-sev-ai">
                <p className="font-bold">Suggestion IA — à vérifier</p>
                <pre className="whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(incident.aiSummary, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
        {tab === "Signaux bruts" && (
          <ul className="space-y-3">
            {incident.alerts.map((a) => (
              <li
                key={a.id}
                className="space-y-2 rounded-md border bg-raised p-3 text-sm"
              >
                {isActive(incident) && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(a.id)}
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, a.id]
                            : ids.filter((id) => id !== a.id),
                        )
                      }
                    />
                    Sélectionner le signal {incidentRef(a.id)}
                  </label>
                )}
                <p className="font-bold">
                  {sources[a.source]} · {a.channel.toUpperCase()}
                </p>
                <p className="text-xs text-muted-foreground">
                  Reçu : {date(a.receivedAt)} · Précision :{" "}
                  {a.accuracyM === null ? "inconnue" : `${a.accuracyM} m`}
                </p>
                {a.eventAt && (
                  <p className="text-xs text-muted-foreground">
                    Événement : {date(a.eventAt)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {a.emulated && <EmulationBadge />}
                  {a.traceInjected && (
                    <EmulationBadge>TRACE SYNTHÉTIQUE</EmulationBadge>
                  )}
                </div>
                {a.rawPayload && (
                  <pre className="overflow-auto whitespace-pre-wrap break-all rounded border bg-background p-2 font-mono text-xs">
                    {a.rawPayload}
                  </pre>
                )}
                {a.media?.photos?.map((url, n) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <img
                      src={url}
                      alt={`Photo du signal ${n + 1}`}
                      loading="lazy"
                      className="my-2 max-h-40 rounded-md"
                    />
                  </a>
                ))}
                {a.media?.audio && (
                  <audio
                    controls
                    preload="none"
                    src={a.media.audio}
                    className="max-w-full"
                    aria-label="Enregistrement du témoin"
                  />
                )}
                {a.transcript && (
                  <p>
                    <span className="font-semibold">Transcription : </span>
                    {a.transcript}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {tab === "Profil" && (
          <p className="text-sm text-muted-foreground">
            {profiles === undefined
              ? "Chargement des profils…"
              : profiles.length
                ? "Risques médicaux affichés ci-dessus. Chaque consultation est journalisée."
                : "Aucun profil médical lié."}
          </p>
        )}
        {tab === "Journal" && (
          <ol className="space-y-3">
            {incident.journal.map((event) => (
              <li key={event.id} className="border-s-2 ps-3 text-sm">
                <p className="font-bold">{event.type}</p>
                <p className="text-xs text-muted-foreground">
                  {date(event.at)} · {event.actorRole} {event.actorId}
                </p>
                <pre className="whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </li>
            ))}
            {!incident.journal.length && (
              <li className="text-sm text-muted-foreground">
                Aucun événement enregistré.
              </li>
            )}
          </ol>
        )}
      </div>
    </section>
  );
}
