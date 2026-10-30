import { canAccess, landingPathFor, type Screen } from "@solvex-dergana/shared";
import { redirect } from "@tanstack/react-router";

type AppUser = Parameters<typeof landingPathFor>[0] | null;

/** For route `beforeLoad`: sends the visitor to their own screen when they may not open `target`. */
export function requireAccess(appUser: AppUser, target: Screen) {
  if (appUser && canAccess(appUser, target)) return;
  throw redirect({ href: (appUser && landingPathFor(appUser)) || "/login" });
}
