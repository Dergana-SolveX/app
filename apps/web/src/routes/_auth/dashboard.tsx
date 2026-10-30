import { landingPathFor } from "@solvex-dergana/shared";
import { createFileRoute, redirect } from "@tanstack/react-router";

/** Post-login entry point: sends each role to its own screen. */
export const Route = createFileRoute("/_auth/dashboard")({
  beforeLoad: ({ context }) => {
    if (!context.appUser) return; // the layout shows "Accès refusé"
    const path = landingPathFor(context.appUser);
    if (path) throw redirect({ href: path });
  },
});
