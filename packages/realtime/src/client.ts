// Pusher browser client. No-op fallback when public env vars are absent —
// useState({ subscribe }) returns a stub that does nothing. Component code
// stays identical regardless of whether Pusher is wired in this environment.
"use client";

import PusherJS, { type Channel as PusherChannel } from "pusher-js";

let cached: PusherJS | null = null;

function getPusher(): PusherJS | null {
  if (cached) return cached;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "us3";
  if (!key) return null;
  cached = new PusherJS(key, {
    cluster,
    authEndpoint: "/api/pusher/auth",
  });
  return cached;
}

export type RealtimeSubscription = {
  unsubscribe: () => void;
};

/**
 * Subscribe to a channel and bind a handler to one event.
 * Returns an unsubscribe function. No-op when Pusher isn't configured.
 */
export function subscribe(
  channelName: string,
  eventName: string,
  handler: (data: unknown) => void,
): RealtimeSubscription {
  const p = getPusher();
  if (!p) return { unsubscribe: () => {} };
  const channel: PusherChannel = p.subscribe(channelName);
  channel.bind(eventName, handler);
  return {
    unsubscribe: () => {
      channel.unbind(eventName, handler);
      p.unsubscribe(channelName);
    },
  };
}
