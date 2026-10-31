import { CheckCircle2Icon, AlertCircleIcon, RadioIcon, ServerIcon, UserCheckIcon, CpuIcon } from "lucide-react";
import type { ChipRecord } from "@solvex-dergana/shared";
import type { Transmission } from "./use-chip-simulator";

export type JourneyHopId = "chip" | "gsm" | "server" | "dispatcher";
export type JourneyHopStatus = "idle" | "active" | "completed" | "failed";

export type JourneyHop = {
  id: JourneyHopId;
  title: string;
  subtitle: string;
  titleAr: string;
  status: JourneyHopStatus;
  timestampMs: number | null;
  latencyMs: number | null;
  totalLatencyMs: number | null;
  error?: string | null;
  incidentId?: string | null;
  ack?: string | null;
  channel?: "http" | "sms";
};

export type JourneyEventTimeline = {
  transmissions: Transmission[];
  records: ChipRecord[];
  nowMs: number;
  dispatcherEventAtMs?: number | null;
};

/**
 * Computes strictly event-driven journey hops (PRD FR-S8-08, FR-S8-10).
 * Nothing animates or transitions without a corresponding real event.
 */
export function computeJourneyHops(timeline: JourneyEventTimeline): JourneyHop[] {
  const { transmissions, records } = timeline;
  const latestTx = transmissions.length > 0 ? transmissions[transmissions.length - 1] : null;

  // Find impact detection time (T0)
  const impactRecord = records.find((r) => r.type === "impact_detected");
  const t0Chip = impactRecord ? impactRecord.tMs : latestTx?.packet.eventMs ?? null;

  const hops: JourneyHop[] = [
    {
      id: "chip",
      title: "Puce SVX (Capteur)",
      subtitle: "Détection g-spike / gyro & confirmation",
      titleAr: "شريحة SVX (المستشعر)",
      status: "idle",
      timestampMs: t0Chip,
      latencyMs: null,
      totalLatencyMs: null,
    },
    {
      id: "gsm",
      title: latestTx?.channel === "sms" ? "Réseau GSM (SMS 2G)" : "Réseau Mobile (HTTP/4G)",
      subtitle: latestTx?.channel === "sms" ? "Canal secours SMS direct" : "Canal principal API REST",
      titleAr: latestTx?.channel === "sms" ? "شبكة الجوال (رسالة قصيرة)" : "شبكة الجوال (إنترنت 4G)",
      status: "idle",
      timestampMs: null,
      latencyMs: null,
      totalLatencyMs: null,
      channel: latestTx?.channel,
    },
    {
      id: "server",
      title: "Serveur SVX (Ingest & Triage)",
      subtitle: "Vérification HMAC, clustering & Vittel",
      titleAr: "خادم SVX (المعالجة والفرز)",
      status: "idle",
      timestampMs: null,
      latencyMs: null,
      totalLatencyMs: null,
      incidentId: null,
      ack: null,
    },
    {
      id: "dispatcher",
      title: "Poste Dispatcher",
      subtitle: "Notification temps réel & cartographie",
      titleAr: "مركز التحكم والمناوبة",
      status: "idle",
      timestampMs: null,
      latencyMs: null,
      totalLatencyMs: null,
      incidentId: null,
    },
  ];

  if (t0Chip !== null) {
    hops[0]!.status = "active";
  }

  if (latestTx) {
    hops[0]!.status = "completed";

    const sentAt = latestTx.sentAtMs ?? latestTx.packet.eventMs;
    hops[1]!.timestampMs = sentAt;
    hops[1]!.latencyMs = t0Chip !== null ? Math.max(0, sentAt - t0Chip) : 0;

    if (latestTx.status === "pending") {
      hops[1]!.status = "active";
    } else if (latestTx.status === "failed") {
      hops[1]!.status = "failed";
      hops[1]!.error = latestTx.error;
    } else if (latestTx.status === "ok") {
      hops[1]!.status = "completed";

      const ackedAt = latestTx.ackedAtMs ?? sentAt;
      const hop2ToHop3Latency = Math.max(0, ackedAt - sentAt);

      hops[2]!.status = "completed";
      hops[2]!.timestampMs = ackedAt;
      hops[2]!.latencyMs = hop2ToHop3Latency;
      hops[2]!.incidentId = latestTx.incidentId;
      hops[2]!.ack = latestTx.ack;

      const dispatcherAt = timeline.dispatcherEventAtMs ?? ackedAt;
      const dispatcherHopLatency = timeline.dispatcherEventAtMs ? Math.max(0, dispatcherAt - ackedAt) : 0;

      hops[3]!.status = "completed";
      hops[3]!.timestampMs = dispatcherAt;
      hops[3]!.latencyMs = dispatcherHopLatency;
      hops[3]!.incidentId = latestTx.incidentId;
      hops[3]!.totalLatencyMs = t0Chip !== null ? Math.max(0, dispatcherAt - t0Chip) : null;
    }
  }

  return hops;
}

