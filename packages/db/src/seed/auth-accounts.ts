import type { appUsers } from "../schema";

type AppUserRow = typeof appUsers.$inferInsert;

export type DemoAccount = {
  appUserId: string;
  /** Better Auth `user.id`, derived from the app user id so reseeding is repeatable. */
  authUserId: string;
  name: string;
  email: string;
};

const DOMAIN = "svx.demo";

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** One login per seeded `app_users` row. Pure: no database, no hashing. */
export function buildDemoAccounts(users: readonly AppUserRow[]): DemoAccount[] {
  let medicCount = 0;
  return users.map((u) => {
    let local: string;
    if (u.role === "medic") local = `medic${++medicCount}`;
    else if (u.role === "hospital") local = `hospital-${slugify(u.name.replace(/^Urgences\s+/, ""))}`;
    else local = u.role;

    const appUserId = u.id as string;
    return {
      appUserId,
      authUserId: `demo-${appUserId}`,
      name: u.name,
      email: `${local}@${DOMAIN}`,
    };
  });
}
