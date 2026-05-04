"use client";

// Dashboard-scoped error boundary. Catches uncaught errors in any
// dashboard sub-route and renders an actionable fallback instead of
// the global /500 page. The Pages-Router-style global-error.tsx exists
// for the very-bad-day case (root layout itself crashes); this one
// catches the more common "one query died on a fresh workspace" case
// and offers a retry that re-runs the failing render.

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to Vercel's runtime logs so we can debug — also visible
    // in the browser console for local dev.
    console.error("[dashboard.error]", error.message, error.digest);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <p className="text-xs uppercase tracking-wider text-amber-400">Dashboard error</p>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
        We couldn't render this view.
      </h1>
      <p className="text-sm text-zinc-400">
        Usually this is a transient hiccup on a fresh workspace with no data yet, or a
        DB query that timed out. Try again — if it keeps happening,{" "}
        <a href="/" className="text-blue-400 hover:underline">
          head home
        </a>{" "}
        and reach out.
      </p>
      {error.digest && (
        <p className="text-xs text-zinc-500">
          Error ID: <code>{error.digest}</code>
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
