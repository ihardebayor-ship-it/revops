import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { can, type Action } from "@revops/auth/policy";
import { withTenant } from "@revops/db/client";
import { captureException } from "@revops/observability";
import { type Context } from "./context";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Real failures (not validation, not auth) go to Sentry. ZodErrors are
    // handled via data.zodError; UNAUTHORIZED/FORBIDDEN don't need on-call.
    if (
      error.code !== "BAD_REQUEST" &&
      error.code !== "UNAUTHORIZED" &&
      error.code !== "FORBIDDEN"
    ) {
      captureException(error.cause ?? error, { trpcCode: error.code });
    }
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const isAuthed = t.middleware(({ ctx, next }) => {
  const user = ctx.user;
  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user } });
});

/**
 * Wraps the procedure body in `withTenant`, so every query runs with
 * `app.current_*` Postgres session settings populated and RLS-scoped to
 * the calling user. Procedures that read `ctx.db` automatically see only
 * their workspace's rows.
 */
const withScopedDb = t.middleware(({ ctx, next }) => {
  const user = ctx.user;
  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return withTenant(user, (scopedDb) =>
    next({ ctx: { ...ctx, user, db: scopedDb } }),
  );
});

export const authedProcedure = t.procedure.use(isAuthed).use(withScopedDb);

export function authedProcedureWith(action: Action) {
  return authedProcedure.use(({ ctx, next }) => {
    if (!can(ctx.user, action)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Missing permission: ${action}` });
    }
    return next();
  });
}
