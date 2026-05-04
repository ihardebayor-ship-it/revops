// app/not-found.tsx — explicitly defined so Next 15 doesn't fall back
// to the built-in Pages-Router 404 component, which imports <Html> and
// crashes the static prerender step.
//
// We force dynamic rendering by reading headers() — without this, Next
// 15 still tries to statically prerender /404 and the build worker
// crashes on a chunk that pulls in <Html>.

import { headers } from "next/headers";

export default async function NotFound() {
  await headers(); // opts the route out of static prerender
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="flex max-w-md flex-col gap-3 text-center">
        <p className="text-xs uppercase tracking-wider text-zinc-500">404</p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
          Page not found
        </h1>
        <p className="text-sm text-zinc-400">
          The page you were looking for doesn't exist or has moved.
        </p>
        <a
          href="/"
          className="mt-2 inline-block rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          Go home
        </a>
      </div>
    </main>
  );
}
