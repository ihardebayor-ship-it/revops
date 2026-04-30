import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { can, type Action } from "@revops/auth/policy";
import { type Context } from "./context";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
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
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const authedProcedure = t.procedure.use(isAuthed);

export function authedProcedureWith(action: Action) {
  return authedProcedure.use(({ ctx, next }) => {
    if (!can(ctx.user, action)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Missing permission: ${action}` });
    }
    return next();
  });
}
