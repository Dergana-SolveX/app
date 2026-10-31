import { getLabels } from "@solvex-dergana/shared";
import { useLocale } from "@/components/locale-provider";
import { Logo, LogoMark } from "@solvex-dergana/ui/components/logo";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import AccountMenu from "@/components/account-menu";
import ConnectionStatus from "@/components/connection-status";
import ThemeToggle from "@/components/theme-toggle";
import { navFor } from "@/lib/nav";
import type { RoleHolder } from "@solvex-dergana/shared";

type Props = {
  user: { name: string; email: string };
  appUser: RoleHolder;
  children: ReactNode;
};

export default function AppShell({ user, appUser, children }: Props) {
  const { locale } = useLocale();
  const t = getLabels(locale, "shell");
  const items = navFor(appUser).map(item => ({ ...item, label: appUser.role === "hospital" ? getLabels(locale, "hospital").title : item.label }));
  const hasSidebar = appUser.role === "admin";

  const headerActions = (
    <div className="flex items-center gap-2 shrink-0">
      <ConnectionStatus className="hidden sm:inline-flex" />
      <ThemeToggle />
      <AccountMenu name={user.name} email={user.email} role={appUser.role} />
    </div>
  );

  if (!hasSidebar) {
    return (
      <div
        lang={locale}
        dir={locale === "ar" ? "rtl" : "ltr"}
        className="flex h-dvh flex-col bg-background text-foreground"
      >
        {/* Top bar with logo and navigation next to it */}
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 md:px-6">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <Logo
              subtitle={getLabels(locale, "victim").emergency}
              subtitleClassName="hidden sm:block"
            />
            {items.length > 0 && (
              <>
                <div className="h-6 w-px bg-border shrink-0 hidden sm:block" aria-hidden="true" />
                <nav aria-label={t.nav} className="flex items-center gap-2">
                  {items.map(({ label, icon: Icon, link }) => (
                    <Link
                      key={label}
                      {...link}
                      className={cn(
                        "group flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-all whitespace-nowrap",
                        "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600",
                        "data-[status=active]:bg-emerald-600 data-[status=active]:text-white data-[status=active]:shadow-sm data-[status=active]:hover:bg-emerald-600 data-[status=active]:hover:text-white",
                        "[&.active]:bg-emerald-600 [&.active]:text-white [&.active]:shadow-sm",
                      )}
                      activeProps={{
                        className: "!bg-emerald-600 !text-white !shadow-sm hover:!bg-emerald-600",
                      }}
                    >
                      <Icon className="size-4.5 shrink-0 transition-colors" aria-hidden="true" />
                      <span className="truncate max-w-[140px] sm:max-w-none">{label}</span>
                    </Link>
                  ))}
                </nav>
              </>
            )}
          </div>
          <div id="header-center" className="flex items-center justify-center min-w-0 flex-1 mx-2" />
          {headerActions}
        </header>

        <main id="main" className="min-h-0 flex-1 overflow-y-auto bg-background">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className="grid h-dvh grid-rows-[auto_1fr_auto] bg-background text-foreground md:grid-cols-[17rem_1fr] md:grid-rows-[auto_1fr]"
    >
      {/* Sidebar (md and up) */}
      <aside className="row-span-2 hidden flex-col md:flex md:m-3.5 md:rounded-2xl border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm overflow-hidden">
        <div className="border-b border-sidebar-border px-5 py-5">
          <Logo subtitle={getLabels(locale, "victim").emergency} />
        </div>
        <nav aria-label={t.nav} className="flex-1 space-y-1.5 p-3">
          <p className="px-3 pt-2 pb-2 text-xs font-semibold uppercase tracking-wider text-sidebar-muted">
            {t[appUser.role]}
          </p>
          {items.map(({ label, icon: Icon, link }) => (
            <Link
              key={label}
              {...link}
              className={cn(
                "group relative flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all",
                "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600",
                "data-[status=active]:bg-emerald-600 data-[status=active]:text-white data-[status=active]:shadow-sm data-[status=active]:hover:bg-emerald-600 data-[status=active]:hover:text-white",
                "[&.active]:bg-emerald-600 [&.active]:text-white [&.active]:shadow-sm",
              )}
              activeProps={{
                className: "!bg-emerald-600 !text-white !shadow-sm hover:!bg-emerald-600",
              }}
            >
              <Icon className="size-5 shrink-0 transition-colors" aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <p className="border-t border-sidebar-border px-5 py-4 text-xs leading-relaxed text-sidebar-muted">
          {t.prototype}
          <br />
          {t.demo}
        </p>
      </aside>

      {/* Top bar */}
      <header className="flex h-16 items-center justify-between gap-3 border-b border-border bg-card px-4 md:px-6">
        <div className="flex items-center gap-2.5 md:hidden">
          <LogoMark className="size-9" />
          <span className="text-base font-bold">
            AWN{" "}
            <span lang="ar" dir="rtl" className="font-semibold text-muted-foreground">
              عون
            </span>
          </span>
        </div>
        <div id="header-center" className="flex items-center justify-center min-w-0 flex-1 mx-2" />
        {headerActions}
      </header>

      <main id="main" className="min-h-0 overflow-y-auto bg-background">
        {children}
      </main>

      {/* Bottom navigation (below md), only when there is more than one screen */}
      {items.length > 1 && (
        <nav
          aria-label={t.nav}
          className="grid border-t border-sidebar-border bg-sidebar md:hidden"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
          {items.map(({ label, icon: Icon, link }) => (
            <Link
              key={label}
              {...link}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-xs font-semibold text-sidebar-muted transition-colors hover:text-sidebar-foreground",
                "data-[status=active]:text-emerald-600 dark:data-[status=active]:text-emerald-400 [&.active]:text-emerald-600 dark:[&.active]:text-emerald-400",
              )}
              activeProps={{
                className: "!text-emerald-600 dark:!text-emerald-400 font-bold",
              }}
            >
              <Icon className="size-5" aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
