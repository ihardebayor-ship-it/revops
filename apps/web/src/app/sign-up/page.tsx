"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@revops/auth/client";

export default function SignUpPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(form: FormData) {
    setError(null);
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");
    const name = String(form.get("name") || "").trim() || email.split("@")[0]!;
    startTransition(async () => {
      const res = await signUp.email({ email, password, name });
      if (res.error) {
        setError(res.error.message ?? "Sign up failed");
        return;
      }
      // Workspace is bootstrapped by the Better Auth `databaseHooks.user.create.after`
      // callback; redirect into the onboarding wizard so the user sees their workspace.
      router.push("/onboarding");
      router.refresh();
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-zinc-400">
          We'll spin up a workspace with a Solo preset by default. You can change the
          topology any time.
        </p>
      </header>

      <form action={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-zinc-400">Name</span>
          <input
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Your name"
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>
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
            minLength={8}
            autoComplete="new-password"
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <span className="text-xs text-zinc-500">8+ characters.</span>
        </label>

        {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="text-center text-sm text-zinc-400">
        Already have an account?{" "}
        <a href="/sign-in" className="text-blue-400 hover:text-blue-300">
          Sign in
        </a>
      </p>
    </main>
  );
}
