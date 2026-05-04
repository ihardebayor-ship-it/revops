"use client";

// app/global-error.tsx — explicit fallback for Next 15 so the static
// prerender of /500 doesn't pull in the Pages-Router default that
// imports <Html>.
//
// Must include its own <html> + <body> because it replaces the root
// layout when an error escapes layout.tsx.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;
  return (
    <html lang="en" className="dark">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-8 text-zinc-100">
          <div className="flex max-w-md flex-col gap-3 text-center">
            <p className="text-xs uppercase tracking-wider text-zinc-500">500</p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Something went wrong.
            </h1>
            <p className="text-sm text-zinc-400">
              Our team has been notified. Try again, or head back to safety.
            </p>
            <div className="mt-2 flex justify-center gap-2">
              <button
                onClick={reset}
                className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
              >
                Try again
              </button>
              <a
                href="/"
                className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
              >
                Go home
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
