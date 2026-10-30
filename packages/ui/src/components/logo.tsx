import { cn } from "@solvex-dergana/ui/lib/utils";

/** SVX Rescue mark: a pulse line crossing a location pin, on a rounded tile. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      role="img"
      aria-label="SVX Rescue"
      className={cn("size-9 shrink-0", className)}
    >
      <rect width="40" height="40" rx="10" fill="var(--primary)" />
      <path
        d="M20 8.5c-4.7 0-8.3 3.6-8.3 8.2 0 5.6 6.2 11.4 7.5 12.6a1.2 1.2 0 0 0 1.6 0c1.3-1.2 7.5-7 7.5-12.6 0-4.6-3.6-8.2-8.3-8.2Z"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="2.2"
      />
      <path
        d="M13.5 17.5h4l1.6-3.4 2.6 6.6 1.6-3.2h3.2"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="leading-none">
        <span
          className={cn(
            "block text-base font-extrabold tracking-tight",
            inverted ? "text-sidebar-accent-foreground" : "text-foreground",
          )}
        >
          SVX Rescue
        </span>
        <span
          className={cn(
            "mt-1 block text-[0.68rem] font-semibold tracking-[0.14em] uppercase",
            inverted ? "text-sidebar-muted" : "text-muted-foreground",
          )}
        >
          Urgences routières
        </span>
      </span>
    </span>
  );
}
