import { cn } from "@solvex-dergana/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

/** Live API reachability. Shows a word as well as a color. */
export default function ConnectionStatus({ className }: { className?: string }) {
  const health = useQuery({ ...trpc.healthCheck.queryOptions(), refetchInterval: 15_000 });
  const online = health.isSuccess;
  const checking = health.isPending;

  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-semibold",
        online
          ? "border-sev-green/40 bg-sev-green-soft text-sev-green"
          : checking
            ? "border-border bg-muted text-muted-foreground"
            : "border-sev-red/40 bg-sev-red-soft text-sev-red",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          online ? "bg-sev-green" : checking ? "bg-muted-foreground" : "bg-sev-red",
        )}
      />
      {online ? "API connectée" : checking ? "Connexion…" : "API hors ligne"}
    </span>
  );
}
