import type { Context as ApiContext } from "@solvex-dergana/api/context";
import type { Context as HonoContext } from "hono";

import { db } from "./services";
import { auth } from "./services";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });
  const appUser = session
    ? ((await db.query.appUsers.findFirst({
        where: { authUserId: session.user.id },
        columns: { id: true, role: true, unitId: true, hospitalId: true },
      })) ?? null)
    : null;
  return {
    db,
    session,
    appUser,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