const HOP_ICONS: Record<JourneyHopId, typeof CpuIcon> = {
  chip: CpuIcon,
  gsm: RadioIcon,
  server: ServerIcon,
  dispatcher: UserCheckIcon,
};

export function JourneyTimeline({
  transmissions,
  records,
  nowMs,
  dispatcherEventAtMs,
}: {
  transmissions: Transmission[];
  records: ChipRecord[];
  nowMs: number;
  dispatcherEventAtMs?: number | null;
}) {
  const hops = computeJourneyHops({ transmissions, records, nowMs, dispatcherEventAtMs });
  const finalHop = hops[3]!;
  const isCompleted = finalHop.status === "completed";

  return (
    <section aria-labelledby="journey-timeline-title" className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b pb-2">
        <div>
          <h2 id="journey-timeline-title" className="text-sm font-bold tracking-tight">
            Parcours de l'Alerte
          </h2>
          <p className="text-xs text-muted-foreground" dir="rtl">
            مسار الإنذار في الزمن الحقيقي
          </p>
        </div>
        {isCompleted && finalHop.totalLatencyMs !== null && (
          <div className="flex items-center gap-1.5 rounded bg-sev-green/10 px-2 py-0.5 text-xs font-semibold text-sev-green">
            <CheckCircle2Icon className="h-3.5 w-3.5" />
            <span>Délai total : {finalHop.totalLatencyMs} ms</span>
          </div>
        )}
      </div>

      <div className="relative grid grid-cols-1 gap-3 sm:grid-cols-4">
        {hops.map((hop, index) => {
          const Icon = HOP_ICONS[hop.id];
          const isFailed = hop.status === "failed";
          const isActive = hop.status === "active";
          const isDone = hop.status === "completed";

          let borderClass = "border-border/60 bg-muted/20 opacity-60";
          let iconClass = "text-muted-foreground";
          let badgeText = "En attente";
          let badgeClass = "bg-muted text-muted-foreground";

          if (isDone) {
            borderClass = "border-sev-green/50 bg-sev-green-soft";
            iconClass = "text-sev-green";
            badgeText = "Reçu ✓";
            badgeClass = "bg-sev-green/20 text-sev-green";
          } else if (isActive) {
            borderClass = "border-sev-yellow/70 bg-sev-yellow-soft animate-pulse";
            iconClass = "text-sev-yellow";
            badgeText = "En cours...";
            badgeClass = "bg-sev-yellow/20 text-sev-yellow";
          } else if (isFailed) {
            borderClass = "border-sev-red/70 bg-sev-red-soft";
            iconClass = "text-sev-red";
            badgeText = "Échec";
            badgeClass = "bg-sev-red/20 text-sev-red";
          }

          return (
            <div
              key={hop.id}
              className={`relative flex flex-col justify-between rounded-lg border p-3 transition-colors ${borderClass}`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${iconClass}`} />
                    <span className="text-xs font-bold">{index + 1}. {hop.id.toUpperCase()}</span>
                  </div>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badgeClass}`}>
                    {badgeText}
                  </span>
                </div>

                <div className="mt-2 text-xs font-semibold">{hop.title}</div>
                <div className="text-xs text-muted-foreground" dir="rtl">{hop.titleAr}</div>
                <p className="mt-1 text-xs text-muted-foreground leading-tight">{hop.subtitle}</p>
              </div>

              <div className="mt-3 border-t border-border/40 pt-2 text-xs font-mono">
                {hop.latencyMs !== null ? (
                  <div className="text-foreground">
                    <span className="text-muted-foreground">Saut : </span>
                    <strong className="text-sev-green">{hop.latencyMs} ms</strong>
                  </div>
                ) : (
                  <span className="text-muted-foreground">-- ms</span>
                )}

                {hop.incidentId && (
                  <div className="truncate text-xs text-muted-foreground">
                    Incident : <span className="text-foreground">{hop.incidentId.slice(0, 8)}...</span>
                  </div>
                )}
                {hop.ack && (
                  <div className="truncate text-xs text-muted-foreground">
                    ACK : <span className="text-sev-green">{hop.ack}</span>
                  </div>
                )}
                {isFailed && hop.error && (
                  <div className="flex items-center gap-1 text-xs text-sev-red">
                    <AlertCircleIcon className="h-3 w-3 shrink-0" />
                    <span className="truncate">{hop.error}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
