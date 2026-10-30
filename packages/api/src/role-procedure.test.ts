import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import type { AppUserContext, Context } from "./context";
import { roleProcedure, router, t } from "./index";

const testRouter = router({
  dispatcherOnly: roleProcedure("dispatcher").query(() => "ok"),
  medicOrAdmin: roleProcedure("medic", "admin").query(({ ctx }) => ctx.appUser.role),
});

const callerFor = (ctx: Partial<Context>) =>
  t.createCallerFactory(testRouter)({ session: null, appUser: null, ...ctx } as Context);

const session = { user: { id: "auth-1" } } as Context["session"];
const appUser = (role: AppUserContext["role"]): AppUserContext => ({
  id: "u-1",
  role,
  unitId: null,
  hospitalId: null,
});

const codeOf = async (call: () => Promise<unknown>) => {
  try {
    await call();
  } catch (e) {
    return e instanceof TRPCError ? e.code : "OTHER";
  }
  return "NO_ERROR";
};

describe("roleProcedure", () => {
  it("rejects a caller with no session as UNAUTHORIZED", async () => {
    expect(await codeOf(() => callerFor({}).dispatcherOnly())).toBe("UNAUTHORIZED");
  });

  it("rejects a logged-in user who has no app user as FORBIDDEN", async () => {
    expect(await codeOf(() => callerFor({ session }).dispatcherOnly())).toBe("FORBIDDEN");
  });

  it("rejects the wrong role as FORBIDDEN", async () => {
    const caller = callerFor({ session, appUser: appUser("medic") });
    expect(await codeOf(() => caller.dispatcherOnly())).toBe("FORBIDDEN");
  });

  it("lets the right role through", async () => {
    const caller = callerFor({ session, appUser: appUser("dispatcher") });
    expect(await caller.dispatcherOnly()).toBe("ok");
  });

  it("accepts any of several allowed roles and exposes the app user", async () => {
    expect(await callerFor({ session, appUser: appUser("medic") }).medicOrAdmin()).toBe("medic");
    expect(await callerFor({ session, appUser: appUser("admin") }).medicOrAdmin()).toBe("admin");
    const hospital = callerFor({ session, appUser: appUser("hospital") });
    expect(await codeOf(() => hospital.medicOrAdmin())).toBe("FORBIDDEN");
  });
});
