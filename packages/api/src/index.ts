import { initTRPC, TRPCError } from "@trpc/server";

import type { AppUserContext, Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

/** Requires a login whose `app_users` role is one of `roles`. */
export const roleProcedure = (...roles: AppUserContext["role"][]) =>
  protectedProcedure.use(({ ctx, next }) => {
    if (!ctx.appUser || !roles.includes(ctx.appUser.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your role cannot access this resource",
      });
    }
    return next({ ctx: { ...ctx, appUser: ctx.appUser } });
  });
