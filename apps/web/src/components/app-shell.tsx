import { Logo, LogoMark } from "@solvex-dergana/ui/components/logo";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import AccountMenu from "@/components/account-menu";
import ConnectionStatus from "@/components/connection-status";
import ThemeToggle from "@/components/theme-toggle";
import { navFor, ROLE_LABEL } from "@/lib/nav";

type Props = {
  user: { name: string; email: string };
  appUser: Parameters<typeof navFor>[0];
  children: ReactNode;
};

const navLink =
  "group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground";

export default function AppShell({ user, appUser, children }: Props) {
  const items = navFor(appUser);

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr_auto] md:grid-cols-[16rem_1fr] md:grid-rows-[auto_1fr]">
      {/* Sidebar (md and up) */}
      <aside className="row-span-2 hidden flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="border-b border-sidebar-border px-5 py-5">
          <Logo inverted />
        </div>
        <nav aria-label="Navigation principale" className="flex-1 space-y-1 p-3">
          <p className="px-3 pt-2 pb-2 text-[0.68rem] font-bold tracking-[0.14em] text-sidebar-muted uppercase">
            {ROLE_LABEL[appUser.role]}
          </p>
          {items.map(({ label, icon: Icon, link }) => (
            <Link key={label} {...link} className={navLink}>
              <span
                aria-hidden="true"
                className="absolute inset-y-2 start-0 w-1 rounded-full bg-sidebar-primary opacity-0 group-data-[status=active]:opacity-100"
              />
              <Icon className="size-[1.15rem] shrink-0" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        <p className="border-t border-sidebar-border px-5 py-4 text-xs leading-relaxed text-sidebar-muted">
          Prototype SolveX 3.0.
          <br />
          Données de démonstration.
        </p>
      </aside>

      {/* Top bar */}
      <header className="flex h-16 items-center justify-between gap-3 border-b bg-card px-4 md:px-6">
        <div className="flex items-center gap-3 md:hidden">
          <LogoMark className="size-8" />
          <span className="text-sm font-extrabold tracking-tight">SVX Rescue</span>
        </div>
        <div className="hidden md:block" />
        <div className="flex items-center gap-2">
          <ConnectionStatus className="hidden sm:inline-flex" />
          <ThemeToggle />
          <AccountMenu name={user.name} email={user.email} role={appUser.role} />
        </div>
      </header>

      <main id="main" className="min-h-0 overflow-y-auto">
        {children}
      </main>

      {/* Bottom navigation (below md), only when there is more than one screen */}
      {items.length > 1 && (
        <nav
          aria-label="Navigation principale"
          className="grid border-t bg-sidebar md:hidden"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
          {items.map(({ label, icon: Icon, link }) => (
            <Link
              key={label}
              {...link}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[0.7rem] font-semibold text-sidebar-foreground/75 data-[status=active]:text-sidebar-primary",
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
