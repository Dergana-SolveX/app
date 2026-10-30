import { cn } from "@solvex-dergana/ui/lib/utils";

export type StreamStatus = "idle" | "connecting" | "pending" | "error";

const COPY: Record<StreamStatus, { label: string; tone: string; dot: string }> = {
  pending: {
    label: "Flux en direct",
    tone: "border-sev-green/40 bg-sev-green-soft text-sev-green",
    dot: "bg-sev-green",
  },
  connecting: {
    label: "Connexion au flux…",
    tone: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  idle: {
    label: "Flux en pause",
    tone: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  error: {
    label: "Flux interrompu, reconnexion…",
    tone: "border-sev-red/40 bg-sev-red-soft text-sev-red",
    dot: "bg-sev-red",
  },
};

/** State of the live (SSE) stream. A word as well as a color. */
export default function LiveStatus({ status }: { status: StreamStatus }) {
  const { label, tone, dot } = COPY[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-semibold",
        tone,
      )}
    >
      <span aria-hidden="true" className={cn("size-2 rounded-full", dot, status === "pending" && "animate-pulse")} />
      {label}
    </span>
  );
}
