import { LocaleProvider } from "@/components/locale-provider";
import { useLocation } from "@tanstack/react-router";
import { landingPathFor } from "@solvex-dergana/shared";
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { ShieldOffIcon } from "lucide-react";

import AppShell from "@/components/app-shell";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({
        to: "/login",
      });
    }
    // A login without an `app_users` row has no role: appUser is null.
    const appUser = await context.queryClient.fetchQuery(trpc.me.queryOptions());
    return { session, appUser };
  },
});

function AuthLayout() {
  const pathname = useLocation({ select: location => location.pathname });
  const { session, appUser } = Route.useRouteContext();

  if (!appUser || !landingPathFor(appUser)) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="max-w-md rounded-lg border bg-card p-8 text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-lg bg-sev-red-soft text-sev-red">
            <ShieldOffIcon className="size-6" aria-hidden="true" />
          </span>
          <h1 className="text-lg font-extrabold">Accès refusé</h1>
          <p className="mt-2 text-muted-foreground">
            Ce compte n'a aucun rôle dans SVX Rescue. Contactez l'administrateur.
          </p>
        </div>
      </main>
    );
  }

  return (
    <LocaleProvider key={pathname}><AppShell user={session.data!.user} appUser={appUser}>
      <Outlet />
    </AppShell></LocaleProvider>
  );
}
