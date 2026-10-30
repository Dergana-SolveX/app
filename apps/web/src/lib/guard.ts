import { canAccess, landingPathFor, type RoleHolder, type Screen } from "@solvex-dergana/shared";
import { redirect } from "@tanstack/react-router";

/** For route `beforeLoad`: sends the visitor to their own screen when they may not open `target`. */
export function requireAccess(appUser: RoleHolder | null, target: Screen) {
  if (appUser && canAccess(appUser, target)) return;
  const landing = appUser && landingPathFor(appUser);
  // A signed-in account with no screen (e.g. a medic without a unit) stays put: the layout shows "Accès refusé".
  if (appUser && !landing) return;
  throw redirect({ href: landing || "/login" });
}
