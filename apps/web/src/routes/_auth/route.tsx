import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

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
  const { appUser } = Route.useRouteContext();
  if (!appUser) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-medium">Accès refusé</h1>
        <p className="text-muted-foreground">
          Ce compte n'a aucun rôle dans SVX Rescue. Contactez l'administrateur.
        </p>
      </main>
    );
  }
  return <Outlet />;
}
