import { landingPathFor } from "@solvex-dergana/shared";
import { createFileRoute, redirect } from "@tanstack/react-router";

/** Post-login entry point: sends each role to its own screen. */
export const Route = createFileRoute("/_auth/dashboard")({
  beforeLoad: ({ context }) => {
    const path = context.appUser && landingPathFor(context.appUser);
    throw redirect({ href: path || "/login" });
  },
});
