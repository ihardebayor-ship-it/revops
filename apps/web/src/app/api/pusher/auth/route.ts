// Pusher channel authorization. Pusher posts (channel_name, socket_id) here
// when a private/presence subscription is requested; we verify the calling
// user has access to that channel and return a signed payload.
//
// Channel naming convention from @revops/realtime/channels.ts:
//   private-workspace-{wsId}-inbox-{userId}    → user must be that userId in that workspace
//   private-workspace-{wsId}-leaderboard-{p}   → user must be a member of the workspace
//   private-agent-thread-{threadId}            → user must own the thread (Phase 1 M5)

import { and, eq, isNull } from "drizzle-orm";
import { getAuth } from "@revops/auth/server";
import { bypassRls, schema } from "@revops/db/client";
import { authorizeChannel } from "@revops/realtime/server";

const WORKSPACE_INBOX_RE = /^private-workspace-([0-9a-f-]{36})-inbox-(.+)$/;
const WORKSPACE_LEADERBOARD_RE = /^private-workspace-([0-9a-f-]{36})-leaderboard-/;
const AGENT_THREAD_RE = /^private-agent-thread-([0-9a-f-]{36})$/;

export async function POST(req: Request) {
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const formData = await req.formData();
  const socketId = String(formData.get("socket_id") ?? "");
  const channel = String(formData.get("channel_name") ?? "");
  if (!socketId || !channel) {
    return new Response("Bad request", { status: 400 });
  }

  // Authorize per channel pattern.
  let authorized = false;

  const inboxMatch = channel.match(WORKSPACE_INBOX_RE);
  if (inboxMatch) {
    const [, wsId, ownerUserId] = inboxMatch;
    if (ownerUserId !== session.user.id) {
      // Inbox is per-user; only the owning user (or a superadmin) can subscribe.
      const isSuper = await bypassRls(async (db) => {
        const r = await db
          .select({ id: schema.platformUsers.id })
          .from(schema.platformUsers)
          .where(
            and(
              eq(schema.platformUsers.userId, session.user.id),
              eq(schema.platformUsers.isActive, true),
            ),
          )
          .limit(1);
        return r.length > 0;
      });
      authorized = isSuper;
    } else {
      // Verify the user has membership in the workspace they claim.
      authorized = await bypassRls(async (db) => {
        const r = await db
          .select({ id: schema.memberships.id })
          .from(schema.memberships)
          .where(
            and(
              eq(schema.memberships.userId, session.user.id),
              eq(schema.memberships.workspaceId, wsId!),
              isNull(schema.memberships.deletedAt),
            ),
          )
          .limit(1);
        return r.length > 0;
      });
    }
  } else if (WORKSPACE_LEADERBOARD_RE.test(channel)) {
    const [, wsId] = channel.match(/^private-workspace-([0-9a-f-]{36})-/) ?? [];
    if (wsId) {
      authorized = await bypassRls(async (db) => {
        const r = await db
          .select({ id: schema.memberships.id })
          .from(schema.memberships)
          .where(
            and(
              eq(schema.memberships.userId, session.user.id),
              eq(schema.memberships.workspaceId, wsId),
              isNull(schema.memberships.deletedAt),
            ),
          )
          .limit(1);
        return r.length > 0;
      });
    }
  } else {
    const threadMatch = channel.match(AGENT_THREAD_RE);
    if (threadMatch) {
      const [, threadId] = threadMatch;
      authorized = await bypassRls(async (db) => {
        const r = await db
          .select({ userId: schema.agentThreads.userId })
          .from(schema.agentThreads)
          .where(eq(schema.agentThreads.id, threadId!))
          .limit(1);
        return r.length > 0 && r[0]!.userId === session.user.id;
      });
    }
  }

  if (!authorized) {
    return new Response("Forbidden", { status: 403 });
  }

  const auth = authorizeChannel({ socketId, channel });
  if (!auth) {
    // Pusher creds missing — return 501 so the client knows to skip realtime.
    return new Response("Realtime disabled", { status: 501 });
  }
  return Response.json(auth);
}
