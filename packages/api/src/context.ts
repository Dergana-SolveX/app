import type { Session } from "@solvex-dergana/auth";
import type { AppUser, Database } from "@solvex-dergana/db";

/** The demo role record (`app_users`) behind a Better Auth login. */
export type AppUserContext = Pick<AppUser, "id" | "role" | "unitId" | "hospitalId">;

export type Context = {
  session: Session | null;
  appUser: AppUserContext | null;
  db: Database;
};
