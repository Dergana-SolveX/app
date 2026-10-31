import { cn } from "@solvex-dergana/ui/lib/utils";

/** Official AWN logo files, served from the repository's public/images/. Never redraw or recolor them. */
export const LOGO_SRC = {
  bright: "/images/logobright.svg",
  dark: "/images/logodark.svg",
} as const;

/**
 * The AWN mark (a square tile). `variant` picks the asset for the background it sits on;
 * "auto" follows the theme (bright logo in light mode, dark logo in dark mode).
 */
export function LogoMark({
  className,
  variant = "auto",
}: {
  className?: string;
  variant?: "auto" | "bright" | "dark";
}) {
  const base = cn("size-10 shrink-0 rounded-sm object-contain", className);
  if (variant !== "auto") {
    return (
      <img
        src={LOGO_SRC[variant]}
        alt="AWN"
        width={40}
        height={40}
        className={base}
      />
    );
  }
  return (
    <>
      <img
        src={LOGO_SRC.bright}
        alt="AWN"
        width={40}
        height={40}
        className={cn(base, "dark:hidden")}
      />
      <img
        src={LOGO_SRC.dark}
        alt="AWN"
        width={40}
        height={40}
        className={cn(base, "hidden dark:block")}
      />
    </>
  );
}

/** Mark + bilingual brand name. `inverted` is for dark brand surfaces such as the sidebar. */
export function Logo({
  className,
  inverted,
  markClassName,
  subtitle,
  subtitleClassName,
}: {
  className?: string;
  inverted?: boolean;
  markClassName?: string;
  subtitle?: string;
  subtitleClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <LogoMark
        variant={inverted ? "dark" : "auto"}
        className={markClassName}
      />
      <span className="leading-none">
        <span
          className={cn(
            "flex items-baseline gap-2 text-lg font-bold",
            inverted ? "text-sidebar-accent-foreground" : "text-foreground",
          )}
        >
          AWN
          <span lang="ar" dir="rtl" className="text-base font-semibold">
            عون
          </span>
        </span>
        {subtitle && (
          <span
            className={cn(
              "mt-1 block text-xs font-medium",
              inverted ? "text-sidebar-muted" : "text-muted-foreground",
              subtitleClassName,
            )}
          >
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}
