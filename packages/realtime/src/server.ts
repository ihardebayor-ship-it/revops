// Pusher server-side: emit events + authorize channel subscriptions.
// No-op fallback when PUSHER_* env vars are missing — the calling code
// never branches on env presence.

import Pusher from "pusher";

let cached: Pusher | null = null;
let cacheKey: string | null = null;

function getClient(): Pusher | null {
  const key = `${process.env.PUSHER_APP_ID ?? ""}|${process.env.PUSHER_KEY ?? ""}`;
  if (cached && cacheKey === key) return cached;
  const appId = process.env.PUSHER_APP_ID;
  const pk = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER;
  if (!appId || !pk || !secret || !cluster) return null;
  cached = new Pusher({ appId, key: pk, secret, cluster, useTLS: true });
  cacheKey = key;
  return cached;
}

/**
 * Emit an event on a channel. No-op if Pusher creds are absent; never throws.
 * Errors at the Pusher edge are caught and logged so an outage in the
 * realtime layer never breaks the originating mutation.
 */
export async function emit(
  channel: string,
  event: string,
  data: Record<string, unknown>,
): Promise<{ delivered: boolean }> {
  const client = getClient();
  if (!client) return { delivered: false };
  try {
    await client.trigger(channel, event, data);
    return { delivered: true };
  } catch (err) {
    console.error("[realtime] emit failed", { channel, event, err });
    return { delivered: false };
  }
}

/**
 * Authorize a private/presence channel subscription. Pusher's auth endpoint
 * receives the channel name + socket id and returns a signed payload.
 * Caller is responsible for verifying the user has access to the channel
 * BEFORE calling this; this function just signs.
 */
export function authorizeChannel(args: {
  socketId: string;
  channel: string;
  presenceData?: { user_id: string; user_info?: Record<string, unknown> };
}): { auth: string; channel_data?: string } | null {
  const client = getClient();
  if (!client) return null;
  if (args.channel.startsWith("presence-") && args.presenceData) {
    return client.authorizeChannel(args.socketId, args.channel, args.presenceData);
  }
  return client.authorizeChannel(args.socketId, args.channel);
}
