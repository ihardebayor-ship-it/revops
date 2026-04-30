"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@revops/auth/client";

export default function SignInPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(form: FormData) {
    setError(null);
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");
    startTransition(async () => {
      const res = await signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? "Sign in failed");
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-zinc-400">Welcome back.</p>
      </header>

      <form action={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-zinc-400">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-zinc-400">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            minLength={8}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>

        {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-center text-sm text-zinc-400">
        New here?{" "}
        <a href="/sign-up" className="text-blue-400 hover:text-blue-300">
          Create an account
        </a>
      </p>
    </main>
  );
}
