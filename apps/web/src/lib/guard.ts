import { canAccess, landingPathFor, type RoleHolder, type Screen } from "@solvex-dergana/shared";
import { redirect } from "@tanstack/react-router";

/** For route `beforeLoad`: sends the visitor to their own screen when they may not open `target`. */
export function requireAccess(appUser: RoleHolder | null, target: Screen) {
  if (appUser && canAccess(appUser, target)) return;
  throw redirect({ href: (appUser && landingPathFor(appUser)) || "/login" });
}
