import type { Session } from "@solvex-dergana/auth";
import type { Database } from "@solvex-dergana/db";

export type Context = {
  session: Session | null;
  db: Database;
};
