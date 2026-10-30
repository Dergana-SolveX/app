import type { Context as ApiContext } from "@solvex-dergana/api/context";
import type { Context as HonoContext } from "hono";

import { ENV } from "./env.server";
import { auth, db, events, smsTransport } from "./services";

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
    events,
    smsTransport,
    // The simulated chip talks to this server's own device endpoints; the secret stays on the server.
    chip: { masterDeviceSecret: ENV.MASTER_DEVICE_SECRET, baseUrl: ENV.BETTER_AUTH_URL },
    session,
    appUser,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
