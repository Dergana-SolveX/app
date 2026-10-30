import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

/** The home page is just a router: signed-in users go to their screen, others to the login. */
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    throw redirect({ to: session.data ? "/dashboard" : "/login" });
  },
});
