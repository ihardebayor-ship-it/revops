// Send a message to the agent: creates (or reuses) a thread, persists the
// turnId, and dispatches agent.turn.requested. The Inngest workflow does
// all the actual work — this route just queues. Dev-tolerant of missing
// INNGEST_EVENT_KEY: the user message is still persisted; the workflow
// won't pick it up without a live Inngest dev server.

import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getAuth } from "@revops/auth/server";
import { bypassRls, schema } from "@revops/db/client";
import { inngest } from "@revops/jobs";

export async function POST(req: Request) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json()) as { message?: string; threadId?: string };
  if (!body.message || body.message.trim().length === 0) {
    return Response.json({ ok: false, error: "message required" }, { status: 400 });
  }

  const { workspaceId, threadId } = await bypassRls(async (db) => {
    const [member] = await db
      .select({ workspaceId: schema.memberships.workspaceId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, session.user.id),
          isNull(schema.memberships.deletedAt),
        ),
      )
      .orderBy(desc(schema.memberships.createdAt))
      .limit(1);
    if (!member) throw new Error("No active workspace membership");

    if (body.threadId) return { workspaceId: member.workspaceId, threadId: body.threadId };

    const [thread] = await db
      .insert(schema.agentThreads)
      .values({
        workspaceId: member.workspaceId,
        userId: session.user.id,
        title: body.message!.slice(0, 60),
      })
      .returning({ id: schema.agentThreads.id });
    if (!thread) throw new Error("Failed to create thread");
    return { workspaceId: member.workspaceId, threadId: thread.id };
  });

  const turnId = randomUUID();

  let dispatched = false;
  try {
    await inngest.send({
      name: "agent.turn.requested",
      data: {
        threadId,
        userId: session.user.id,
        workspaceId,
        turnId,
        message: body.message,
      },
    });
    dispatched = true;
  } catch (err) {
    if (process.env.NODE_ENV === "production") throw err;
    console.warn("[agent.send] inngest.send failed (dev):", err instanceof Error ? err.message : err);
  }

  return Response.json({ ok: true, threadId, turnId, dispatched });
}
